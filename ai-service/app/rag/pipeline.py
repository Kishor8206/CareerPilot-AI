"""Retrieval-augmented generation pipeline (§10).

    ingest -> chunk -> embed -> vector store
    query  -> retrieve -> relevance filter -> LLM with grounded context -> answer + sources

The relevance filter is the important part. Chunks scoring below
`RAG_MIN_RELEVANCE` are discarded, and if nothing survives, the pipeline returns
an explicit "no verified information" answer instead of asking the model to
improvise. That is what keeps the system from inventing a company's recruitment
policy.
"""
from __future__ import annotations

from typing import Any

from app.core.config import settings
from app.core.logging import get_logger
from app.rag.chunking import chunk_text
from app.rag.vector_store import SearchHit, get_vector_store
from app.services.llm import LlmMessage, get_llm

log = get_logger(__name__)

NO_CONTEXT_ANSWER = (
    "The knowledge base does not contain verified information on this. "
    "Rather than guess - particularly about a company's recruitment process - please confirm with the "
    "official careers page or your placement office. An administrator can add a sourced document to the "
    "knowledge base so this can be answered in future."
)

GROUNDED_SYSTEM_PROMPT = """[[TASK:rag.answer]]
You are the knowledge assistant inside CareerPilot AI, a university placement preparation platform.

STRICT RULES:
1. Answer ONLY from the CONTEXT provided. Never use outside knowledge.
2. If the context does not contain the answer, say so plainly. Do not speculate.
3. Never invent a company's eligibility criteria, salary, hiring rounds or policies.
4. Cite which context passage supports each claim by its [n] marker.
5. Be concise and practical - the reader is a student preparing for placements.

Respond with JSON: {"answer": string, "grounded": boolean, "insufficientContext": boolean}
"""


def ingest_document(
    document_id: str,
    title: str,
    content: str,
    category: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Chunks, embeds and indexes one document. Re-ingesting replaces it."""
    chunks = chunk_text(content, metadata={"documentId": document_id})
    if not chunks:
        return {"documentId": document_id, "chunkCount": 0, "indexed": False,
                "reason": "The document produced no chunks large enough to index."}

    full_metadata = {
        "title": title,
        "category": category,
        "documentId": document_id,
        **(metadata or {}),
    }
    count = get_vector_store().add(document_id, [c.text for c in chunks], full_metadata)

    log.info("Document indexed", extra={"documentId": document_id, "chunks": count, "category": category})
    return {"documentId": document_id, "chunkCount": count, "indexed": True}


def delete_document(document_id: str) -> int:
    return get_vector_store().delete_document(document_id)


def retrieve(
    query: str,
    *,
    top_k: int | None = None,
    filters: dict[str, Any] | None = None,
    min_relevance: float | None = None,
) -> list[SearchHit]:
    """Retrieves and relevance-filters context chunks."""
    top_k = top_k or settings.rag_top_k
    threshold = settings.effective_min_relevance if min_relevance is None else min_relevance

    hits = get_vector_store().search(query, top_k=top_k, filters=filters)
    kept = [h for h in hits if h.score >= threshold]

    log.debug(
        "Retrieval complete",
        extra={"query": query[:80], "retrieved": len(hits), "kept": len(kept), "threshold": threshold},
    )
    return kept


def _format_sources(hits: list[SearchHit]) -> list[dict[str, Any]]:
    return [
        {
            "documentId": hit.document_id,
            "title": hit.metadata.get("title", "Untitled document"),
            "chunkIndex": hit.chunk_index,
            "score": round(hit.score, 4),
            "snippet": hit.text[:280],
            "category": hit.metadata.get("category", "UNKNOWN"),
        }
        for hit in hits
    ]


async def query(
    question: str,
    *,
    top_k: int | None = None,
    filters: dict[str, Any] | None = None,
    min_relevance: float | None = None,
) -> dict[str, Any]:
    """Answers a question strictly from indexed, sourced context."""
    hits = retrieve(question, top_k=top_k, filters=filters, min_relevance=min_relevance)

    if not hits:
        return {
            "answer": NO_CONTEXT_ANSWER,
            "grounded": False,
            "sources": [],
            "insufficientContext": True,
            "provider": get_llm().name,
            "model": settings.ai_model,
        }

    context_block = "\n\n".join(
        f"[{i + 1}] (source: {hit.metadata.get('title', 'document')})\n{hit.text}"
        for i, hit in enumerate(hits)
    )

    user_prompt = (
        f"QUESTION:\n{question}\n\n"
        f"CONTEXT:\n{context_block}\n\n"
        "Answer using only the context above.\n"
        "```json\n"
        + _context_json(question, hits)
        + "\n```"
    )

    llm = get_llm()
    try:
        payload, result = await llm.complete_json(
            [LlmMessage("system", GROUNDED_SYSTEM_PROMPT), LlmMessage("user", user_prompt)],
            temperature=0.1,
        )
    except Exception as exc:
        log.error("RAG generation failed", extra={"reason": str(exc)})
        # Retrieval succeeded, so return the sourced passages rather than nothing.
        return {
            "answer": (
                "The language model could not be reached, so here are the most relevant verified passages "
                "from the knowledge base:\n\n"
                + "\n\n".join(f"- {h.text[:400]}" for h in hits[:3])
            ),
            "grounded": True,
            "sources": _format_sources(hits),
            "insufficientContext": False,
            "degraded": True,
            "provider": llm.name,
            "model": settings.ai_model,
        }

    return {
        "answer": payload.get("answer", NO_CONTEXT_ANSWER),
        "grounded": bool(payload.get("grounded", True)),
        "sources": _format_sources(hits),
        "insufficientContext": bool(payload.get("insufficientContext", False)),
        "provider": result.provider,
        "model": result.model,
        "notice": result.notice,
    }


def _context_json(question: str, hits: list[SearchHit]) -> str:
    """Machine-readable context block consumed by the offline mock provider."""
    import json

    return json.dumps(
        {"question": question, "context": [{"text": h.text, "title": h.metadata.get("title")} for h in hits]}
    )


def stats() -> dict[str, Any]:
    return get_vector_store().stats()


def clear_index() -> None:
    get_vector_store().clear()
