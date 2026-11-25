"""Retrieval service orchestrating query embedding and vector search."""

import asyncio
import time

from observability.logging import get_logger

from database.connection import get_session
from database.models import ChunkModel
from database.repository import DocumentRepository
from embeddings.cache import CachedEmbeddingService
from embeddings.models import EmbeddingConfig
from embeddings.service import EmbeddingService
from retrieval.models import RetrievalResponse, RetrievalResult

logger = get_logger(__name__)


class RetrievalService:
    """Orchestrates query embedding -> vector search -> result formatting.

    Uses the local SentenceTransformer embedding model and pgvector
    cosine similarity search via DocumentRepository.
    """

    def __init__(
        self,
        embedding_service: EmbeddingService | CachedEmbeddingService | None = None,
        config: EmbeddingConfig | None = None,
    ) -> None:
        """Initialize the retrieval service.

        Args:
            embedding_service: Pre-configured embedding service. If None,
                a default EmbeddingService is created using the config.
            config: Embedding configuration. Used only when
                embedding_service is not provided.
        """
        self._config = config or EmbeddingConfig()
        self._embedding_service = embedding_service or EmbeddingService(
            config=self._config,
        )
        self._repo = DocumentRepository()

    async def retrieve(
        self,
        query: str,
        top_k: int = 5,
        threshold: float | None = None,
        document_ids: list[str] | None = None,
        max_per_document: int | None = None,
    ) -> RetrievalResponse:
        """Retrieve the most relevant chunks for a query.

        Embeds the query, searches the vector database for similar chunks,
        and returns ranked results with metadata.

        Args:
            query: The user's search query.
            top_k: Maximum number of results to return.
            threshold: Minimum similarity score (0-1). None disables filtering.

        Returns:
            RetrievalResponse with ranked results and query metadata.
        """
        start = time.perf_counter()

        # 1. Embed the query (blocking I/O — offload to thread)
        logger.debug(
            "Embedding query",
            extra={"component": "retrieval", "query": query[:80]},
        )
        query_vector = await asyncio.to_thread(
            self._embedding_service.embed_one, query
        )

        # 2. Search the vector database (blocking I/O — offload to thread)
        results = await asyncio.to_thread(
            self._search_sync, query_vector, top_k, threshold, document_ids, max_per_document
        )

        elapsed_ms = (time.perf_counter() - start) * 1000

        top_score = results[0].similarity_score if results else 0.0
        logger.info(
            "Retrieval complete",
            extra={
                "component": "retrieval",
                "result_count": len(results),
                "duration_ms": round(elapsed_ms, 2),
                "top_k": top_k,
                "threshold": threshold,
                "top_score": top_score,
            },
        )

        return RetrievalResponse(
            query=query,
            top_k=top_k,
            threshold=threshold,
            result_count=len(results),
            latency_ms=round(elapsed_ms, 2),
            results=results,
        )

    def retrieve_sync(
        self,
        query: str,
        top_k: int = 5,
        threshold: float | None = None,
    ) -> RetrievalResponse:
        """Synchronous retrieve for CLI and backward compatibility."""
        start = time.perf_counter()

        query_vector = self._embedding_service.embed_one(query)
        results = self._search_sync(query_vector, top_k, threshold)

        elapsed_ms = (time.perf_counter() - start) * 1000
        top_score = results[0].similarity_score if results else 0.0
        logger.info(
            "Retrieval complete",
            extra={
                "component": "retrieval",
                "result_count": len(results),
                "duration_ms": round(elapsed_ms, 2),
                "top_k": top_k,
                "threshold": threshold,
                "top_score": top_score,
            },
        )

        return RetrievalResponse(
            query=query,
            top_k=top_k,
            threshold=threshold,
            result_count=len(results),
            latency_ms=round(elapsed_ms, 2),
            results=results,
        )

    def _search_sync(
        self,
        query_vector: list[float],
        top_k: int,
        threshold: float | None,
        document_ids: list[str] | None = None,
        max_per_document: int | None = None,
    ) -> list[RetrievalResult]:
        """Run the synchronous DB search and map results.

        With ``max_per_document`` a wider candidate set is fetched and capped
        per document, so one long document cannot take every slot.
        """
        fetch = top_k * 4 if max_per_document else top_k
        session = get_session()
        try:
            kwargs = {"top_k": fetch, "threshold": threshold}
            if document_ids:
                kwargs["document_ids"] = document_ids
            raw_results = self._repo.search_by_vector(session, query_vector, **kwargs)

            # 3. Map to RetrievalResult objects
            results = [
                self._map_result(chunk, score, "vector") for chunk, score in raw_results
            ]
        finally:
            session.close()
        if max_per_document:
            per_doc: dict[str, int] = {}
            capped = []
            for r in results:
                if per_doc.get(r.document_id, 0) < max_per_document:
                    per_doc[r.document_id] = per_doc.get(r.document_id, 0) + 1
                    capped.append(r)
            results = capped
        return results[:top_k]

    def document_catalog(self) -> list[tuple[str, str, str | None]]:
        """(id, source_path, title) of every document."""
        session = get_session()
        try:
            return self._repo.list_document_names(session)
        finally:
            session.close()

    def document_outlines(
        self,
        document_ids: list[str],
        scores: dict[str, float] | None = None,
        max_headings: int = 40,
    ) -> list[RetrievalResult]:
        """One pseudo-chunk per document listing its headings in order."""
        from retrieval.doc_routing import display_name, outline_from_chunks

        session = get_session()
        try:
            chunks = self._repo.get_chunks_for_documents(session, document_ids)
            by_doc: dict[str, list[ChunkModel]] = {}
            for c in chunks:
                by_doc.setdefault(str(c.document_id), []).append(c)
            out: list[RetrievalResult] = []
            for doc_id in document_ids:
                doc_chunks = by_doc.get(doc_id)
                if not doc_chunks:
                    continue
                doc = doc_chunks[0].document
                headings = outline_from_chunks((c.text for c in doc_chunks), max_items=max_headings)
                if headings:
                    body = "\n".join(f"- {h}" for h in headings)
                else:  # no headings: fall back to the opening text
                    body = doc_chunks[0].text[:1200]
                name = display_name(doc.source_path)
                out.append(
                    RetrievalResult(
                        chunk_id=f"outline:{doc_id}",
                        text=f"Outline of the document \"{name}\" (its section headings in order):\n{body}",
                        summary="",
                        keywords=[],
                        section_path=[],
                        page_numbers=[],
                        document_id=doc_id,
                        document_title=doc.title,
                        source_path=doc.source_path,
                        similarity_score=round((scores or {}).get(doc_id, 0.0), 4),
                        match_type="outline",
                        token_count=0,
                    )
                )
            return out
        finally:
            session.close()

    async def retrieve_by_keyword(
        self,
        query: str,
        top_k: int = 10,
    ) -> list[RetrievalResult]:
        """Full-text keyword search against the tsv index.

        Args:
            query: The user's search query.
            top_k: Maximum number of results.

        Returns:
            List of RetrievalResult tagged with match_type='keyword'.
        """
        results = await asyncio.to_thread(
            self._keyword_search_sync, query, top_k
        )
        return results

    def _keyword_search_sync(
        self,
        query: str,
        top_k: int,
    ) -> list[RetrievalResult]:
        """Synchronous keyword search via DocumentRepository."""
        session = get_session()
        try:
            raw_results = self._repo.search_by_keyword(session, query, limit=top_k)
            results = [
                self._map_result(chunk, score, "keyword") for chunk, score in raw_results
            ]
        finally:
            session.close()
        return results

    @staticmethod
    def _map_result(chunk: ChunkModel, score: float, match_type: str = "vector") -> RetrievalResult:
        """Map a ChunkModel + similarity score to a RetrievalResult.

        Accesses the chunk's parent document via the SQLAlchemy relationship
        to populate document-level fields.
        """
        doc = chunk.document
        return RetrievalResult(
            chunk_id=str(chunk.id),
            text=chunk.text,
            summary=chunk.summary or "",
            keywords=list(chunk.keywords or []),
            section_path=list(chunk.section_path or []),
            page_numbers=list(chunk.page_numbers or []),
            document_id=str(chunk.document_id),
            document_title=doc.title if doc else None,
            source_path=doc.source_path if doc else "",
            similarity_score=round(score, 4),
            match_type=match_type,
            token_count=chunk.token_count or 0,
        )