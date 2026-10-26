"""RAG endpoints (§33): ingest, query, stats and re-index."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body

from app.core.errors import ServiceError, success_response
from app.rag import pipeline

router = APIRouter(prefix="/ai/rag", tags=["rag"])


@router.post("/ingest")
async def ingest(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Chunks, embeds and indexes one document. Re-ingesting replaces it."""
    document_id = str(payload.get("documentId") or "").strip()
    content = str(payload.get("content") or "").strip()
    if not document_id or not content:
        raise ServiceError("Both 'documentId' and 'content' are required to index a document.")

    result = pipeline.ingest_document(
        document_id=document_id,
        title=str(payload.get("title") or "Untitled"),
        content=content,
        category=str(payload.get("category") or "CAREER_RESOURCE"),
        metadata={
            k: v
            for k, v in {
                "companyId": payload.get("companyId"),
                "roleId": payload.get("roleId"),
                "tags": payload.get("tags"),
                "provenance": payload.get("provenance", "DEMO"),
                "sourceUrls": payload.get("sourceUrls"),
            }.items()
            if v is not None
        },
    )
    return success_response(result)


@router.post("/ingest/bulk")
async def ingest_bulk(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Indexes many documents. A failure on one does not abort the rest."""
    documents = payload.get("documents", [])
    if not isinstance(documents, list) or not documents:
        raise ServiceError("'documents' must be a non-empty array.")

    results, failures = [], []
    for document in documents:
        try:
            results.append(
                pipeline.ingest_document(
                    document_id=str(document["documentId"]),
                    title=str(document.get("title", "Untitled")),
                    content=str(document["content"]),
                    category=str(document.get("category", "CAREER_RESOURCE")),
                    metadata={
                        k: v
                        for k, v in {
                            "companyId": document.get("companyId"),
                            "roleId": document.get("roleId"),
                            "tags": document.get("tags"),
                            "provenance": document.get("provenance", "DEMO"),
                        }.items()
                        if v is not None
                    },
                )
            )
        except (KeyError, TypeError, ValueError) as exc:
            failures.append({"documentId": document.get("documentId"), "error": str(exc)})

    return success_response({
        "indexed": len(results),
        "failed": len(failures),
        "results": results,
        "failures": failures,
        "stats": pipeline.stats(),
    })


@router.post("/query")
async def query(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Answers a question strictly from indexed, sourced context."""
    question = str(payload.get("question") or "").strip()
    if not question:
        raise ServiceError("A 'question' is required.")

    filters = {
        k: v
        for k, v in {
            "category": payload.get("category"),
            "companyId": payload.get("companyId"),
            "roleId": payload.get("roleId"),
        }.items()
        if v is not None
    }

    result = await pipeline.query(
        question,
        top_k=payload.get("topK"),
        filters=filters or None,
        min_relevance=payload.get("minRelevance"),
    )
    return success_response(result, {"ragSourceCount": len(result.get("sources", []))})


@router.post("/search")
async def search(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Retrieval only, with no generation. Useful for debugging the index."""
    hits = pipeline.retrieve(
        str(payload.get("query", "")),
        top_k=payload.get("topK"),
        filters=payload.get("filters"),
        min_relevance=payload.get("minRelevance"),
    )
    return success_response({
        "hits": [
            {
                "documentId": h.document_id,
                "chunkIndex": h.chunk_index,
                "score": round(h.score, 4),
                "title": h.metadata.get("title"),
                "category": h.metadata.get("category"),
                "snippet": h.text[:400],
            }
            for h in hits
        ],
        "count": len(hits),
    })


@router.delete("/documents/{document_id}")
async def delete_document(document_id: str) -> dict[str, Any]:
    removed = pipeline.delete_document(document_id)
    return success_response({"documentId": document_id, "chunksRemoved": removed})


@router.get("/stats")
async def stats() -> dict[str, Any]:
    return success_response(pipeline.stats())


@router.post("/clear")
async def clear() -> dict[str, Any]:
    """Empties the index. The Node gateway re-ingests from MongoDB afterwards."""
    pipeline.clear_index()
    return success_response({"cleared": True, "stats": pipeline.stats()})
