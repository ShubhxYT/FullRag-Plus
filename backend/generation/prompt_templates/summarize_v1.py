"""Summarization prompt template v1."""

from generation.models import PromptVariant, RenderedPrompt
from retrieval.models import RetrievalResult

VERSION = "summarize_v2"  # v2: numeric [n] citations

SYSTEM_PROMPT = """\
You are a summarization assistant. Your task is to produce a clear, concise \
summary of the provided context documents.

Rules:
1. Summarize ONLY the information present in the provided context.
2. Organize the summary logically, grouping related information together.
3. Cite sources inline with the bracketed Source number, e.g. [1] or [2][3] \
(plain square brackets only).
4. Keep the summary focused and avoid unnecessary repetition. Use Markdown \
headings and bullet lists where helpful.
5. Do NOT add a separate "Sources" list; the interface shows the sources.\
"""

USER_TEMPLATE = """\
Context:
{context_block}

Request: {query}

Provide a clear summary based on the context above.\
"""


def render(
    query: str,
    context_chunks: list[RetrievalResult],
) -> RenderedPrompt:
    """Render the summarization prompt with context chunks.

    Args:
        query: The user's summarization request.
        context_chunks: Retrieved chunks to summarize.

    Returns:
        RenderedPrompt with system and user prompts.
    """
    context_parts: list[str] = []
    for i, chunk in enumerate(context_chunks, 1):
        source_label = chunk.document_title or chunk.source_path
        page_info = ""
        if chunk.page_numbers:
            pages = ", ".join(str(p) for p in chunk.page_numbers)
            page_info = f", Page {pages}"
        header = f"[Source {i}: {source_label}{page_info}]"
        context_parts.append(f"{header}\n{chunk.text}")

    context_block = "\n\n---\n\n".join(context_parts)

    return RenderedPrompt(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=USER_TEMPLATE.format(
            context_block=context_block,
            query=query,
        ),
        variant=PromptVariant.SUMMARIZE,
        version=VERSION,
    )
