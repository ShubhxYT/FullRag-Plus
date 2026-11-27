"""Per-document summaries.

Written once per document (at ingest, or by the backfill below) and used to
answer overview / "list everything" questions without pulling every chunk.

Backfill (only writes documents.summary*; never touches chunks/embeddings):
    python -m ingestion.summaries --missing           # fill documents without one
    python -m ingestion.summaries --missing --dry-run # show what would be done
"""

from __future__ import annotations

import argparse
import re

from observability.logging import get_logger

logger = get_logger(__name__)

_IMG_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)|\S+\.(?:png|jpe?g|gif|webp)\)")

SUMMARY_SYSTEM_PROMPT = """\
You write compact study summaries of one document for a retrieval system.
Use ONLY the document text. Output Markdown in exactly this shape:

Overview: <2-3 sentences: what the document is and what it covers>

Topics:
- <main topic or module/unit, in the document's order>: <comma-separated subtopics>
- ...

Rules: keep the document's own names for modules/units/chapters (e.g. \
"Module 3: Greedy Method"); list every main topic, 4-25 bullets; no \
preamble, no closing remarks, no citations."""


def clean_text(text: str) -> str:
    """Chunk text without image links and runaway whitespace."""
    text = _IMG_RE.sub("", text or "")
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def document_text(chunks, max_tokens: int | None = None) -> str:
    """Reading-order text of a document's chunks, cut to max_tokens."""
    from generation.context_manager import ContextManager

    parts: list[str] = []
    used = 0
    for c in chunks:
        t = clean_text(c.text)
        if not t:
            continue
        n = ContextManager.count_tokens(t)
        if max_tokens is not None and used + n > max_tokens:
            break
        parts.append(t)
        used += n
    return "\n\n".join(parts)


def summarize_text(name: str, text: str, provider=None) -> tuple[str, str]:
    """(summary, model) for one document's text."""
    from config.settings import get_generation_provider
    from generation.llm_service import get_generation_provider as make_provider
    from generation.models import GenerationConfig

    provider = provider or make_provider(get_generation_provider())
    resp = provider.generate(
        SUMMARY_SYSTEM_PROMPT,
        f"Document: {name}\n\n<document>\n{text}\n</document>",
        GenerationConfig(temperature=0.2, max_output_tokens=4000),
    )
    return resp.text.strip(), resp.model


def summarize_document(document_id: str, provider=None, max_tokens: int = 60000) -> bool:
    """Summarize one stored document and save it. True when a summary was written."""
    from database.connection import get_session
    from database.models import DocumentModel
    from database.repository import DocumentRepository
    from retrieval.doc_routing import display_name

    repo = DocumentRepository()
    session = get_session()
    try:
        doc = session.get(DocumentModel, document_id)
        if doc is None:
            return False
        chunks = repo.get_chunks_by_document(session, document_id)
        text = document_text(chunks, max_tokens=max_tokens)
        name = display_name(doc.source_path)
    finally:
        session.close()
    if not text:
        return False
    summary, model = summarize_text(name, text, provider)
    if not summary:
        return False
    session = get_session()
    try:
        ok = DocumentRepository().set_document_summary(session, document_id, summary, model)
        session.commit()
        return ok
    finally:
        session.close()


def backfill_missing(provider=None, dry_run: bool = False) -> int:
    """Summarize every document that has none. Returns how many were written."""
    from database.connection import get_session
    from database.repository import DocumentRepository

    session = get_session()
    try:
        missing = DocumentRepository().documents_missing_summary(session)
    finally:
        session.close()
    logger.info("Summary backfill: %d documents without a summary", len(missing))
    if dry_run or not missing:
        return 0
    if provider is None:
        from config.settings import get_generation_provider
        from generation.llm_service import get_generation_provider as make_provider

        provider = make_provider(get_generation_provider())
    written = 0
    for doc_id in missing:
        try:
            if summarize_document(doc_id, provider):
                written += 1
        except Exception as exc:  # one bad document must not stop the rest
            logger.warning("Summary for %s failed: %s", doc_id, exc)
    logger.info("Summary backfill: wrote %d/%d", written, len(missing))
    return written


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--missing", action="store_true", help="summarize documents without a summary")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not args.missing:
        ap.error("nothing to do (use --missing)")
    n = backfill_missing(dry_run=args.dry_run)
    print(f"summaries written: {n}")


if __name__ == "__main__":
    main()
