"""Tests for document-aware retrieval helpers and routing."""

from unittest.mock import AsyncMock, MagicMock

import asyncio

import pytest

from retrieval.doc_routing import (
    contextual_text,
    display_name,
    is_overview,
    match_documents,
    outline_from_chunks,
)
from retrieval.models import RetrievalResponse, RetrievalResult

DOCS = [
    ("m3", "Module3_FeatureExtraction.pdf"),
    ("m4", "Module4_PDF.pdf"),
    ("m5", "Module5_IntroToCV.pdf"),
    ("m6", "Module6_Applications.docx"),
    ("cv", "Shubh_Somani_CV_2026.pdf"),
    ("letter", "4 Shubh Somani _ Internship letter.pdf"),
    ("dip", "Digital Image Processing Solutions.pdf"),
    ("nsmbw", "nsmbw-posts-tomorrow.md"),
    ("s1", "Sample1_CV.docx"),
]


class TestNames:
    def test_display_name(self):
        assert display_name("Module5_IntroToCV.pdf") == "Module 5 Intro To CV"
        assert display_name("nsmbw-posts-tomorrow.md") == "nsmbw posts tomorrow"

    def test_contextual_text(self):
        t = contextual_text("Edges are...", "Module3_FeatureExtraction.pdf", "Module3_FeatureExtraction", ["A", "Edge detection"])
        assert t.startswith("Document: Module 3 Feature Extraction\nSection: A > Edge detection\n\nEdges are")

    def test_contextual_text_skips_temp_title_keeps_real_one(self):
        assert "tmpab" not in contextual_text("x", "letter.pdf", "tmpabc123")
        assert "(Advantages of AR)" in contextual_text("x", "Module6_Applications.docx", "Advantages of AR")


class TestMatchDocuments:
    @pytest.mark.parametrize(
        "q,expected",
        [
            ("list all the topics i should cover in my modules", {"m3", "m4", "m5", "m6"}),
            ("what topics are in module 5", {"m5"}),
            ("summarize module5", {"m5"}),
            ("compare module 3 and 4", {"m3", "m4"}),
            ("what does the internship letter say", {"letter"}),
            ("feature extraction", {"m3"}),  # name of Module3_FeatureExtraction
            ("image processing techniques", set()),
            ("what is edge detection", set()),
        ],
    )
    def test_cases(self, q, expected):
        assert set(match_documents(q, DOCS)) == expected

    def test_everything_matching_means_no_filter(self):
        assert match_documents("modules", [("a", "Module1.pdf"), ("b", "Module2.pdf")]) == []


class TestOverview:
    @pytest.mark.parametrize("q", ["list all the topics i should cover in my modules", "what topics are covered in module 4",
                                   "summarize the CV", "give me an overview of module 6", "main topics of feature extraction"])
    def test_overview(self, q):
        assert is_overview(q)

    @pytest.mark.parametrize("q", ["what is the sobel operator", "how does k-means segmentation work", "port of the debugger"])
    def test_not_overview(self, q):
        assert not is_overview(q)

    def test_outline(self):
        texts = ["![Image](a.png)\n## Feature Extraction\n## Edge detection\n## # Load image\n", "## Edge detection\n## Sobel Operator:\n"]
        assert outline_from_chunks(texts) == ["Feature Extraction", "Edge detection", "Sobel Operator"]


def _result(doc_id, score, source):
    return RetrievalResult(chunk_id=f"c-{doc_id}-{score}", text="t", summary="", document_id=doc_id,
                           source_path=source, similarity_score=score)


class TestPipelineRouting:
    def _pipeline(self, results):
        from pipeline.rag import RAGPipeline

        retrieval = MagicMock()
        retrieval.document_catalog = MagicMock(return_value=[(i, s, None) for i, s in DOCS])
        retrieval.retrieve = AsyncMock(return_value=RetrievalResponse(query="q", top_k=5, result_count=len(results), latency_ms=1, results=results))
        retrieval.document_outlines = MagicMock(side_effect=lambda ids, scores: [
            RetrievalResult(chunk_id=f"outline:{i}", text=f"Outline of {i}", summary="", document_id=i,
                            source_path=dict(DOCS)[i], similarity_score=scores.get(i, 0), match_type="outline") for i in ids])
        return RAGPipeline(retrieval_service=retrieval, generation_provider=MagicMock(), transcript_fallback_enabled=False), retrieval

    def test_overview_of_named_modules_uses_outlines(self):
        p, r = self._pipeline([_result("m5", 0.5, "Module5_IntroToCV.pdf")])
        results, routed = asyncio.run(p._route_and_retrieve("list all the topics i should cover in my modules", [], 5))
        assert routed
        assert [x.document_id for x in results] == ["m3", "m4", "m5", "m6"]
        # named documents are outlined directly, no similarity search needed
        assert not r.retrieve.called

    def test_named_document_filters_search(self):
        p, r = self._pipeline([_result("m5", 0.6, "Module5_IntroToCV.pdf")])
        results, routed = asyncio.run(p._route_and_retrieve("how does module 5 define computer vision", [], 5))
        assert routed and r.retrieve.call_args_list[0].kwargs["document_ids"] == ["m5"]
        assert results[0].document_id == "m5"

    def test_plain_question_caps_per_document(self):
        p, r = self._pipeline([_result("m3", 0.8, "Module3_FeatureExtraction.pdf")])
        _, routed = asyncio.run(p._route_and_retrieve("what is the sobel operator", [], 5))
        assert not routed
        assert r.retrieve.call_args.kwargs == {"top_k": 5, "max_per_document": 3, "candidates": 40}
