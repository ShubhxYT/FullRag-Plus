"""Document-aware helpers for retrieval.

* ``contextual_text`` - what gets embedded for a chunk: the document name and
  section path in front of the chunk text, so questions that only name a
  document ("my modules", "module 5", "the internship letter") can match it.
* ``match_documents`` - which documents a question names explicitly.
* ``is_overview`` - "list all the topics / summarize" style questions that
  need a document outline rather than five similar chunks.
* ``outline_from_chunks`` - the headings of a document, in order.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from pathlib import PurePath

# Tag stored in chunk_embeddings.embedding_model for vectors built from
# contextual_text (vs. the bare chunk text used before).
CONTEXT_VERSION = "ctx1"

_STOP = {
    "the", "a", "an", "of", "to", "in", "and", "or", "for", "is", "are", "i", "my", "me", "what",
    "which", "all", "list", "should", "cover", "do", "does", "how", "with", "on", "from", "by", "be",
    "it", "this", "that", "these", "those", "you", "your", "pdf", "docx", "doc", "md", "html", "htm",
    "file", "files", "document", "documents", "about", "tell", "give", "please", "can", "there",
}


def _split_name(stem: str) -> list[str]:
    """'Module5_IntroToCV' -> ['module', '5', 'intro', 'to', 'cv']."""
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", stem)
    s = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", s)
    s = re.sub(r"([A-Za-z])(\d)", r"\1 \2", s)
    s = re.sub(r"(\d)([A-Za-z])", r"\1 \2", s)
    return [t for t in re.split(r"[^A-Za-z0-9]+", s.lower()) if t]


def document_stem(source_path: str) -> str:
    name = PurePath(source_path or "").name
    return re.sub(r"\.[A-Za-z0-9]{1,5}$", "", name) or name


def display_name(source_path: str) -> str:
    """'Module5_IntroToCV.pdf' -> 'Module 5 Intro To CV'."""
    stem = document_stem(source_path)
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", stem)
    s = re.sub(r"([A-Za-z])(\d)", r"\1 \2", s)
    s = re.sub(r"[_\-]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _informative_title(title: str | None, source_path: str) -> str | None:
    if not title or re.fullmatch(r"tmp[a-z0-9_]{5,}", title, re.I):
        return None
    if _split_name(title) == _split_name(document_stem(source_path)):
        return None
    return title.strip()


def contextual_text(
    text: str,
    source_path: str,
    title: str | None = None,
    section_path: Sequence[str] | None = None,
) -> str:
    """Text to embed for a chunk: document name, title, section, then the chunk."""
    head = f"Document: {display_name(source_path)}"
    t = _informative_title(title, source_path)
    if t:
        head += f" ({t})"
    sections = [s for s in (section_path or []) if s and s.strip()]
    if sections:
        head += "\nSection: " + " > ".join(s.strip() for s in sections[-3:])
    return f"{head}\n\n{text}"


def _query_tokens(query: str) -> list[str]:
    toks = [t for t in re.split(r"[^a-z0-9]+", query.lower()) if t]
    out = []
    for t in toks:
        # 'module5' -> 'module', '5'
        m = re.fullmatch(r"([a-z]+)(\d+)", t)
        if m:
            out.extend([m.group(1), m.group(2)])
            continue
        if len(t) > 4 and t.endswith("s") and not t.endswith("ss"):
            t = t[:-1]
        out.append(t)
    return out


def match_documents(query: str, documents: Iterable[tuple[str, str]]) -> list[str]:
    """IDs of documents the question refers to by name.

    ``documents`` is (id, source_path). Two conservative rules:
      * series names: "module 5" -> the doc whose name starts with module+5;
        "modules" / "my module" -> every doc whose name starts with "module".
      * full names: every meaningful word of the file name is in the question
        (e.g. "internship letter", "nsmbw posts tomorrow").
    Returns [] when nothing (or every document) matches.
    """
    docs = list(documents)
    if not docs:
        return []
    q = _query_tokens(query)
    qset = set(q)
    matched: list[str] = []

    for doc_id, source in docs:
        parts = _split_name(document_stem(source))
        alpha = [p for p in parts if not p.isdigit()]
        if not alpha:
            continue
        head = alpha[0]
        head_idx = parts.index(head)
        head_num = parts[head_idx + 1] if head_idx + 1 < len(parts) and parts[head_idx + 1].isdigit() else None

        hit = False
        if len(head) >= 4 and head not in _STOP and head in qset:
            # numbers mentioned shortly after the series word ("module 3 and 4")
            nums: set[str] = set()
            for i, t in enumerate(q):
                if t == head:
                    for u in q[i + 1 : i + 6]:
                        if u.isdigit():
                            nums.add(u.lstrip("0") or "0")
                        elif u not in ("and", "to", "or", "&"):
                            break
            if not nums:
                hit = True
            elif head_num is not None and (head_num.lstrip("0") or "0") in nums:
                hit = True

        if not hit:
            words = [p for p in parts if len(p) >= 3 and not p.isdigit() and p not in _STOP]
            # every meaningful word, or the last two for longer names
            # ("4 Shubh Somani _ Internship letter" <- "the internship letter")
            if len(words) >= 2 and (
                all(w in qset for w in words) or (len(words) >= 3 and all(w in qset for w in words[-2:]))
            ):
                hit = True

        if hit:
            matched.append(doc_id)

    return matched if len(matched) < len(docs) else []


_OVERVIEW = re.compile(
    r"\b(list|outline|overview|summari[sz]e|summary|syllabus|table of contents|toc)\b"
    r"|\b(what|which)\b[^?]{0,40}\b(topics?|chapters?|sections?|contents?|covered|cover|includes?)\b"
    r"|\b(all|main|key)\s+(the\s+)?(topics?|chapters?|sections?|concepts?)\b",
    re.I,
)


def is_overview(query: str) -> bool:
    """Questions about what documents cover, rather than a specific fact."""
    return bool(_OVERVIEW.search(query or ""))


_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$", re.M)


def outline_from_chunks(texts: Iterable[str], max_items: int = 40) -> list[str]:
    """Distinct headings in reading order (code comments and noise skipped)."""
    seen: set[str] = set()
    out: list[str] = []
    for text in texts:
        for m in _HEADING.finditer(text or ""):
            h = re.sub(r"\s+", " ", m.group(1)).strip(" :·•-*").replace("&amp;", "&")
            if not h or h.startswith("#") or len(h) > 90 or not re.search(r"[A-Za-z]{3}", h):
                continue
            key = h.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(h)
            if len(out) >= max_items:
                return out
    return out
