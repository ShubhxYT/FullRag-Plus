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
        candidates: int | None = None,
    ) -> RetrievalResponse:
        """Retrieve the most relevant chunks for a query.

        With ``candidates`` (> top_k) a wider pool is fetched, reranked with
        the configured reranker (RERANKER) and narrowed to top_k with MMR
        (MMR_LAMBDA) under the per-document quota ``max_per_document``.

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
        if candidates and candidates > top_k:
            results = await asyncio.to_thread(
                self._search_rerank_sync, query, query_vector, top_k, candidates,
                threshold, document_ids, max_per_document,
            )
        else:
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

    def _search_rerank_sync(
        self,
        query: str,
        query_vector: list[float],
        top_k: int,
        candidates: int,
        threshold: float | None,
        document_ids: list[str] | None,
        max_per_document: int | None,
    ) -> list[RetrievalResult]:
        """Wide vector search -> rerank -> MMR with a per-document quota."""
        from config.settings import get_mmr_lambda
        from retrieval.doc_routing import display_name
        from retrieval.reranker import mmr_select, rerank_scores

        session = get_session()
        try:
            kwargs = {"top_k": candidates, "threshold": threshold, "with_vectors": True}
            if document_ids:
                kwargs["document_ids"] = document_ids
            raw = self._repo.search_by_vector(session, query_vector, **kwargs)
            results = [self._map_result(chunk, score, "vector") for chunk, score, _ in raw]
            vectors = [v for _, _, v in raw]
        finally:
            session.close()
        if not results:
            return []
        scores = rerank_scores(
            query, [f"{display_name(r.source_path)}\n{r.text}" for r in results]
        )
        if scores is not None:
            for r, sc in zip(results, scores):
                r.rerank_score = round(float(sc), 4)
            relevance = scores
        else:
            relevance = [r.similarity_score for r in results]
        idx = mmr_select(
            relevance, vectors, top_k, get_mmr_lambda(),
            doc_ids=[r.document_id for r in results], max_per_document=max_per_document,
        )
        # present in relevance order (highest first) for the context budget
        idx.sort(key=lambda i: relevance[i], reverse=True)
        return [results[i] for i in idx]

    def document_summaries(self, document_ids: list[str] | None = None) -> dict[str, str]:
        session = get_session()
        try:
            return self._repo.get_document_summaries(session, document_ids)
        finally:
            session.close()

    def document_texts(self, document_ids: list[str], max_tokens: int) -> dict[str, str]:
        """{doc_id: reading-order text cut to max_tokens} (for map-reduce)."""
        from ingestion.summaries import document_text

        session = get_session()
        try:
            chunks = self._repo.get_chunks_for_documents(session, document_ids)
            by_doc: dict[str, list[ChunkModel]] = {}
            for c in chunks:
                by_doc.setdefault(str(c.document_id), []).append(c)
            return {d: document_text(cs, max_tokens=max_tokens) for d, cs in by_doc.items()}
        finally:
            session.close()

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
        max_headings: int | None = None,
        include_summary: bool = True,
        include_outline: bool = True,
    ) -> list[RetrievalResult]:
        """One pseudo-chunk per document: its stored summary and every
        (non-generic) heading in reading order. ``max_headings=None`` keeps
        all headings; the caller's token budget decides what fits."""
        from generation.context_manager import ContextManager
        from retrieval.doc_routing import display_name, outline_from_chunks

        session = get_session()
        try:
            chunks = self._repo.get_chunks_for_documents(session, document_ids)
            summaries = self._repo.get_document_summaries(session, document_ids) if include_summary else {}
            by_doc: dict[str, list[ChunkModel]] = {}
            for c in chunks:
                by_doc.setdefault(str(c.document_id), []).append(c)
            out: list[RetrievalResult] = []
            for doc_id in document_ids:
                doc_chunks = by_doc.get(doc_id)
                if not doc_chunks:
                    continue
                doc = doc_chunks[0].document
                name = display_name(doc.source_path)
                parts: list[str] = [f"Document: \"{name}\" (file {doc.source_path})"]
                summary = summaries.get(doc_id)
                if summary:
                    parts.append(f"Summary:\n{summary.strip()}")
                if include_outline:
                    headings = outline_from_chunks((c.text for c in doc_chunks), max_items=max_headings)
                    if headings:
                        parts.append("Section headings in order:\n" + "\n".join(f"- {h}" for h in headings))
                if len(parts) == 1:  # no summary and no headings: opening text
                    parts.append(doc_chunks[0].text[:1200])
                text = "\n\n".join(parts)
                out.append(
                    RetrievalResult(
                        chunk_id=f"outline:{doc_id}",
                        text=text,
                        summary=(summary or "")[:300],
                        keywords=[],
                        section_path=[],
                        page_numbers=[],
                        document_id=doc_id,
                        document_title=doc.title,
                        source_path=doc.source_path,
                        similarity_score=round((scores or {}).get(doc_id, 0.0), 4),
                        match_type="outline",
                        token_count=ContextManager.count_tokens(text),
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