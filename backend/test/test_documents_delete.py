"""Tests for DELETE /documents/{id} and POST /documents/delete.

The integration tests need the PostgreSQL + pgvector database from
pgvector.yaml (they are skipped when it is not reachable).
"""

import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text

from api.main import app
from api.routes import documents as documents_route
from api.routes import upload as upload_route
from database.connection import get_session
from database.models import ChunkEmbeddingModel, ChunkModel, DocumentModel

client = TestClient(app)


def _db_available() -> bool:
    try:
        s = get_session()
        try:
            s.execute(text("SELECT 1 FROM documents LIMIT 1"))
        finally:
            s.close()
        return True
    except Exception:
        return False


needs_db = pytest.mark.skipif(not _db_available(), reason="PostgreSQL not reachable")


def _insert_doc(n_chunks: int = 2, output_dir: str | None = None) -> str:
    doc_id = str(uuid.uuid4())
    s = get_session()
    try:
        s.add(
            DocumentModel(
                id=doc_id,
                title="delete-test",
                source_path=f"delete-test-{doc_id}.md",
                format="md",
                metadata_={"output_dir": output_dir} if output_dir else {},
            )
        )
        s.flush()
        for i in range(n_chunks):
            cid = str(uuid.uuid4())
            s.add(ChunkModel(id=cid, document_id=doc_id, text=f"chunk {i}", position=i))
            s.flush()
            s.add(
                ChunkEmbeddingModel(
                    chunk_id=cid, embedding=[0.01] * 768, embedding_model="test"
                )
            )
        s.commit()
    finally:
        s.close()
    return doc_id


def _counts(doc_id: str) -> tuple[int, int, int]:
    s = get_session()
    try:
        docs = s.execute(
            select(func.count()).select_from(DocumentModel).where(DocumentModel.id == doc_id)
        ).scalar_one()
        chunks = s.execute(
            select(func.count()).select_from(ChunkModel).where(ChunkModel.document_id == doc_id)
        ).scalar_one()
        embs = s.execute(
            select(func.count())
            .select_from(ChunkEmbeddingModel)
            .join(ChunkModel, ChunkModel.id == ChunkEmbeddingModel.chunk_id)
            .where(ChunkModel.document_id == doc_id)
        ).scalar_one()
        return docs, chunks, embs
    finally:
        s.close()


class TestDeleteValidation:
    def test_malformed_id_is_404(self):
        r = client.delete("/documents/not-a-uuid")
        assert r.status_code == 404

    def test_bulk_requires_ids(self):
        assert client.post("/documents/delete", json={"ids": []}).status_code == 422

    def test_processing_document_is_409(self):
        doc_id = str(uuid.uuid4())
        with upload_route._jobs_lock:
            upload_route._jobs["job-x"] = {
                "stage": "embedding", "progress": 80, "error": None, "document_id": doc_id,
            }
        try:
            assert client.delete(f"/documents/{doc_id}").status_code == 409
            r = client.post("/documents/delete", json={"ids": [doc_id]})
            assert r.status_code == 409
        finally:
            with upload_route._jobs_lock:
                upload_route._jobs.pop("job-x", None)

    def test_artifacts_outside_root_are_kept(self, tmp_path, monkeypatch):
        root = tmp_path / "results"
        inside = root / "tmpabc"
        inside.mkdir(parents=True)
        (inside / "img.png").write_bytes(b"x")
        outside = tmp_path / "keep"
        outside.mkdir()
        monkeypatch.setattr(documents_route, "ARTIFACT_ROOT", root)
        documents_route._remove_artifacts([str(inside), str(outside), str(root)])
        assert not inside.exists()
        assert outside.exists() and root.exists()

    def test_cache_invalidated_on_delete(self):
        fake_session = MagicMock()
        row = MagicMock(id="11111111-1111-1111-1111-111111111111", metadata_={})
        fake_session.execute.return_value.all.return_value = [row]
        fake_session.execute.return_value.scalar_one.return_value = 3
        with patch.object(documents_route, "get_session", return_value=fake_session), patch(
            "api.routes.query.invalidate_response_cache"
        ) as inv:
            r = client.delete(f"/documents/{row.id}")
        assert r.status_code == 200
        assert r.json()["deleted"] == [row.id]
        fake_session.commit.assert_called_once()
        inv.assert_called_once()


@needs_db
class TestDeleteIntegration:
    def test_unknown_id_is_404(self):
        assert client.delete(f"/documents/{uuid.uuid4()}").status_code == 404

    def test_delete_removes_chunks_embeddings_and_files(self, tmp_path, monkeypatch):
        root = tmp_path / "results"
        art = root / "tmpdoc"
        art.mkdir(parents=True)
        (art / "page.md").write_text("x")
        monkeypatch.setattr(documents_route, "ARTIFACT_ROOT", root)

        doc_id = _insert_doc(3, output_dir=str(art))
        keep_id = _insert_doc(1)
        try:
            assert _counts(doc_id) == (1, 3, 3)
            r = client.delete(f"/documents/{doc_id}")
            assert r.status_code == 200, r.text
            assert r.json() == {"deleted": [doc_id], "not_found": [], "chunks_deleted": 3}
            assert _counts(doc_id) == (0, 0, 0)
            assert not art.exists()
            assert _counts(keep_id) == (1, 1, 1)
            assert client.delete(f"/documents/{doc_id}").status_code == 404
        finally:
            client.post("/documents/delete", json={"ids": [doc_id, keep_id]})

    def test_bulk_delete(self):
        a, b = _insert_doc(1), _insert_doc(2)
        missing = str(uuid.uuid4())
        r = client.post("/documents/delete", json={"ids": [a, b, missing, "junk"]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert sorted(body["deleted"]) == sorted([a, b])
        assert sorted(body["not_found"]) == sorted([missing, "junk"])
        assert body["chunks_deleted"] == 3
        assert _counts(a) == (0, 0, 0) and _counts(b) == (0, 0, 0)
