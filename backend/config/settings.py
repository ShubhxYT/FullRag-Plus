"""Environment-based settings loader."""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root (three levels up from this file: config -> backend -> root)
_env_path = Path(__file__).resolve().parent.parent.parent / ".env"
load_dotenv(_env_path)


def get_gemini_api_key() -> str:
    """Return the Gemini API key from environment.

    Raises:
        RuntimeError: If GEMINI_API_KEY is not set.
    """
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        raise RuntimeError(
            "GEMINI_API_KEY not set. Copy .env.example to .env and add your key."
        )
    return key


def get_groq_api_key() -> str:
    """Return the Groq API key from environment.

    Raises:
        RuntimeError: If GROQ_API_KEY is not set.
    """
    key = os.environ.get("GROQ_API_KEY", "")
    if not key:
        raise RuntimeError(
            "GROQ_API_KEY not set. Copy .env.example to .env and add your key."
        )
    return key


def get_database_url() -> str:
    """Return the database URL from environment.

    Defaults to the local Docker PostgreSQL from pgvector.yaml
    if DATABASE_URL is not set.

    Returns:
        SQLAlchemy-compatible database URL.
    """
    return os.environ.get(
        "DATABASE_URL",
        "postgresql+psycopg://fullrag:fullrag@localhost:5432/fullrag",
    )


def get_generation_model() -> str:
    """Return the generation model name from environment.

    Defaults to gemini-2.5-flash.
    """
    return os.environ.get("GENERATION_MODEL", "gemini-2.5-flash")


def get_generation_temperature() -> float:
    """Return the generation temperature from environment.

    Defaults to 0.3.
    """
    return float(os.environ.get("GENERATION_TEMPERATURE", "0.3"))


def get_generation_max_tokens() -> int:
    """Return the max output tokens for generation from environment.

    Defaults to 2048.
    """
    return int(os.environ.get("GENERATION_MAX_TOKENS", "2048"))


def get_generation_provider() -> str:
    """Return the generation provider name from environment.

    Supported: 'opencode', 'groq', 'gemini'. If GENERATION_PROVIDER is unset,
    uses 'opencode' when OPENCODE_API_KEY is set, 'groq' when only a Groq key
    is configured, otherwise 'gemini'.
    """
    explicit = os.environ.get("GENERATION_PROVIDER", "").strip().lower()
    if explicit:
        return explicit
    if os.environ.get("OPENCODE_API_KEY"):
        return "opencode"
    if os.environ.get("GROQ_API_KEY") and not os.environ.get("GEMINI_API_KEY"):
        return "groq"
    return "gemini"


def get_groq_base_url() -> str:
    """Return the Groq API base URL.

    Defaults to the official Groq OpenAI-compatible endpoint.
    """
    return os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1")


# Groq's catalogue changes often (llama-3.3-70b-versatile is no longer offered
# on every plan), so the default is a model available on the free tier today
# and a fallback chain is tried when a model is missing or rate-limited.
DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"
DEFAULT_GROQ_FALLBACK_MODELS = "openai/gpt-oss-20b,qwen/qwen3.8-27b"


def get_groq_model() -> str:
    """Return the primary Groq model name from environment.

    Defaults to openai/gpt-oss-120b. Override with GROQ_MODEL env var.
    """
    return os.environ.get("GROQ_MODEL", "").strip() or DEFAULT_GROQ_MODEL


def get_groq_fallback_models() -> list[str]:
    """Return Groq models to try, in order, if the primary model fails.

    Comma-separated GROQ_FALLBACK_MODELS; set it to an empty string to
    disable fallback. Defaults to openai/gpt-oss-20b,qwen/qwen3.8-27b.
    """
    raw = os.environ.get("GROQ_FALLBACK_MODELS")
    if raw is None:
        raw = DEFAULT_GROQ_FALLBACK_MODELS
    return [m.strip() for m in raw.split(",") if m.strip()]


def get_groq_reasoning_effort() -> str:
    """Reasoning effort for Groq reasoning models (gpt-oss): low|medium|high.

    Defaults to 'low' to keep chat latency down.
    """
    return os.environ.get("GROQ_REASONING_EFFORT", "low").strip().lower()


def get_mistral_api_key() -> str:
    """Return the Mistral API key from environment.

    Raises:
        RuntimeError: If MISTRAL_API_KEY is not set.
    """
    key = os.environ.get("MISTRAL_API_KEY", "")
    if not key:
        raise RuntimeError(
            "MISTRAL_API_KEY not set. Add it to your .env file."
        )
    return key


def get_mistral_model() -> str:
    """Return the Mistral model name for enrichment from environment.

    Defaults to mistral-small-latest.
    """
    return os.environ.get("MISTRAL_MODEL", "mistral-small-latest")


def get_enrichment_provider() -> str:
    """Return the enrichment provider name from environment.

    Supported: 'gemini', 'mistral'. Defaults to 'gemini'.
    """
    return os.environ.get("ENRICHMENT_PROVIDER", "gemini")


def get_log_level() -> str:
    """Return the log level from environment.

    Defaults to INFO. Supported: DEBUG, INFO, WARNING, ERROR, CRITICAL.
    """
    return os.environ.get("LOG_LEVEL", "INFO").upper()


def get_log_format() -> str:
    """Return the log format from environment.

    Supported: 'json' (structured), 'text' (human-readable).
    Defaults to 'json'.
    """
    return os.environ.get("LOG_FORMAT", "json").lower()


def get_log_file() -> str | None:
    """Return the log file path from environment.

    If not set, logs go to stderr only. If set, logs are also
    written to a rotating file.
    """
    return os.environ.get("LOG_FILE") or None


def get_cache_ttl_seconds() -> int:
    """Return the response cache TTL in seconds.

    Defaults to 3600 (1 hour).
    """
    return int(os.environ.get("CACHE_TTL_SECONDS", "3600"))


def get_cache_max_size() -> int:
    """Return the maximum number of entries in the response cache.

    Defaults to 256.
    """
    return int(os.environ.get("CACHE_MAX_SIZE", "256"))


def get_response_cache_enabled() -> bool:
    """Return whether the response cache is enabled.

    Defaults to True.
    """
    return os.environ.get("RESPONSE_CACHE_ENABLED", "true").lower() in ("true", "1", "yes")


def get_continuous_eval_enabled() -> bool:
    """Return whether continuous evaluation is enabled.

    Defaults to True.
    """
    return os.environ.get("CONTINUOUS_EVAL_ENABLED", "true").lower() in ("true", "1", "yes")


def get_eval_schedule_interval_hours() -> int:
    """Return the evaluation schedule interval in hours.

    Defaults to 24 (daily).
    """
    return int(os.environ.get("EVAL_SCHEDULE_INTERVAL_HOURS", "24"))


def get_transcript_fallback_enabled() -> bool:
    """Return whether transcript fallback is enabled.

    When True, queries that return insufficient context fall back to
    answering from the raw transcript file. Defaults to True.
    """
    return os.environ.get("TRANSCRIPT_FALLBACK_ENABLED", "true").lower() in (
        "true",
        "1",
        "yes",
    )


def get_transcript_path() -> str:
    """Return the path to the transcript file used as fallback context.

    Defaults to 'data/transcript.md'. Override with TRANSCRIPT_PATH env var.
    """
    return os.environ.get("TRANSCRIPT_PATH", "data/transcript.md")


# ---------------------------------------------------------------------------
# OpenCode Go (OpenAI-compatible). Model list:
#   curl https://opencode.ai/inference/go/v1/models
# ---------------------------------------------------------------------------

DEFAULT_OPENCODE_BASE_URL = "https://opencode.ai/inference/go/openai/v1"
DEFAULT_OPENCODE_MODEL = "deepseek-v4.1-flash"


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in ("true", "1", "yes", "on")


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def get_opencode_api_key() -> str:
    key = os.environ.get("OPENCODE_API_KEY", "")
    if not key:
        raise RuntimeError("OPENCODE_API_KEY not set.")
    return key


def get_opencode_base_url() -> str:
    return os.environ.get("OPENCODE_BASE_URL", "").strip() or DEFAULT_OPENCODE_BASE_URL


def get_opencode_model() -> str:
    return os.environ.get("OPENCODE_MODEL", "").strip() or DEFAULT_OPENCODE_MODEL


def get_opencode_fallback_models() -> list[str]:
    raw = os.environ.get("OPENCODE_FALLBACK_MODELS", "")
    return [m.strip() for m in raw.split(",") if m.strip()]


def get_opencode_reasoning_effort() -> str:
    """deepseek-v4.1-flash accepts low|high|max. Empty disables the parameter."""
    return os.environ.get("OPENCODE_REASONING_EFFORT", "low").strip().lower()


def get_groq_fallback_enabled() -> bool:
    """With provider 'opencode', also try the Groq chain when OpenCode fails."""
    return _env_bool("GROQ_FALLBACK_ENABLED", True) and bool(os.environ.get("GROQ_API_KEY"))


# ---------------------------------------------------------------------------
# Context budgets (tokens). Defaults follow the provider: the OpenCode model
# has a ~1M window, Groq's free tier allows ~8k tokens/minute.
# ---------------------------------------------------------------------------

def _large_context_provider() -> bool:
    return get_generation_provider() in ("opencode", "gemini")


def get_max_context_tokens() -> int:
    return _env_int("MAX_CONTEXT_TOKENS", 128000 if _large_context_provider() else 6000)


def get_overview_context_tokens() -> int:
    """Budget for corpus-wide / overview prompts (outlines + summaries)."""
    return _env_int("OVERVIEW_CONTEXT_TOKENS", 200000 if _large_context_provider() else 4500)


def get_default_max_output_tokens() -> int:
    return _env_int("GENERATION_MAX_TOKENS", 8192 if _large_context_provider() else 2048)


def get_small_library_docs() -> int:
    """Libraries with at most this many documents get every document outlined
    for an overview question even when it does not say 'all'."""
    return _env_int("SMALL_LIBRARY_DOCS", 40)


def get_map_reduce_doc_tokens() -> int:
    """Most document text sent to one map call in map-reduce summaries."""
    return _env_int("MAP_REDUCE_DOC_TOKENS", 30000)


def get_map_reduce_concurrency() -> int:
    return max(1, _env_int("MAP_REDUCE_CONCURRENCY", 8))


# ---------------------------------------------------------------------------
# Retrieval quality knobs
# ---------------------------------------------------------------------------

def get_reranker_name() -> str:
    """'cross-encoder' (local, free), 'llm' (uses the generation model) or 'none'."""
    return os.environ.get("RERANKER", "cross-encoder").strip().lower()


def get_reranker_model() -> str:
    return os.environ.get("RERANKER_MODEL", "").strip() or "cross-encoder/ms-marco-MiniLM-L-6-v2"


def get_retrieval_candidates() -> int:
    """Candidates fetched from pgvector before reranking / MMR."""
    return _env_int("RETRIEVAL_CANDIDATES", 40)


def get_mmr_lambda() -> float:
    try:
        return float(os.environ.get("MMR_LAMBDA", "0.7"))
    except ValueError:
        return 0.7


def get_query_rewrite_enabled() -> bool:
    return _env_bool("QUERY_REWRITE_ENABLED", True)


def get_document_summaries_enabled() -> bool:
    """Write a per-document summary at ingest (one LLM call per upload)."""
    return _env_bool("DOCUMENT_SUMMARIES_ENABLED", True)


def get_summary_backfill_on_startup() -> bool:
    """Fill missing document summaries in the background at startup.
    Only writes documents.summary; never touches chunks or embeddings."""
    return _env_bool("SUMMARY_BACKFILL_ON_STARTUP", True)
