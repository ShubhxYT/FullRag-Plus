"""Overview prompt: one context entry per document (summary + headings)."""

from generation.models import PromptVariant, RenderedPrompt
from retrieval.models import RetrievalResult

VERSION = "overview_v1"

SYSTEM_PROMPT = """\
You answer questions about what a set of documents covers. The context has \
one entry per document: its summary and/or its section headings (or notes \
extracted from it), in file-name order.

Rules:
1. Use ONLY the context. Go through EVERY document entry; do not skip any.
2. Organise the answer the way the user asks (e.g. by module/unit). When \
documents belong to a module or overlap (a course module deck and separate \
topic handouts), group them under that module and say which documents back \
each part; put documents that fit no group in their own section.
3. Keep the documents' own names for modules, units and topics.
4. Cite with the bracketed Source number, e.g. [3] or [2][5], after each \
item. Plain square brackets only.
5. Use Markdown headings and bullet lists. No separate "Sources" list at the end.
6. Earlier conversation turns may be included to resolve follow-ups; still \
answer only from the context."""

USER_TEMPLATE = """\
Context ({n} documents):
{context_block}

Question: {query}

Answer from every document above, citing sources.\
"""


def render(query: str, context_chunks: list[RetrievalResult]) -> RenderedPrompt:
    parts = []
    for i, chunk in enumerate(context_chunks, 1):
        label = chunk.document_title or chunk.source_path
        parts.append(f"[Source {i}: {label}]\n{chunk.text}")
    return RenderedPrompt(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=USER_TEMPLATE.format(
            n=len(context_chunks), context_block="\n\n---\n\n".join(parts), query=query
        ),
        variant=PromptVariant.OVERVIEW,
        version=VERSION,
    )
