"""Rerankers for retrieval candidates.

* ``cross-encoder`` (default): a small local sentence-transformers
  CrossEncoder (cross-encoder/ms-marco-MiniLM-L-6-v2, ~90 MB, CPU-friendly).
  Free, no API calls. Model via RERANKER_MODEL.
* ``llm``: one call to the generation model that scores every candidate.
* ``none``: keep pgvector order.

Scores are only used for ordering; ``similarity_score`` stays the cosine
score so the "insufficient context" threshold keeps its meaning.
"""

from __future__ import annotations

import json
import re
import threading
from typing import Protocol

from observability.logging import get_logger

logger = get_logger(__name__)


class Reranker(Protocol):
    name: str

    def score(self, query: str, texts: list[str]) -> list[float]: ...


class CrossEncoderReranker:
    name = "cross-encoder"

    def __init__(self, model_name: str) -> None:
        self.model_name = model_name
        self._model = None
        self._lock = threading.Lock()

    def _load(self):
        with self._lock:
            if self._model is None:
                from sentence_transformers import CrossEncoder

                self._model = CrossEncoder(self.model_name, max_length=512, device="cpu")
                logger.info("Reranker loaded: %s", self.model_name)
        return self._model

    def score(self, query: str, texts: list[str]) -> list[float]:
        if not texts:
            return []
        model = self._load()
        scores = model.predict([(query, t[:2000]) for t in texts], batch_size=16, show_progress_bar=False)
        return [float(s) for s in scores]


class LLMReranker:
    name = "llm"

    SYSTEM = (
        "You rank passages for a search engine. For each passage give a relevance score 0-10 "
        "for answering the query. Reply with JSON only: {\"scores\": [s1, s2, ...]} in passage order."
    )

    def __init__(self, provider=None) -> None:
        self._provider = provider

    def score(self, query: str, texts: list[str]) -> list[float]:
        if not texts:
            return []
        from config.settings import get_generation_provider
        from generation.llm_service import get_generation_provider as make
        from generation.models import GenerationConfig

        if self._provider is None:
            self._provider = make(get_generation_provider())
        body = "\n\n".join(f"[{i}] {t[:1200]}" for i, t in enumerate(texts, 1))
        resp = self._provider.generate(
            self.SYSTEM,
            f"Query: {query}\n\nPassages:\n{body}",
            GenerationConfig(temperature=0.0, max_output_tokens=1500),
        )
        m = re.search(r"\{.*\}", resp.text, re.S)
        scores = json.loads(m.group(0))["scores"] if m else []
        scores = [float(s) for s in scores][: len(texts)]
        return scores + [0.0] * (len(texts) - len(scores))


_reranker: Reranker | None = None
_reranker_failed = False
_reranker_lock = threading.Lock()


def get_reranker() -> Reranker | None:
    """Configured reranker, or None ('none' or it failed to load before)."""
    global _reranker
    from config.settings import get_reranker_model, get_reranker_name

    if _reranker_failed:
        return None
    name = get_reranker_name()
    if name in ("", "none", "off", "false"):
        return None
    with _reranker_lock:
        if _reranker is None:
            _reranker = LLMReranker() if name == "llm" else CrossEncoderReranker(get_reranker_model())
    return _reranker


def rerank_scores(query: str, texts: list[str]) -> list[float] | None:
    """Scores from the configured reranker, or None if unavailable (never raises)."""
    global _reranker_failed
    r = get_reranker()
    if r is None:
        return None
    try:
        return r.score(query, texts)
    except Exception as exc:
        logger.warning("Reranker %s failed, keeping vector order: %s", r.name, exc)
        if isinstance(r, CrossEncoderReranker) and r._model is None:
            _reranker_failed = True  # model could not load: stop retrying every query
        return None


def mmr_select(
    relevance: list[float],
    vectors: list[list[float]] | None,
    k: int,
    lam: float = 0.7,
    doc_ids: list[str] | None = None,
    max_per_document: int | None = None,
) -> list[int]:
    """Maximal Marginal Relevance over candidates (indices into the inputs).

    relevance: higher is better (any scale; min-max normalised here).
    vectors: unit-ish embeddings for the redundancy term (None -> pure relevance).
    max_per_document: hard per-source quota applied while selecting.
    """
    n = len(relevance)
    if n == 0 or k <= 0:
        return []
    lo, hi = min(relevance), max(relevance)
    rel = [(r - lo) / (hi - lo) if hi > lo else 1.0 for r in relevance]

    def cos(a, b):
        num = sum(x * y for x, y in zip(a, b))
        da = sum(x * x for x in a) ** 0.5
        db = sum(y * y for y in b) ** 0.5
        return num / (da * db) if da and db else 0.0

    chosen: list[int] = []
    per_doc: dict[str, int] = {}
    remaining = list(range(n))
    while remaining and len(chosen) < k:
        best, best_val = None, None
        for i in remaining:
            if max_per_document and doc_ids and per_doc.get(doc_ids[i], 0) >= max_per_document:
                continue
            redundancy = max((cos(vectors[i], vectors[j]) for j in chosen), default=0.0) if vectors else 0.0
            val = lam * rel[i] - (1 - lam) * redundancy
            if best_val is None or val > best_val:
                best, best_val = i, val
        if best is None:
            break
        chosen.append(best)
        remaining.remove(best)
        if doc_ids:
            per_doc[doc_ids[best]] = per_doc.get(doc_ids[best], 0) + 1
    return chosen
