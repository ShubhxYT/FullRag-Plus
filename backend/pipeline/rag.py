"""RAG pipeline orchestrator — wires retrieval, context, prompts, and generation."""

import asyncio
import re
import time
from pathlib import Path
from typing import AsyncIterator

from observability.logging import get_logger

from config.settings import (
    get_cache_max_size,
    get_cache_ttl_seconds,
    get_response_cache_enabled,
    get_transcript_fallback_enabled,
    get_transcript_path,
)
from generation.context_manager import ContextManager
from generation.llm_service import GenerationProvider, get_generation_provider
from generation.models import GenerationConfig, GenerationResponse, PromptVariant
from generation.prompts import PromptRegistry
from pipeline.cache import ResponseCache
from pipeline.models import (
    LatencyBreakdown,
    RAGResponse,
    SourceCitation,
)
from retrieval.models import RetrievalResult
from retrieval.service import RetrievalService

logger = get_logger(__name__)


_CITATION_RE = re.compile(r"【\s*(?:Source\s*)?(\d+)[^】]*】")


def normalize_citations(text: str) -> str:
    """gpt-oss models like to cite as 【1†L2-L3】; rewrite those to [1]."""
    return _CITATION_RE.sub(lambda m: f"[{m.group(1)}]", text)


def _snippet(text: str | None, limit: int = 280) -> str:
    """Collapse whitespace and cut the chunk text to a short excerpt."""
    flat = " ".join((text or "").split())
    return flat if len(flat) <= limit else flat[: limit - 1].rstrip() + "…"


class RAGPipeline:
    """End-to-end RAG pipeline: retrieve -> context -> prompt -> generate.

    Orchestrates the full flow from question to grounded answer.
    """

    def __init__(
        self,
        retrieval_service: RetrievalService | None = None,
        generation_provider: GenerationProvider | None = None,
        context_manager: ContextManager | None = None,
        prompt_registry: PromptRegistry | None = None,
        generation_config: GenerationConfig | None = None,
        provider_name: str = "gemini",
        response_cache: ResponseCache | None = None,
        transcript_fallback_enabled: bool | None = None,
        transcript_path: str | None = None,
    ) -> None:
        self._retrieval = retrieval_service or RetrievalService()
        self._generation_config = generation_config or GenerationConfig()
        self._provider = generation_provider or get_generation_provider(provider_name)
        self._context_manager = context_manager or ContextManager(self._generation_config)
        self._prompt_registry = prompt_registry or PromptRegistry()

        # Transcript fallback
        self._transcript_fallback_enabled = (
            transcript_fallback_enabled
            if transcript_fallback_enabled is not None
            else get_transcript_fallback_enabled()
        )
        self._transcript_path = transcript_path or get_transcript_path()

        # Response cache
        self._cache_enabled = get_response_cache_enabled()
        if response_cache is not None:
            self._response_cache = response_cache
        elif self._cache_enabled:
            self._response_cache = ResponseCache(
                maxsize=get_cache_max_size(),
                ttl=get_cache_ttl_seconds(),
            )
        else:
            self._response_cache = None

    # How many prior turns are sent to the LLM, and how much of each.
    MAX_HISTORY_TURNS = 6
    MAX_HISTORY_CHARS = 2000

    @classmethod
    def _trim_history(cls, history: list[dict[str, str]] | None) -> list[dict[str, str]]:
        turns = [
            {"role": t["role"], "content": t["content"][: cls.MAX_HISTORY_CHARS]}
            for t in (history or [])
            if t.get("role") in ("user", "assistant") and (t.get("content") or "").strip()
        ]
        return turns[-cls.MAX_HISTORY_TURNS :]

    @staticmethod
    def _retrieval_query(question: str, history: list[dict[str, str]]) -> str:
        """Follow-ups like "what about its drawbacks?" retrieve poorly on their
        own, so prepend the previous user question as retrieval context."""
        previous = [t["content"] for t in history if t["role"] == "user"]
        if not previous:
            return question
        return f"{previous[-1]}\n{question}"

    def _cache_key(self, question: str, history: list[dict[str, str]]) -> str | None:
        """Only stand-alone questions are cached (answers depend on history)."""
        if history:
            return None
        return question

    async def _prepare(
        self,
        question: str,
        top_k: int,
        prompt_variant: str | None,
        history: list[dict[str, str]],
        latency: LatencyBreakdown,
    ):
        """Retrieve, fit context and render the prompt."""
        logger.info(
            "RAG pipeline: retrieving",
            extra={"component": "pipeline", "query": question[:80], "top_k": top_k},
        )
        retrieval_start = time.perf_counter()
        retrieval_response = await self._retrieval.retrieve(
            self._retrieval_query(question, history), top_k=top_k
        )
        latency.retrieval_ms = round((time.perf_counter() - retrieval_start) * 1000, 2)

        context_start = time.perf_counter()
        fitted_chunks = self._context_manager.fit_context(retrieval_response.results)
        latency.context_ms = round((time.perf_counter() - context_start) * 1000, 2)

        if prompt_variant:
            variant = PromptVariant(prompt_variant)
        else:
            variant = self._prompt_registry.select_template(question, fitted_chunks)

        # Transcript fallback — override INSUFFICIENT when enabled
        if variant == PromptVariant.INSUFFICIENT and self._transcript_fallback_enabled:
            logger.info(
                "RAG pipeline: insufficient context — activating transcript fallback",
                extra={"component": "pipeline", "transcript_path": self._transcript_path},
            )
            fitted_chunks = self._load_transcript_as_chunks()
            variant = PromptVariant.TRANSCRIPT_FALLBACK

        rendered = self._prompt_registry.render(variant, question, fitted_chunks)
        logger.info(
            "RAG pipeline: generating",
            extra={
                "component": "pipeline",
                "variant": rendered.variant.value,
                "version": rendered.version,
                "chunk_count": len(fitted_chunks),
                "history_turns": len(history),
            },
        )
        return fitted_chunks, rendered

    def _generate_kwargs(self, history: list[dict[str, str]]) -> dict:
        # Only pass history when there is some, so providers/mocks with the
        # original 3-argument signature keep working.
        return {"history": history} if history else {}

    async def query(
        self,
        question: str,
        top_k: int = 5,
        prompt_variant: str | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> RAGResponse:
        """Execute the full RAG pipeline for a question.

        Args:
            question: The user's question.
            top_k: Number of chunks to retrieve.
            prompt_variant: Explicit prompt variant name, or None for auto-select.
            history: Earlier conversation turns (oldest first) for follow-ups.

        Returns:
            RAGResponse with answer, sources, latency, and token usage.
        """
        history = self._trim_history(history)
        cache_key = self._cache_key(question, history)
        if cache_key and self._cache_enabled and self._response_cache is not None:
            cached = self._response_cache.get(cache_key)
            if cached is not None:
                return cached

        total_start = time.perf_counter()
        latency = LatencyBreakdown()
        fitted_chunks, rendered = await self._prepare(
            question, top_k, prompt_variant, history, latency
        )

        # Generate answer (blocking I/O — offload to thread)
        generation_start = time.perf_counter()
        gen_response = await asyncio.to_thread(
            self._provider.generate,
            rendered.system_prompt,
            rendered.user_prompt,
            self._generation_config,
            **self._generate_kwargs(history),
        )
        latency.generation_ms = round((time.perf_counter() - generation_start) * 1000, 2)
        latency.total_ms = round((time.perf_counter() - total_start) * 1000, 2)

        sources = self._build_citations(fitted_chunks)
        logger.info(
            "RAG pipeline complete",
            extra={
                "component": "pipeline",
                "answer_len": len(gen_response.text),
                "sources": len(sources),
                "total_ms": latency.total_ms,
                "retrieval_ms": latency.retrieval_ms,
                "generation_ms": latency.generation_ms,
            },
        )

        response = RAGResponse(
            answer=normalize_citations(gen_response.text),
            sources=sources,
            latency=latency,
            token_usage=gen_response.token_usage,
            prompt_version=rendered.version,
            model=getattr(gen_response, "model", None),
        )

        if cache_key and self._cache_enabled and self._response_cache is not None:
            self._response_cache.set(cache_key, response)

        return response

    async def stream_query(
        self,
        question: str,
        top_k: int = 5,
        prompt_variant: str | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> AsyncIterator[dict]:
        """Run the pipeline and stream events as they happen.

        Yields dicts: {"type": "sources", "sources": [...], "prompt_version"},
        then {"type": "delta", "text": "..."} for each chunk of the answer,
        then {"type": "done", "response": RAGResponse}. Errors propagate.
        Providers without generate_stream fall back to one big delta.
        """
        history = self._trim_history(history)
        cache_key = self._cache_key(question, history)
        if cache_key and self._cache_enabled and self._response_cache is not None:
            cached = self._response_cache.get(cache_key)
            if cached is not None:
                yield {"type": "sources", "sources": cached.sources, "prompt_version": cached.prompt_version}
                yield {"type": "delta", "text": cached.answer}
                yield {"type": "done", "response": cached}
                return

        total_start = time.perf_counter()
        latency = LatencyBreakdown()
        fitted_chunks, rendered = await self._prepare(
            question, top_k, prompt_variant, history, latency
        )
        sources = self._build_citations(fitted_chunks)
        yield {"type": "sources", "sources": sources, "prompt_version": rendered.version}

        generation_start = time.perf_counter()
        final: GenerationResponse | None = None
        stream_fn = getattr(self._provider, "generate_stream", None)
        if stream_fn is None:
            final = await asyncio.to_thread(
                self._provider.generate,
                rendered.system_prompt,
                rendered.user_prompt,
                self._generation_config,
                **self._generate_kwargs(history),
            )
            yield {"type": "delta", "text": final.text}
        else:
            iterator = stream_fn(
                rendered.system_prompt,
                rendered.user_prompt,
                self._generation_config,
                **self._generate_kwargs(history),
            )
            sentinel = object()
            while True:
                item = await asyncio.to_thread(next, iterator, sentinel)
                if item is sentinel:
                    break
                if isinstance(item, GenerationResponse):
                    final = item
                else:
                    yield {"type": "delta", "text": item}
        if final is None:
            raise RuntimeError("Generation produced no response")

        latency.generation_ms = round((time.perf_counter() - generation_start) * 1000, 2)
        latency.total_ms = round((time.perf_counter() - total_start) * 1000, 2)
        response = RAGResponse(
            answer=normalize_citations(final.text),
            sources=sources,
            latency=latency,
            token_usage=final.token_usage,
            prompt_version=rendered.version,
            model=final.model,
        )
        logger.info(
            "RAG pipeline (stream) complete",
            extra={
                "component": "pipeline",
                "answer_len": len(final.text),
                "sources": len(sources),
                "total_ms": latency.total_ms,
                "model": final.model,
            },
        )
        if cache_key and self._cache_enabled and self._response_cache is not None:
            self._response_cache.set(cache_key, response)
        yield {"type": "done", "response": response}

    def _load_transcript_as_chunks(self) -> list[RetrievalResult]:
        """Load the transcript file and split into token-budget-aware chunks.

        Reads the transcript at ``self._transcript_path``, splits on blank
        lines (paragraph-level), wraps each paragraph in a synthetic
        RetrievalResult, then passes the list through ``fit_context`` so
        the standard token-budget logic applies.

        Returns:
            Subset of transcript chunks that fit within the context budget.
            Returns an empty list when the file cannot be found.
        """
        path = Path(self._transcript_path)
        if not path.exists():
            logger.warning(
                "Transcript file not found — fallback returns empty context",
                extra={"component": "pipeline", "transcript_path": str(path)},
            )
            return []

        text = path.read_text(encoding="utf-8")
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

        chunks: list[RetrievalResult] = []
        for i, paragraph in enumerate(paragraphs):
            chunks.append(
                RetrievalResult(
                    chunk_id=f"transcript-{i}",
                    text=paragraph,
                    summary="Transcript content",
                    keywords=[],
                    section_path=[],
                    page_numbers=[],
                    document_id="transcript",
                    document_title="transcript",
                    source_path=self._transcript_path,
                    similarity_score=0.0,
                    match_type="transcript",
                    token_count=0,
                )
            )

        return self._context_manager.fit_context(chunks)

    @staticmethod
    def _build_citations(chunks: list[RetrievalResult]) -> list[SourceCitation]:
        """Convert retrieval results to source citations."""
        return [
            SourceCitation(
                document_title=chunk.document_title,
                source_path=chunk.source_path,
                chunk_summary=chunk.summary,
                page_numbers=chunk.page_numbers,
                similarity_score=chunk.similarity_score,
                snippet=_snippet(chunk.text),
            )
            for chunk in chunks
        ]
