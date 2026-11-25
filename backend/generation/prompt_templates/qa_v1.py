"""Standard Q&A prompt template v1."""

from generation.models import PromptVariant, RenderedPrompt
from retrieval.models import RetrievalResult

VERSION = "qa_v2"  # v2: numeric [n] citations rendered as chips by the UI

SYSTEM_PROMPT = """\
You are a knowledgeable assistant that answers questions based exclusively on \
the provided context documents.

Rules:
1. Answer ONLY based on the information in the provided context. Do not use \
any prior knowledge or make assumptions beyond what is stated.
2. If the context does not contain enough information to fully answer the \
question, clearly state what information is available and what is missing.
3. Cite sources inline with the bracketed Source number from the context, \
e.g. "Polymers are long chains [1]." or "[2][3]". Only cite numbers that exist. \
Use plain square brackets, not other citation styles such as 【1†L1-L3】.
4. Be concise and direct. Use Markdown (short paragraphs, bullet lists, \
**bold** for key terms, tables when comparing) where it helps readability.
5. Do NOT add a separate "Sources" list at the end; the interface shows the \
sources next to your answer.
6. Earlier conversation turns may be included to resolve follow-up \
questions ("it", "that approach"); still answer only from the context.\
"""

USER_TEMPLATE = """\
Context:
{context_block}

Question: {query}

Provide a detailed answer based on the context above, citing sources.\
"""


def render(
    query: str,
    context_chunks: list[RetrievalResult],
) -> RenderedPrompt:
    """Render the Q&A prompt with context chunks.

    Args:
        query: The user's question.
        context_chunks: Retrieved chunks to include as context.

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
        variant=PromptVariant.QA,
        version=VERSION,
    )
