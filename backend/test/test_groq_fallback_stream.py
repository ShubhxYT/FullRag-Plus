"""Tests for Groq model fallback, reasoning stripping, streaming and /query/stream."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import openai
from fastapi.testclient import TestClient

from generation.llm_service import GroqProvider, _strip_reasoning
from generation.models import GenerationConfig, GenerationResponse, TokenUsage
from pipeline.models import LatencyBreakdown, RAGResponse, SourceCitation


def _provider(models):
    with patch("generation.llm_service.get_groq_api_key", return_value="k"), patch(
        "generation.llm_service.get_groq_base_url", return_value="https://fake"
    ):
        return GroqProvider(models=models)


def _completion(text, model="m"):
    r = MagicMock()
    c = MagicMock()
    c.message.content = text
    c.finish_reason = "stop"
    r.choices = [c]
    r.usage.prompt_tokens = 1
    r.usage.completion_tokens = 2
    r.usage.total_tokens = 3
    return r


def _not_found():
    req = httpx.Request("POST", "https://fake/chat/completions")
    resp = httpx.Response(404, request=req)
    return openai.NotFoundError("model_not_found", response=resp, body=None)


def test_strip_reasoning():
    assert _strip_reasoning("<think>hmm</think>\nAnswer [1]") == "Answer [1]"


def test_falls_back_when_model_missing():
    p = _provider(["dead-model", "good-model"])
    p._client.chat.completions.create = MagicMock(
        side_effect=[_not_found(), _completion("ok")]
    )
    out = p.generate("s", "u", GenerationConfig())
    assert out.text == "ok"
    assert out.model == "good-model"
    assert p._client.chat.completions.create.call_count == 2


def test_history_is_sent_between_system_and_user():
    p = _provider(["m"])
    p._client.chat.completions.create = MagicMock(return_value=_completion("ok"))
    p.generate("sys", "q2", GenerationConfig(), history=[
        {"role": "user", "content": "q1"},
        {"role": "assistant", "content": "a1"},
        {"role": "bogus", "content": "x"},
    ])
    msgs = p._client.chat.completions.create.call_args.kwargs["messages"]
    assert [m["role"] for m in msgs] == ["system", "user", "assistant", "user"]
    assert msgs[-1]["content"] == "q2"


def _chunk(text=None, finish=None, usage=None):
    ch = MagicMock()
    ch.usage = usage
    if text is None and finish is None:
        ch.choices = []
    else:
        choice = MagicMock()
        choice.delta.content = text
        choice.finish_reason = finish
        ch.choices = [choice]
    return ch


def test_stream_yields_deltas_then_response_and_falls_back():
    p = _provider(["dead", "live"])
    usage = MagicMock(prompt_tokens=5, completion_tokens=6, total_tokens=11)
    p._client.chat.completions.create = MagicMock(side_effect=[
        _not_found(),
        iter([_chunk("Hello "), _chunk("world"), _chunk(finish="stop"), _chunk(usage=usage)]),
    ])
    items = list(p.generate_stream("s", "u", GenerationConfig()))
    assert items[:2] == ["Hello ", "world"]
    final = items[-1]
    assert isinstance(final, GenerationResponse)
    assert final.text == "Hello world" and final.model == "live"
    assert final.token_usage.total_tokens == 11


@patch("api.routes.query._log_query", return_value="log-1")
@patch("api.routes.query._get_pipeline")
def test_stream_endpoint_ndjson(mock_get_pipeline, _mock_log):
    from api.main import app

    src = SourceCitation(source_path="a.md", chunk_summary="", similarity_score=0.9, snippet="x")
    resp = RAGResponse(
        answer="Hi [1]", sources=[src], latency=LatencyBreakdown(total_ms=1.0),
        token_usage=TokenUsage(), prompt_version="qa_v2", model="m",
    )

    async def fake_stream(**kwargs):
        assert kwargs["history"] == [{"role": "user", "content": "earlier"}]
        yield {"type": "sources", "sources": [src], "prompt_version": "qa_v2"}
        yield {"type": "delta", "text": "Hi "}
        yield {"type": "delta", "text": "[1]"}
        yield {"type": "done", "response": resp}

    pipeline = MagicMock()
    pipeline.stream_query = fake_stream
    mock_get_pipeline.return_value = pipeline

    client = TestClient(app)
    r = client.post("/query/stream", json={
        "question": "q", "history": [{"role": "user", "content": "earlier"}],
    })
    assert r.status_code == 200
    events = [json.loads(line) for line in r.text.splitlines() if line]
    assert [e["type"] for e in events] == ["sources", "delta", "delta", "done"]
    assert events[-1]["query_log_id"] == "log-1"
    assert events[-1]["model"] == "m"


@patch("api.routes.query._get_pipeline")
def test_stream_endpoint_reports_errors(mock_get_pipeline):
    from api.main import app

    async def boom(**kwargs):
        raise RuntimeError("Error code: 429 rate limit")
        yield  # pragma: no cover

    pipeline = MagicMock()
    pipeline.stream_query = boom
    mock_get_pipeline.return_value = pipeline
    r = TestClient(app).post("/query/stream", json={"question": "q"})
    events = [json.loads(line) for line in r.text.splitlines() if line]
    assert events[-1]["type"] == "error"
    assert "rate-limited" in events[-1]["detail"]
