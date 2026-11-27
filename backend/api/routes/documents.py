"""Documents listing and deletion endpoints."""

import shutil
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from observability.logging import get_logger
from sqlalchemy import delete, func, select

from api.models import (
    DeleteDocumentsRequest,
    DeleteDocumentsResponse,
    DocumentInfo,
    DocumentsResponse,
    ErrorResponse,
)
from database.connection import get_session
from database.models import ChunkModel, DocumentModel

logger = get_logger(__name__)
router = APIRouter()


@router.get(
    "/documents",
    response_model=DocumentsResponse,
    responses={500: {"model": ErrorResponse}},
)
def list_documents() -> DocumentsResponse:
    """List all ingested documents with chunk counts."""
    session = get_session()
    try:
        stmt = (
            select(
                DocumentModel.id,
                DocumentModel.title,
                DocumentModel.source_path,
                DocumentModel.created_at,
                DocumentModel.summary.is_not(None).label("has_summary"),
                func.count(ChunkModel.id).label("chunk_count"),
            )
            .outerjoin(ChunkModel, ChunkModel.document_id == DocumentModel.id)
            .group_by(DocumentModel.id)
            .order_by(DocumentModel.created_at.desc())
        )
        rows = session.execute(stmt).all()

        documents = [
            DocumentInfo(
                id=str(row.id),
                title=row.title,
                source_path=row.source_path,
                chunk_count=row.chunk_count,
                created_at=row.created_at.isoformat(),
                has_summary=bool(row.has_summary),
            )
            for row in rows
        ]

        return DocumentsResponse(documents=documents, total=len(documents))
    finally:
        session.close()


# Where upload ingestion writes per-document artifacts (parsed markdown,
# extracted images): <tmp>/results/<tmpname>/. Only paths under here are
# ever removed from disk.
ARTIFACT_ROOT = Path(tempfile.gettempdir()) / "results"


def _valid_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def _remove_artifacts(output_dirs: list[str]) -> None:
    """Best-effort removal of a document's files on disk (after the DB commit)."""
    root = ARTIFACT_ROOT.resolve()
    for raw in output_dirs:
        try:
            path = Path(raw).resolve()
        except (OSError, RuntimeError):
            continue
        if path == root or root not in path.parents:
            logger.warning("Not removing artifacts outside %s: %s", root, raw)
            continue
        shutil.rmtree(path, ignore_errors=True)


def _delete_documents(ids: list[str]) -> DeleteDocumentsResponse:
    """Delete documents (chunks and embeddings cascade) in one transaction."""
    from api.routes.query import invalidate_response_cache
    from api.routes.upload import processing_document_ids

    wanted = list(dict.fromkeys(i.strip() for i in ids))
    valid = [i for i in wanted if _valid_uuid(i)]

    busy = processing_document_ids() & set(valid)
    if busy:
        raise HTTPException(
            status_code=409,
            detail="Still processing; try again once ingestion has finished: "
            + ", ".join(sorted(busy)),
        )

    session = get_session()
    try:
        rows = (
            session.execute(
                select(DocumentModel.id, DocumentModel.metadata_).where(
                    DocumentModel.id.in_(valid)
                )
            ).all()
            if valid
            else []
        )
        found = [str(r.id) for r in rows]
        chunks = 0
        if found:
            chunks = session.execute(
                select(func.count(ChunkModel.id)).where(
                    ChunkModel.document_id.in_(found)
                )
            ).scalar_one()
            # ON DELETE CASCADE removes chunks and chunk_embeddings.
            session.execute(delete(DocumentModel).where(DocumentModel.id.in_(found)))
            session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    if found:
        invalidate_response_cache()
        _remove_artifacts(
            [
                (r.metadata_ or {}).get("output_dir")
                for r in rows
                if isinstance(r.metadata_, dict) and r.metadata_.get("output_dir")
            ]
        )
        logger.info("Deleted %d document(s), %d chunk(s): %s", len(found), chunks, found)

    return DeleteDocumentsResponse(
        deleted=found,
        not_found=[i for i in wanted if i not in found],
        chunks_deleted=chunks,
    )


@router.delete(
    "/documents/{document_id}",
    response_model=DeleteDocumentsResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def delete_document(document_id: str) -> DeleteDocumentsResponse:
    """Delete one document with its chunks, embeddings and files."""
    result = _delete_documents([document_id])
    if not result.deleted:
        raise HTTPException(status_code=404, detail="Document not found.")
    return result


@router.post(
    "/documents/delete",
    response_model=DeleteDocumentsResponse,
    responses={409: {"model": ErrorResponse}},
)
def delete_documents(request: DeleteDocumentsRequest) -> DeleteDocumentsResponse:
    """Delete several documents at once (all or nothing); unknown ids are reported."""
    return _delete_documents(request.ids)
