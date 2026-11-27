"""FastAPI application for the FullRag RAG system."""

import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.routes import documents, evaluation, health, query, upload
from config.settings import (
    get_continuous_eval_enabled,
    get_eval_schedule_interval_hours,
    get_log_file,
    get_log_format,
    get_log_level,
)
from observability.logging import (
    clear_request_context,
    configure_logging,
    get_logger,
    set_request_context,
)
from observability.tracing import clear_trace_context, set_trace_context

configure_logging(
    level=get_log_level(),
    fmt=get_log_format(),
    log_file=get_log_file(),
)
logger = get_logger(__name__)

_scheduler = None


def _start_reembed_thread() -> None:
    """Upgrade old chunk embeddings to contextual ones in the background.

    Holds the upload lock so it never competes with an ingestion for CPU or
    for loading the embedding model.
    """
    import threading

    def run() -> None:
        try:
            from api.routes.upload import _ingest_lock
            from embeddings.reembed import outdated_count, reembed_outdated

            if outdated_count() == 0:
                return
            with _ingest_lock:
                n = reembed_outdated()
            if n:
                from api.routes.query import invalidate_response_cache

                invalidate_response_cache()
        except Exception as exc:  # never block startup
            logger.warning("Background re-embedding skipped: %s", exc)

    threading.Thread(target=run, name="reembed", daemon=True).start()


def _start_summary_backfill_thread() -> None:
    """Write summaries for documents that have none (e.g. uploaded before
    summaries existed). Only touches documents.summary*."""
    import threading

    from config.settings import get_document_summaries_enabled, get_summary_backfill_on_startup

    if not (get_document_summaries_enabled() and get_summary_backfill_on_startup()):
        return

    def run() -> None:
        try:
            from ingestion.summaries import backfill_missing

            if backfill_missing():
                from api.routes.query import invalidate_response_cache

                invalidate_response_cache()
        except Exception as exc:  # never block startup
            logger.warning("Summary backfill skipped: %s", exc)

    threading.Thread(target=run, name="summary-backfill", daemon=True).start()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler
    if get_continuous_eval_enabled():
        from evaluation.scheduler import BackgroundEvaluationScheduler

        _scheduler = BackgroundEvaluationScheduler()
        _scheduler.start(get_eval_schedule_interval_hours())
    _start_reembed_thread()
    _start_summary_backfill_thread()
    yield
    if _scheduler:
        _scheduler.stop()


app = FastAPI(
    title="FullRag API",
    description="RAG pipeline REST API - retrieve and generate grounded answers.",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    """Assign a request ID and set up tracing context for each request."""
    request_id = str(uuid.uuid4())
    set_request_context(request_id)
    set_trace_context(request_id)

    logger.info(
        "Request started: %s %s",
        request.method,
        request.url.path,
        extra={"method": request.method, "path": request.url.path},
    )

    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = round((time.perf_counter() - start) * 1000, 2)

    response.headers["X-Request-ID"] = request_id
    logger.info(
        "Request completed: %s %s %d (%.1fms)",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
        extra={
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "duration_ms": duration_ms,
        },
    )

    clear_request_context()
    clear_trace_context()
    return response

# Register routers
app.include_router(health.router, tags=["health"])
app.include_router(documents.router, tags=["documents"])
app.include_router(query.router, tags=["query"])
app.include_router(evaluation.router, tags=["evaluation"])
app.include_router(upload.router, tags=["upload"])


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch unhandled exceptions and return structured JSON errors."""
    logger.error("Unhandled exception: %s", exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "detail": "An unexpected error occurred."},
    )
