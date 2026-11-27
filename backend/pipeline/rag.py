"""RAG pipeline orchestrator — wires retrieval, context, prompts, and generation."""

import asyncio
import re
import time
from pathlib import Path
from typing import AsyncIterator

from observability.logging import get_logger

from dataclasses import dataclass, field

from config.settings import (
    get_cache_max_size,
    get_cache_ttl_seconds,
    get_default_max_output_tokens,
    get_map_reduce_concurrency,
    get_map_reduce_doc_tokens,
    get_max_context_tokens,
    get_overview_context_tokens,
    get_query_rewrite_enabled,
    get_response_cache_enabled,
    get_retrieval_candidates,
    get_small_library_docs,
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
from retrieval.doc_routing import (
    display_name,
    is_corpus_wide,
    is_overview,
    is_summarize_all,
    match_documents,
    natural_key,
)
from retrieval.models import RetrievalResult
from retrieval.service import RetrievalService

logger = get_logger(__name__)


_CITATION_RE = re.compile(r"【\s*(?:Source\s*)?(\d+)[^】]*】")


_OTHER_BRACKET_RE = re.compile(r"\s?【[^】\d]*】")


def normalize_citations(text: str) -> str:
    """gpt-oss models like to cite as 【1†L2-L3】; rewrite those to [1] and
    drop non-numeric ones such as 【Source: transcript】."""
    text = _CITATION_RE.sub(lambda m: f"[{m.group(1)}]", text)
    return _OTHER_BRACKET_RE.sub("", text)


def _snippet(text: str | None, limit: int = 280) -> str:
    """Collapse whitespace and cut the chunk text to a short excerpt."""
    flat = " ".join((text or "").split())
    return flat if len(flat) <= limit else flat[: limit - 1].rstrip() + "…"


@dataclass
class Route:
    """How a question was answered.

    mode: 'search' (vector search), 'named' (search inside named documents),
    'overview' (one summary/outline entry per document) or 'map_reduce'
    (per-document notes, then one combined answer).
    target_ids: documents the answer was meant to cover (for the coverage notice).
    """

    results: list[RetrievalResult]
    mode: str = "search"
    target_ids: list[str] = field(default_factory=list)
    budget: int | None = None

    @property
    def routed(self) -> bool:
        return self.mode != "search"


REWRITE_SYSTEM_PROMPT = """\
You turn the latest message of a conversation into ONE standalone search \
query for a document search engine. Resolve pronouns and references ("it", \
"that algorithm", "the second one") from the earlier turns, keep names, \
numbers and technical terms, drop chit-chat. If the message already stands \
alone, return it unchanged. Output only the query, on one line."""

MAP_SYSTEM_PROMPT = """\
You read ONE document and extract what is needed to answer a request that \
spans many documents. Write compact Markdown notes: the document's main \
topics/modules in order with their subtopics, and any facts the request \
asks for. Use only the document text, keep its own names, no preamble."""


def _coverage_notice(covered: int, total: int, missing: list[str]) -> str:
    shown = ", ".join(missing[:8])
    more = f" (+{len(missing) - 8} more)" if len(missing) > 8 else ""
    tail = f" Not included: {shown}{more}." if missing else ""
    return f"\n\n> **Covered {covered} of {total} documents.**{tail}"


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
        query_rewrite: bool | None = None,
    ) -> None:
        self._retrieval = retrieval_service or RetrievalService()
        self._generation_config = generation_config or GenerationConfig(
            max_output_tokens=get_default_max_output_tokens(),
            max_context_tokens=get_max_context_tokens(),
        )
        # Follow-up rewriting calls the LLM; only on by default with the real provider.
        self._query_rewrite = query_rewrite if query_rewrite is not None else (
            generation_provider is None and get_query_rewrite_enabled()
        )
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

    def invalidate_cache(self) -> None:
        """Drop cached answers (e.g. after documents were added or deleted)."""
        if self._response_cache is not None:
            self._response_cache.invalidate_all()

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

    # Most chunks one document may contribute to an ordinary answer.
    MAX_CHUNKS_PER_DOCUMENT = 3
    # Documents outlined for an overview question in a large library that
    # names none and does not ask for "all" of them.
    MAX_OVERVIEW_DOCUMENTS = 8

    def _catalog(self) -> list[tuple[str, str, str | None]]:
        catalog = getattr(self._retrieval, "document_catalog", None)
        if not callable(catalog):
            return []
        try:
            docs = catalog()
        except Exception as exc:  # routing is an optimisation; never fail the query
            logger.warning("Document catalog unavailable: %s", exc)
            return []
        return docs if isinstance(docs, list) else []

    async def _rewrite_query(self, question: str, history: list[dict[str, str]]) -> str:
        """Standalone retrieval query for a follow-up ("what about its drawbacks?").

        Uses the LLM when enabled; falls back to prepending the previous
        user question."""
        if not history:
            return question
        if not self._query_rewrite:
            return self._retrieval_query(question, history)
        convo = "\n".join(
            f"{t['role']}: {t['content'][:600]}" for t in history[-4:]
        )
        try:
            resp = await asyncio.to_thread(
                self._provider.generate,
                REWRITE_SYSTEM_PROMPT,
                f"Conversation so far:\n{convo}\n\nLatest message: {question}\n\nStandalone query:",
                GenerationConfig(temperature=0.0, max_output_tokens=800),
            )
            lines = [l.strip().strip('"').strip() for l in (resp.text or "").splitlines() if l.strip()]
            q = lines[0] if lines else ""
            if 2 <= len(q) <= 500:
                logger.info("Query rewritten", extra={"component": "pipeline", "rewritten": q[:120]})
                return q
        except Exception as exc:
            logger.warning("Query rewrite failed, using history concat: %s", exc)
        return self._retrieval_query(question, history)

    def _overview_entries(self, doc_ids: list[str], scores: dict[str, float], budget: int) -> list[RetrievalResult]:
        """Summary + full outline per document; shrink to fit the budget.

        1. summary + every heading;  2. summary only (outline capped at 30
        headings for documents without a summary);  3. whatever fits, in
        order (the coverage notice reports the rest)."""
        outlines = getattr(self._retrieval, "document_outlines")
        try:
            full = outlines(doc_ids, scores, max_headings=None)
        except TypeError:  # older/mocked services
            return outlines(doc_ids, scores)

        def size(rs):
            return sum(r.token_count or self._context_manager.count_tokens(r.text) for r in rs)

        if size(full) <= budget:
            return full
        compact = outlines(doc_ids, scores, max_headings=30, include_outline=False)
        with_summary = {r.document_id for r in compact if "Summary:" in r.text}
        missing = [d for d in doc_ids if d not in with_summary]
        if missing:
            extra = {r.document_id: r for r in outlines(missing, scores, max_headings=30)}
            compact = [extra.get(r.document_id, r) if r.document_id in extra else r for r in compact]
        if size(compact) <= budget:
            return compact
        return self._context_manager.fit_context(compact, max_tokens=budget)

    async def _map_reduce(self, question: str, doc_ids: list[str], names: dict[str, str]) -> list[RetrievalResult]:
        """Map: notes per document (parallel, bounded); reduce happens in the
        normal generation step over these notes."""
        texts = await asyncio.to_thread(self._retrieval.document_texts, doc_ids, get_map_reduce_doc_tokens())
        try:
            summaries = await asyncio.to_thread(self._retrieval.document_summaries, doc_ids)
        except Exception:
            summaries = {}
        sem = asyncio.Semaphore(get_map_reduce_concurrency())
        cfg = GenerationConfig(temperature=0.2, max_output_tokens=3000)

        async def one(doc_id: str) -> RetrievalResult | None:
            name = display_name(names.get(doc_id, doc_id))
            notes = ""
            text = texts.get(doc_id) or ""
            if text:
                try:
                    async with sem:
                        resp = await asyncio.to_thread(
                            self._provider.generate,
                            MAP_SYSTEM_PROMPT,
                            f"Request: {question}\n\nDocument: {name}\n<document>\n{text}\n</document>",
                            cfg,
                        )
                    notes = (resp.text or "").strip()
                except Exception as exc:
                    logger.warning("Map step failed for %s: %s", name, exc)
            if not notes:
                notes = (summaries.get(doc_id) or "").strip()
            if not notes:
                return None
            body = f"Document: \"{name}\" (file {names.get(doc_id, '')})\n\nNotes:\n{notes}"
            return RetrievalResult(
                chunk_id=f"map:{doc_id}", text=body, summary=notes[:300], keywords=[],
                section_path=[], page_numbers=[], document_id=doc_id, document_title=None,
                source_path=names.get(doc_id, doc_id), similarity_score=0.0, match_type="map",
                token_count=self._context_manager.count_tokens(body),
            )

        results = await asyncio.gather(*(one(d) for d in doc_ids))
        return [r for r in results if r is not None]

    async def _route(
        self,
        question: str,
        history: list[dict[str, str]],
        top_k: int,
        document_ids: list[str] | None = None,
    ) -> Route:
        """Pick the retrieval strategy for a question.

        * "summarize everything"                -> map-reduce over every document in scope
        * overview ("list all modules/topics")  -> summary + outline of every
          document in scope when the question is corpus-wide or the library is
          small (SMALL_LIBRARY_DOCS); of the named documents; else of the
          documents the best chunks come from
        * names documents ("module 3")          -> search only those
        * otherwise                             -> vector search -> rerank -> MMR (3 per document)

        ``document_ids`` (the UI source picker) limits every path to those documents.
        """
        rq = await self._rewrite_query(question, history)
        catalog = await asyncio.to_thread(self._catalog) if hasattr(self._retrieval, "document_catalog") else []
        if document_ids:
            wanted = set(document_ids)
            scope = [d for d in catalog if d[0] in wanted] if catalog else []
            scope_ids = [d[0] for d in scope] or list(document_ids)
        else:
            scope = catalog
            scope_ids = [d[0] for d in scope]
        names = {d[0]: d[1] for d in catalog}
        pairs = [(d[0], d[1]) for d in scope]

        named = match_documents(question, pairs) if pairs else []
        if not named and history and pairs:
            named = match_documents(rq, pairs)
        corpus = is_corpus_wide(question)
        summarize_all = bool(scope) and is_summarize_all(question)
        overview = bool(scope) and (is_overview(question) or summarize_all)
        search_ids = named or (scope_ids if document_ids else None)
        candidates = get_retrieval_candidates()

        def by_name(ids: list[str]) -> list[str]:
            return sorted(ids, key=lambda i: natural_key(names.get(i, "")))

        if overview:
            scores: dict[str, float] = {}
            if corpus or summarize_all or (not named and len(scope_ids) <= get_small_library_docs()):
                target, expected = scope_ids, scope_ids
            elif named:
                target, expected = named, named
            else:
                ranked = await self._retrieval.retrieve(
                    rq, top_k=max(top_k * 3, 24), document_ids=search_ids,
                    max_per_document=self.MAX_CHUNKS_PER_DOCUMENT,
                )
                order: list[str] = []
                for r in ranked.results:
                    if r.document_id not in scores:
                        order.append(r.document_id)
                        scores[r.document_id] = r.similarity_score
                target, expected = order[: self.MAX_OVERVIEW_DOCUMENTS], scope_ids
            target = by_name(target)
            budget = get_overview_context_tokens()
            if summarize_all:
                results = await self._map_reduce(question, target, names)
                mode = "map_reduce"
            else:
                results = await asyncio.to_thread(self._overview_entries, target, scores, budget)
                mode = "overview"
            logger.info(
                "RAG routing: %s", mode,
                extra={"component": "pipeline", "documents": len(results), "target": len(target),
                       "scope": len(scope_ids), "named": len(named), "corpus": corpus},
            )
            if results:
                return Route(results, mode, by_name(list(expected)), budget)

        if named:
            response = await self._retrieval.retrieve(
                rq, top_k=top_k, document_ids=named, max_per_document=None, candidates=candidates,
            )
            logger.info("RAG routing: named documents", extra={"component": "pipeline", "documents": len(named)})
            return Route(response.results, "named")

        kwargs: dict = {"top_k": top_k, "candidates": candidates}
        if catalog:
            kwargs["max_per_document"] = self.MAX_CHUNKS_PER_DOCUMENT
        if search_ids:
            kwargs["document_ids"] = search_ids
        response = await self._retrieval.retrieve(rq, **kwargs)
        return Route(response.results, "search")

    async def _route_and_retrieve(
        self, question: str, history: list[dict[str, str]], top_k: int,
        document_ids: list[str] | None = None,
    ) -> tuple[list[RetrievalResult], bool]:
        """Backwards-compatible wrapper: (results, routed)."""
        route = await self._route(question, history, top_k, document_ids)
        return route.results, route.routed

    def _cache_key(
        self, question: str, history: list[dict[str, str]], document_ids: list[str] | None = None
    ) -> str | None:
        """Only stand-alone questions are cached (answers depend on history)."""
        if history:
            return None
        if document_ids:
            return question + "||docs:" + ",".join(sorted(document_ids))
        return question

    async def _prepare(
        self,
        question: str,
        top_k: int,
        prompt_variant: str | None,
        history: list[dict[str, str]],
        latency: LatencyBreakdown,
        document_ids: list[str] | None = None,
    ):
        """Retrieve, fit context and render the prompt.

        Returns (fitted_chunks, rendered, coverage); coverage is None for
        ordinary questions and {"covered", "total", "missing"} for overview
        and map-reduce answers."""
        logger.info(
            "RAG pipeline: retrieving",
            extra={"component": "pipeline", "query": question[:80], "top_k": top_k},
        )
        retrieval_start = time.perf_counter()
        route = await self._route(question, history, top_k, document_ids)
        results = route.results
        latency.retrieval_ms = round((time.perf_counter() - retrieval_start) * 1000, 2)

        context_start = time.perf_counter()
        if route.mode in ("overview", "map_reduce"):
            fitted_chunks = self._context_manager.fit_context(results, max_tokens=route.budget)
        else:
            fitted_chunks = self._context_manager.fit_context(results)
        latency.context_ms = round((time.perf_counter() - context_start) * 1000, 2)

        coverage = None
        if route.mode in ("overview", "map_reduce") and route.target_ids:
            covered = {c.document_id for c in fitted_chunks}
            names = {c.document_id: c.source_path for c in results}
            if len(names) < len(route.target_ids):
                names.update({d[0]: d[1] for d in await asyncio.to_thread(self._catalog)})
            missing = [display_name(names.get(d, d)) for d in route.target_ids if d not in covered]
            coverage = {
                "covered": len([d for d in route.target_ids if d in covered]),
                "total": len(route.target_ids),
                "missing": missing,
                "mode": route.mode,
            }

        if prompt_variant:
            variant = PromptVariant(prompt_variant)
        elif route.mode in ("overview", "map_reduce") and fitted_chunks:
            variant = PromptVariant.OVERVIEW
        elif route.routed and fitted_chunks:
            # The question named documents: answer from their content,
            # whatever the raw scores are.
            variant = PromptVariant.QA
        else:
            variant = self._prompt_registry.select_template(question, fitted_chunks)

        # Transcript fallback — override INSUFFICIENT when enabled
        if variant == PromptVariant.INSUFFICIENT and self._transcript_fallback_enabled:
            logger.info(
                "RAG pipeline: insufficient context — activating transcript fallback",
                extra={"component": "pipeline", "transcript_path": self._transcript_path},
            )
            transcript_chunks = self._load_transcript_as_chunks()
            if transcript_chunks:
                fitted_chunks = transcript_chunks
                variant = PromptVariant.TRANSCRIPT_FALLBACK
            # else: no transcript file -> keep INSUFFICIENT so the model says
            # the documents don't cover it instead of talking about a
            # "transcript" the user never provided.

        rendered = self._prompt_registry.render(variant, question, fitted_chunks)
        logger.info(
            "RAG pipeline: generating",
            extra={
                "component": "pipeline",
                "variant": rendered.variant.value,
                "version": rendered.version,
                "chunk_count": len(fitted_chunks),
                "history_turns": len(history),
                "mode": route.mode,
                "coverage": coverage and f"{coverage['covered']}/{coverage['total']}",
            },
        )
        return fitted_chunks, rendered, coverage

    @staticmethod
    def _with_notice(answer: str, coverage: dict | None) -> str:
        if coverage and coverage["covered"] < coverage["total"]:
            return answer + _coverage_notice(coverage["covered"], coverage["total"], coverage["missing"])
        return answer

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
        document_ids: list[str] | None = None,
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
        cache_key = self._cache_key(question, history, document_ids)
        if cache_key and self._cache_enabled and self._response_cache is not None:
            cached = self._response_cache.get(cache_key)
            if cached is not None:
                return cached

        total_start = time.perf_counter()
        latency = LatencyBreakdown()
        fitted_chunks, rendered, coverage = await self._prepare(
            question, top_k, prompt_variant, history, latency, document_ids
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
            answer=self._with_notice(normalize_citations(gen_response.text), coverage),
            sources=sources,
            latency=latency,
            token_usage=gen_response.token_usage,
            prompt_version=rendered.version,
            model=getattr(gen_response, "model", None),
            coverage=coverage,
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
        document_ids: list[str] | None = None,
    ) -> AsyncIterator[dict]:
        """Run the pipeline and stream events as they happen.

        Yields dicts: {"type": "sources", "sources": [...], "prompt_version"},
        then {"type": "delta", "text": "..."} for each chunk of the answer,
        then {"type": "done", "response": RAGResponse}. Errors propagate.
        Providers without generate_stream fall back to one big delta.
        """
        history = self._trim_history(history)
        cache_key = self._cache_key(question, history, document_ids)
        if cache_key and self._cache_enabled and self._response_cache is not None:
            cached = self._response_cache.get(cache_key)
            if cached is not None:
                yield {"type": "sources", "sources": cached.sources, "prompt_version": cached.prompt_version,
                       "coverage": cached.coverage}
                yield {"type": "delta", "text": cached.answer}
                yield {"type": "done", "response": cached}
                return

        total_start = time.perf_counter()
        latency = LatencyBreakdown()
        fitted_chunks, rendered, coverage = await self._prepare(
            question, top_k, prompt_variant, history, latency, document_ids
        )
        sources = self._build_citations(fitted_chunks)
        yield {"type": "sources", "sources": sources, "prompt_version": rendered.version, "coverage": coverage}

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
        notice = self._with_notice("", coverage)
        if notice:
            yield {"type": "delta", "text": notice}

        latency.generation_ms = round((time.perf_counter() - generation_start) * 1000, 2)
        latency.total_ms = round((time.perf_counter() - total_start) * 1000, 2)
        response = RAGResponse(
            answer=normalize_citations(final.text) + notice,
            sources=sources,
            latency=latency,
            token_usage=final.token_usage,
            prompt_version=rendered.version,
            model=final.model,
            coverage=coverage,
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
