"""Corpus-wide overviews, series matching, coverage notice, map-reduce,
source picker scope, MMR and the OpenCode provider chain."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from generation.models import GenerationConfig, GenerationResponse, PromptVariant
from retrieval.doc_routing import (
    is_corpus_wide,
    is_overview,
    is_summarize_all,
    match_documents,
    natural_key,
    outline_from_chunks,
)
from retrieval.models import RetrievalResponse, RetrievalResult
from retrieval.reranker import mmr_select

DAA = [
    ("m1", "DAA_DSE3101-Module 1.pdf"),
    ("m2", "DAA_DSE3101-Module 2.pdf"),
    ("m3", "DAA_DSE3101-Module 3.pdf"),
    ("lab", "DSE3130-DAA Lab_Course Hand-out_Aug-Nov 2026 V1.pdf"),
    ("t10", "10-Fractional Knapsack- concept and Questions.pdf"),
    ("t2", "2- Asymptotic Notations.pdf"),
    ("t1", "1-Introduction.pdf"),
    ("t11", "11-Huffman Concept-New.pdf"),
]
QUESTION = "go through all the sources and list all modules with topics in them"


class TestRouting:
    def test_series_word_anywhere_in_name(self):
        assert set(match_documents("list my modules", DAA)) == {"m1", "m2", "m3"}
        assert match_documents("what is in module 3", DAA) == ["m3"]
        assert set(match_documents("compare module 1 and 2", DAA)) == {"m1", "m2"}

    def test_corpus_wide(self):
        assert is_corpus_wide(QUESTION) and is_overview(QUESTION)
        assert is_corpus_wide("summarize everything") and is_summarize_all("summarize everything")
        assert is_summarize_all("give me a summary of all the documents")
        assert not is_corpus_wide("what is huffman coding")
        assert not is_summarize_all(QUESTION)

    def test_natural_sort(self):
        names = sorted([p for _, p in DAA], key=natural_key)
        assert names.index("2- Asymptotic Notations.pdf") < names.index("10-Fractional Knapsack- concept and Questions.pdf")

    def test_outline_uncapped_and_generic_dropped(self):
        texts = ["\n".join(f"## Topic {i}" for i in range(60)) + "\n## Algorithm\n## Code\n## Example"]
        out = outline_from_chunks(texts)
        assert len(out) == 60 and "Algorithm" not in out and "Code" not in out


def _outline(ids, scores=None, max_headings=None, include_summary=True, include_outline=True):
    return [
        RetrievalResult(chunk_id=f"outline:{i}", text=f"Document {i}\nSummary:\n" + ("x " * 50), summary="",
                        document_id=i, source_path=dict(DAA)[i], similarity_score=0.0, match_type="outline",
                        token_count=60)
        for i in ids
    ]


def _pipeline(provider=None, outlines=_outline):
    from pipeline.rag import RAGPipeline

    retrieval = MagicMock()
    retrieval.document_catalog = MagicMock(return_value=[(i, s, None) for i, s in DAA])
    retrieval.retrieve = AsyncMock(return_value=RetrievalResponse(query="q", top_k=5, result_count=0, latency_ms=1, results=[]))
    retrieval.document_outlines = MagicMock(side_effect=outlines)
    retrieval.document_texts = MagicMock(side_effect=lambda ids, n: {i: f"text of {i}" for i in ids})
    retrieval.document_summaries = MagicMock(return_value={})
    prov = provider or MagicMock()
    if provider is None:
        prov.generate = MagicMock(return_value=GenerationResponse(text="Answer [1]", model="m"))
    return RAGPipeline(retrieval_service=retrieval, generation_provider=prov,
                       transcript_fallback_enabled=False, response_cache=None), retrieval, prov


class TestCorpusOverview:
    def test_his_question_covers_every_document_sorted(self):
        p, r, _ = _pipeline()
        route = asyncio.run(p._route(QUESTION, [], 5))
        assert route.mode == "overview"
        assert [x.source_path for x in route.results] == sorted([s for _, s in DAA], key=natural_key)
        assert len(route.target_ids) == len(DAA)

    def test_full_coverage_has_no_notice(self):
        p, _, _ = _pipeline()
        resp = asyncio.run(p.query(QUESTION))
        assert resp.coverage["covered"] == resp.coverage["total"] == len(DAA)
        assert "Covered" not in resp.answer
        assert resp.prompt_version == "overview_v1"

    def test_partial_coverage_notice(self, monkeypatch):
        monkeypatch.setattr("pipeline.rag.get_overview_context_tokens", lambda: 130)  # fits 2 entries
        p, _, _ = _pipeline()
        resp = asyncio.run(p.query(QUESTION))
        assert resp.coverage["covered"] == 2 and resp.coverage["total"] == len(DAA)
        assert f"Covered 2 of {len(DAA)} documents" in resp.answer

    def test_source_picker_limits_scope(self):
        p, _, _ = _pipeline()
        route = asyncio.run(p._route(QUESTION, [], 5, document_ids=["t1", "m2"]))
        assert {x.document_id for x in route.results} == {"t1", "m2"}
        assert route.target_ids == ["t1", "m2"]

    def test_source_picker_in_plain_search(self):
        p, r, _ = _pipeline()
        asyncio.run(p._route("what is a greedy choice", [], 5, document_ids=["t10"]))
        assert r.retrieve.call_args.kwargs["document_ids"] == ["t10"]

    def test_cache_key_includes_documents(self):
        p, _, _ = _pipeline()
        assert p._cache_key("q", [], ["b", "a"]) != p._cache_key("q", [])

    def test_map_reduce_calls_each_document(self):
        p, r, prov = _pipeline()
        resp = asyncio.run(p.query("summarize everything"))
        # one map call per document + the final reduce
        assert prov.generate.call_count == len(DAA) + 1
        assert resp.coverage["mode"] == "map_reduce" and resp.coverage["covered"] == len(DAA)


class TestRewrite:
    def test_follow_up_is_rewritten_by_llm(self):
        prov = MagicMock()
        prov.generate = MagicMock(return_value=GenerationResponse(text="time complexity of Huffman coding", model="m"))
        from pipeline.rag import RAGPipeline

        p = RAGPipeline(retrieval_service=MagicMock(), generation_provider=prov, query_rewrite=True,
                        transcript_fallback_enabled=False)
        q = asyncio.run(p._rewrite_query("and its complexity?", [
            {"role": "user", "content": "explain huffman coding"}, {"role": "assistant", "content": "..."}]))
        assert q == "time complexity of Huffman coding"

    def test_rewrite_failure_falls_back(self):
        prov = MagicMock()
        prov.generate = MagicMock(side_effect=RuntimeError("down"))
        from pipeline.rag import RAGPipeline

        p = RAGPipeline(retrieval_service=MagicMock(), generation_provider=prov, query_rewrite=True,
                        transcript_fallback_enabled=False)
        q = asyncio.run(p._rewrite_query("and its complexity?", [{"role": "user", "content": "huffman"}]))
        assert q == "huffman\nand its complexity?"


class TestMMR:
    def test_quota_and_diversity(self):
        rel = [1.0, 0.99, 0.98, 0.5]
        vecs = [[1, 0], [1, 0], [1, 0], [0, 1]]
        docs = ["a", "a", "a", "b"]
        picked = mmr_select(rel, vecs, 3, lam=0.7, doc_ids=docs, max_per_document=2)
        assert picked[0] == 0 and 3 in picked and len([i for i in picked if docs[i] == "a"]) <= 2


class TestOpenCodeProvider:
    def _provider(self):
        from generation.llm_service import OpenCodeProvider

        with patch("generation.llm_service.get_opencode_api_key", return_value="k"), \
             patch("generation.llm_service.get_groq_api_key", return_value="g"):
            return OpenCodeProvider(models=["deepseek-v4.1-flash"], groq_models=["openai/gpt-oss-120b"])

    def test_chain_and_headers(self):
        p = self._provider()
        assert p.models == ["deepseek-v4.1-flash", "openai/gpt-oss-120b"]
        kw = p._request_kwargs("deepseek-v4.1-flash", "s", "u", [{"role": "user", "content": "hi"}])
        assert kw["extra_headers"]["x-opencode-session"].startswith("fullrag-")
        assert p._client_for("openai/gpt-oss-120b") is p._client
        assert p._client_for("deepseek-v4.1-flash") is p._oc_client

    def test_falls_back_to_groq(self):
        import httpx
        import openai

        p = self._provider()
        req = httpx.Request("POST", "https://x")
        p._oc_client.chat = MagicMock()
        p._oc_client.chat.completions.create = MagicMock(
            side_effect=openai.RateLimitError("limit", response=httpx.Response(429, request=req), body=None))
        ok = MagicMock()
        c = MagicMock(); c.message.content = "groq answer"; c.finish_reason = "stop"
        ok.choices = [c]; ok.usage.prompt_tokens = 1; ok.usage.completion_tokens = 1; ok.usage.total_tokens = 2
        p._client.chat = MagicMock()
        p._client.chat.completions.create = MagicMock(return_value=ok)
        out = p.generate("s", "u", GenerationConfig())
        assert out.text == "groq answer" and out.model == "openai/gpt-oss-120b"
