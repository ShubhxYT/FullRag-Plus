"""Re-embed chunks whose vectors predate contextual embeddings.

Older rows were embedded from the bare chunk text; new ones use
``retrieval.doc_routing.contextual_text`` (document name + section + text)
and carry ``#ctx1`` in ``embedding_model``. This rewrites only the vectors
(and that tag) of outdated rows, in place: documents and chunks are untouched.

Run once by hand with ``python -m embeddings.reembed``; the API also runs it
in the background at startup when outdated rows exist.
"""

from __future__ import annotations

import time

from sqlalchemy import select, update

from database.connection import get_session
from database.models import ChunkEmbeddingModel, ChunkModel, DocumentModel
from observability.logging import get_logger
from retrieval.doc_routing import CONTEXT_VERSION, contextual_text

logger = get_logger(__name__)
TAG = f"#{CONTEXT_VERSION}"


def outdated_count() -> int:
    session = get_session()
    try:
        return len(
            session.execute(
                select(ChunkEmbeddingModel.id).where(
                    ~ChunkEmbeddingModel.embedding_model.endswith(TAG)
                )
            ).all()
        )
    finally:
        session.close()


def reembed_outdated(embedding_service=None, batch_size: int = 32) -> int:
    """Re-embed every outdated chunk embedding. Returns how many were updated."""
    if embedding_service is None:
        from api.routes.upload import _get_embedding_service

        embedding_service = _get_embedding_service()

    start = time.perf_counter()
    updated = 0
    while True:
        session = get_session()
        try:
            rows = session.execute(
                select(
                    ChunkEmbeddingModel.id,
                    ChunkModel.text,
                    ChunkModel.section_path,
                    DocumentModel.source_path,
                    DocumentModel.title,
                )
                .join(ChunkModel, ChunkModel.id == ChunkEmbeddingModel.chunk_id)
                .join(DocumentModel, DocumentModel.id == ChunkModel.document_id)
                .where(~ChunkEmbeddingModel.embedding_model.endswith(TAG))
                .limit(batch_size)
            ).all()
            if not rows:
                break
            texts = [
                contextual_text(r.text, r.source_path, r.title, r.section_path) for r in rows
            ]
            result = embedding_service.embed(texts)
            model = f"{result.model}{TAG}"
            for r, vec in zip(rows, result.vectors):
                session.execute(
                    update(ChunkEmbeddingModel)
                    .where(ChunkEmbeddingModel.id == r.id)
                    .values(embedding=vec, embedding_model=model)
                )
            session.commit()
            updated += len(rows)
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    if updated:
        logger.info(
            "Re-embedded %d chunk(s) with document context in %.1fs",
            updated,
            time.perf_counter() - start,
        )
    return updated


if __name__ == "__main__":
    print(f"outdated before: {outdated_count()}")
    print(f"updated: {reembed_outdated()}")
    print(f"outdated after: {outdated_count()}")
