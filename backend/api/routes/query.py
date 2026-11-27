"""Query endpoint - main RAG pipeline entry point."""

import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from database.connection import get_session
from database.repository import DocumentRepository
from observability.logging import get_logger
from observability.logging import get_request_id

from api.models import ErrorResponse, QueryRequest, QueryResponse
from pipeline.rag import RAGPipeline

logger = get_logger(__name__)
router = APIRouter()

# Lazy-initialized pipeline singleton
_pipeline: RAGPipeline | None = None


def _get_pipeline() -> RAGPipeline:
    """Get or create the RAG pipeline singleton."""
    global _pipeline
    if _pipeline is None:
        from config.settings import get_generation_provider as get_provider_name

        _pipeline = RAGPipeline(provider_name=get_provider_name())
    return _pipeline


def invalidate_response_cache() -> None:
    """Clear cached answers so none can cite a document that changed or is gone."""
    if _pipeline is not None:
        _pipeline.invalidate_cache()


def _history(request: QueryRequest) -> dict:
    """kwargs for prior turns and the source picker (omitted when empty to
    keep the call minimal)."""
    kwargs: dict = {}
    if request.history:
        kwargs["history"] = [t.model_dump() for t in request.history]
    if request.document_ids:
        kwargs["document_ids"] = list(dict.fromkeys(request.document_ids))
    return kwargs


def _friendly_error(e: Exception) -> str:
    """Short, user-facing reason for a pipeline failure."""
    msg = str(e)
    low = msg.lower()
    if "rate limit" in low or "429" in low:
        return "The language model is rate-limited right now. Please try again in a minute."
    if "api_key" in low and "not set" in low:
        return "The server has no LLM API key configured. " + msg
    return msg


def _log_query(request: QueryRequest, rag_response) -> str | None:
    """Persist the query audit log; never raises."""
    try:
        session = get_session()
        try:
            repo = DocumentRepository()
            query_log_id = repo.insert_query_log(session, {
                "request_id": get_request_id(),
                "query": request.question,
                "answer": rag_response.answer,
                "sources": [s.model_dump() for s in rag_response.sources],
                "prompt_variant": request.prompt_variant,
                "prompt_version": rag_response.prompt_version,
                "retrieval_top_k": request.top_k,
                "retrieval_result_count": len(rag_response.sources),
                "latency_ms": rag_response.latency.total_ms,
                "retrieval_ms": rag_response.latency.retrieval_ms,
                "generation_ms": rag_response.latency.generation_ms,
                "prompt_tokens": rag_response.token_usage.prompt_tokens,
                "completion_tokens": rag_response.token_usage.completion_tokens,
                "model": getattr(rag_response, "model", None) or rag_response.prompt_version,
            })
            session.commit()
            return query_log_id
        finally:
            session.close()
    except Exception as e:
        logger.warning("Failed to insert query log: %s", e)
        return None


@router.post(
    "/query",
    response_model=QueryResponse,
    responses={
        422: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def query_rag(request: QueryRequest) -> QueryResponse:
    """Execute the RAG pipeline and return a grounded answer.

    Args:
        request: Query request with question and optional parameters.

    Returns:
        QueryResponse with answer, sources, latency, and token usage.
    """
    logger.info(
        "Query received",
        extra={
            "question": request.question[:80],
            "top_k": request.top_k,
            "variant": request.prompt_variant,
            "history_turns": len(request.history),
        },
    )

    try:
        pipeline = _get_pipeline()
        rag_response = await pipeline.query(
            question=request.question,
            top_k=request.top_k,
            prompt_variant=request.prompt_variant,
            **_history(request),
        )
    except Exception as e:
        logger.error("RAG pipeline error: %s", e, exc_info=True)
        raise HTTPException(
            status_code=503,
            detail=_friendly_error(e),
        )

    logger.info(
        "Query complete",
        extra={
            "answer_len": len(rag_response.answer),
            "sources": len(rag_response.sources),
            "total_ms": rag_response.latency.total_ms,
        },
    )

    query_log_id = await asyncio.to_thread(_log_query, request, rag_response)

    return QueryResponse(
        answer=rag_response.answer,
        sources=rag_response.sources,
        latency=rag_response.latency,
        token_usage=rag_response.token_usage,
        prompt_version=rag_response.prompt_version,
        query_log_id=query_log_id,
        model=getattr(rag_response, "model", None),
        coverage=getattr(rag_response, "coverage", None),
    )


@router.post("/query/stream")
async def query_rag_stream(request: QueryRequest) -> StreamingResponse:
    """Stream the RAG answer as NDJSON (one JSON object per line).

    Events, in order:
      {"type": "sources", "sources": [...], "prompt_version": "..."}
      {"type": "delta", "text": "..."}            (many)
      {"type": "done", "answer", "latency", "token_usage", "prompt_version",
       "model", "query_log_id"}
    On failure: {"type": "error", "detail": "..."} and the stream ends.
    """
    logger.info(
        "Stream query received",
        extra={
            "question": request.question[:80],
            "top_k": request.top_k,
            "history_turns": len(request.history),
        },
    )

    def line(obj: dict) -> bytes:
        return (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")

    async def events():
        try:
            pipeline = _get_pipeline()
            async for event in pipeline.stream_query(
                question=request.question,
                top_k=request.top_k,
                prompt_variant=request.prompt_variant,
                **_history(request),
            ):
                kind = event["type"]
                if kind == "sources":
                    yield line({
                        "type": "sources",
                        "sources": [s.model_dump() for s in event["sources"]],
                        "prompt_version": event["prompt_version"],
                        "coverage": event.get("coverage"),
                    })
                elif kind == "delta":
                    yield line({"type": "delta", "text": event["text"]})
                elif kind == "done":
                    rag_response = event["response"]
                    query_log_id = await asyncio.to_thread(_log_query, request, rag_response)
                    yield line({
                        "type": "done",
                        "answer": rag_response.answer,
                        "latency": rag_response.latency.model_dump(),
                        "token_usage": rag_response.token_usage.model_dump(),
                        "prompt_version": rag_response.prompt_version,
                        "model": rag_response.model,
                        "query_log_id": query_log_id,
                        "coverage": rag_response.coverage,
                    })
        except Exception as e:
            logger.error("RAG stream error: %s", e, exc_info=True)
            yield line({"type": "error", "detail": _friendly_error(e)})

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={
            # stop nginx / proxies from buffering the stream
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
        },
    )
