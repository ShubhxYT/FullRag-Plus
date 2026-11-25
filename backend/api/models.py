"""Pydantic request/response schemas for the API layer."""

from typing import Literal

from pydantic import BaseModel, Field

from generation.models import TokenUsage
from pipeline.models import LatencyBreakdown, SourceCitation


class ChatTurn(BaseModel):
    """One prior turn of the conversation, for follow-up questions."""

    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class QueryRequest(BaseModel):
    """POST /query request body."""

    question: str = Field(
        description="The user's question.",
        min_length=1,
        max_length=1000,
    )
    top_k: int = Field(
        default=5,
        ge=1,
        le=20,
        description="Number of chunks to retrieve.",
    )
    prompt_variant: str | None = Field(
        default=None,
        description="Prompt variant: 'qa', 'summarize', or None for auto.",
    )
    history: list[ChatTurn] = Field(
        default_factory=list,
        max_length=20,
        description="Earlier turns of this conversation (oldest first).",
    )


class QueryResponse(BaseModel):
    """POST /query response body."""

    answer: str
    sources: list[SourceCitation]
    latency: LatencyBreakdown
    token_usage: TokenUsage
    prompt_version: str
    query_log_id: str | None = None
    model: str | None = None


class HealthResponse(BaseModel):
    """GET /health response body."""

    status: str
    database: str


class DocumentInfo(BaseModel):
    """Single document in the GET /documents response."""

    id: str
    title: str | None
    source_path: str
    chunk_count: int
    created_at: str


class DocumentsResponse(BaseModel):
    """GET /documents response body."""

    documents: list[DocumentInfo]
    total: int


class DeleteDocumentsRequest(BaseModel):
    """POST /documents/delete request body."""

    ids: list[str] = Field(..., min_length=1, max_length=100)


class DeleteDocumentsResponse(BaseModel):
    """Result of deleting one or more documents."""

    deleted: list[str]
    not_found: list[str] = []
    chunks_deleted: int = 0


class ErrorResponse(BaseModel):
    """Structured error response."""

    error: str
    detail: str
