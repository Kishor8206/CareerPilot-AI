"""Vector store abstraction (§3, §10).

Backends:
  numpy  - default. An in-process index persisted to a .npz file. Exact cosine
           search. Ideal for a corpus of thousands of chunks and requires no
           extra dependency, so the RAG pipeline works out of the box.
  faiss  - FAISS IndexFlatIP for larger corpora.
  chroma - ChromaDB persistent collection.

All three implement the same `add`/`search`/`delete_document` contract, so
`VECTOR_DB_PROVIDER` is the only thing that changes.
"""
from __future__ import annotations

import abc
import json
import threading
from dataclasses import dataclass
from typing import Any

import numpy as np

from app.core.config import settings
from app.core.logging import get_logger
from app.services.embeddings import embed_texts, get_embedder

log = get_logger(__name__)


@dataclass
class SearchHit:
    document_id: str
    chunk_index: int
    text: str
    score: float
    metadata: dict[str, Any]


class VectorStore(abc.ABC):
    name = "base"

    @abc.abstractmethod
    def add(self, document_id: str, chunks: list[str], metadata: dict[str, Any]) -> int: ...

    @abc.abstractmethod
    def search(self, query: str, top_k: int, filters: dict[str, Any] | None = None) -> list[SearchHit]: ...

    @abc.abstractmethod
    def delete_document(self, document_id: str) -> int: ...

    @abc.abstractmethod
    def stats(self) -> dict[str, Any]: ...

    @abc.abstractmethod
    def clear(self) -> None: ...


def _matches(metadata: dict[str, Any], filters: dict[str, Any] | None) -> bool:
    """Metadata filter: a list value means 'any of'; None in a filter is ignored."""
    if not filters:
        return True
    for key, expected in filters.items():
        if expected is None:
            continue
        actual = metadata.get(key)
        if isinstance(expected, (list, tuple, set)):
            if actual not in expected:
                return False
        elif actual != expected:
            return False
    return True


class NumpyVectorStore(VectorStore):
    """Exact cosine-similarity index held in memory and persisted to disk."""

    name = "numpy"

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._vectors: np.ndarray = np.zeros((0, get_embedder().dimension), dtype=np.float32)
        self._records: list[dict[str, Any]] = []
        self._path = settings.vector_path / "numpy_index.npz"
        self._meta_path = settings.vector_path / "numpy_index_meta.json"
        self._load()

    def _load(self) -> None:
        try:
            if self._path.exists() and self._meta_path.exists():
                data = np.load(self._path)
                self._vectors = data["vectors"].astype(np.float32)
                self._records = json.loads(self._meta_path.read_text(encoding="utf-8"))
                # A dimension change (embedding provider swap) invalidates the index.
                if self._vectors.shape[0] and self._vectors.shape[1] != get_embedder().dimension:
                    log.warning("Embedding dimension changed; discarding the stale vector index.")
                    self.clear()
                    return
                log.info("Vector index loaded", extra={"chunks": len(self._records)})
        except Exception as exc:
            log.warning("Could not load the vector index; starting empty.", extra={"reason": str(exc)})
            self._vectors = np.zeros((0, get_embedder().dimension), dtype=np.float32)
            self._records = []

    def _persist(self) -> None:
        try:
            np.savez_compressed(self._path, vectors=self._vectors)
            self._meta_path.write_text(json.dumps(self._records), encoding="utf-8")
        except Exception as exc:
            log.error("Failed to persist the vector index", extra={"reason": str(exc)})

    def add(self, document_id: str, chunks: list[str], metadata: dict[str, Any]) -> int:
        if not chunks:
            return 0
        with self._lock:
            # Re-indexing a document replaces its chunks rather than duplicating.
            self.delete_document(document_id)
            vectors = embed_texts(chunks)
            self._vectors = np.vstack([self._vectors, vectors]) if self._vectors.size else vectors
            for i, chunk in enumerate(chunks):
                self._records.append(
                    {"documentId": document_id, "chunkIndex": i, "text": chunk, "metadata": metadata}
                )
            self._persist()
            return len(chunks)

    def search(self, query: str, top_k: int, filters: dict[str, Any] | None = None) -> list[SearchHit]:
        with self._lock:
            if not self._records or self._vectors.size == 0:
                return []

            query_vector = get_embedder().embed(query)
            scores = self._vectors @ query_vector

            # Filter first, then rank, so a narrow filter still returns top_k.
            eligible = [
                i for i, record in enumerate(self._records)
                if _matches(record.get("metadata", {}), filters)
            ]
            if not eligible:
                return []

            eligible_scores = scores[eligible]
            order = np.argsort(-eligible_scores)[: max(1, top_k)]

            return [
                SearchHit(
                    document_id=self._records[eligible[int(idx)]]["documentId"],
                    chunk_index=self._records[eligible[int(idx)]]["chunkIndex"],
                    text=self._records[eligible[int(idx)]]["text"],
                    score=float(eligible_scores[int(idx)]),
                    metadata=self._records[eligible[int(idx)]].get("metadata", {}),
                )
                for idx in order
            ]

    def delete_document(self, document_id: str) -> int:
        with self._lock:
            keep = [i for i, r in enumerate(self._records) if r["documentId"] != document_id]
            removed = len(self._records) - len(keep)
            if removed:
                self._vectors = self._vectors[keep] if keep else np.zeros((0, get_embedder().dimension), dtype=np.float32)
                self._records = [self._records[i] for i in keep]
                self._persist()
            return removed

    def stats(self) -> dict[str, Any]:
        with self._lock:
            documents = {r["documentId"] for r in self._records}
            categories: dict[str, int] = {}
            for record in self._records:
                category = record.get("metadata", {}).get("category", "UNKNOWN")
                categories[category] = categories.get(category, 0) + 1
            return {
                "provider": self.name,
                "documents": len(documents),
                "chunks": len(self._records),
                "dimension": int(self._vectors.shape[1]) if self._vectors.size else get_embedder().dimension,
                "byCategory": categories,
                "embeddingProvider": get_embedder().name,
            }

    def clear(self) -> None:
        with self._lock:
            self._vectors = np.zeros((0, get_embedder().dimension), dtype=np.float32)
            self._records = []
            self._persist()


class FaissVectorStore(VectorStore):
    """FAISS IndexFlatIP. Inner product on normalised vectors == cosine."""

    name = "faiss"

    def __init__(self) -> None:
        import faiss  # imported here so the dependency stays optional

        self._faiss = faiss
        self._lock = threading.RLock()
        self._dimension = get_embedder().dimension
        self._index = faiss.IndexFlatIP(self._dimension)
        self._records: list[dict[str, Any]] = []
        self._index_path = settings.vector_path / "faiss.index"
        self._meta_path = settings.vector_path / "faiss_meta.json"
        self._load()

    def _load(self) -> None:
        try:
            if self._index_path.exists() and self._meta_path.exists():
                self._index = self._faiss.read_index(str(self._index_path))
                self._records = json.loads(self._meta_path.read_text(encoding="utf-8"))
                log.info("FAISS index loaded", extra={"chunks": len(self._records)})
        except Exception as exc:
            log.warning("Could not load the FAISS index; starting empty.", extra={"reason": str(exc)})

    def _persist(self) -> None:
        try:
            self._faiss.write_index(self._index, str(self._index_path))
            self._meta_path.write_text(json.dumps(self._records), encoding="utf-8")
        except Exception as exc:
            log.error("Failed to persist the FAISS index", extra={"reason": str(exc)})

    def _rebuild(self, keep: list[int]) -> None:
        """FAISS IndexFlat has no stable delete, so the index is rebuilt."""
        vectors = np.zeros((0, self._dimension), dtype=np.float32)
        if keep:
            vectors = embed_texts([self._records[i]["text"] for i in keep])
        self._index = self._faiss.IndexFlatIP(self._dimension)
        if vectors.size:
            self._index.add(vectors)
        self._records = [self._records[i] for i in keep]

    def add(self, document_id: str, chunks: list[str], metadata: dict[str, Any]) -> int:
        if not chunks:
            return 0
        with self._lock:
            self.delete_document(document_id)
            vectors = embed_texts(chunks)
            self._index.add(vectors)
            for i, chunk in enumerate(chunks):
                self._records.append({"documentId": document_id, "chunkIndex": i, "text": chunk, "metadata": metadata})
            self._persist()
            return len(chunks)

    def search(self, query: str, top_k: int, filters: dict[str, Any] | None = None) -> list[SearchHit]:
        with self._lock:
            if not self._records:
                return []
            query_vector = get_embedder().embed(query).reshape(1, -1)
            # Over-fetch, because post-filtering can discard most of the top-k.
            fetch = min(len(self._records), max(top_k * 5, top_k))
            scores, indices = self._index.search(query_vector, fetch)

            hits: list[SearchHit] = []
            for score, idx in zip(scores[0], indices[0]):
                if idx < 0 or idx >= len(self._records):
                    continue
                record = self._records[int(idx)]
                if not _matches(record.get("metadata", {}), filters):
                    continue
                hits.append(SearchHit(record["documentId"], record["chunkIndex"], record["text"], float(score), record.get("metadata", {})))
                if len(hits) >= top_k:
                    break
            return hits

    def delete_document(self, document_id: str) -> int:
        with self._lock:
            keep = [i for i, r in enumerate(self._records) if r["documentId"] != document_id]
            removed = len(self._records) - len(keep)
            if removed:
                self._rebuild(keep)
                self._persist()
            return removed

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {
                "provider": self.name,
                "documents": len({r["documentId"] for r in self._records}),
                "chunks": len(self._records),
                "dimension": self._dimension,
                "embeddingProvider": get_embedder().name,
            }

    def clear(self) -> None:
        with self._lock:
            self._index = self._faiss.IndexFlatIP(self._dimension)
            self._records = []
            self._persist()


class ChromaVectorStore(VectorStore):
    name = "chroma"

    def __init__(self) -> None:
        import chromadb

        self._client = chromadb.PersistentClient(path=str(settings.vector_path / "chroma"))
        self._collection = self._client.get_or_create_collection(
            name="careerpilot_knowledge",
            metadata={"hnsw:space": "cosine"},
        )

    def add(self, document_id: str, chunks: list[str], metadata: dict[str, Any]) -> int:
        if not chunks:
            return 0
        self.delete_document(document_id)
        embeddings = embed_texts(chunks).tolist()
        self._collection.add(
            ids=[f"{document_id}::{i}" for i in range(len(chunks))],
            documents=chunks,
            embeddings=embeddings,
            # Chroma metadata values must be scalars.
            metadatas=[
                {**{k: v for k, v in metadata.items() if isinstance(v, (str, int, float, bool))},
                 "documentId": document_id, "chunkIndex": i}
                for i in range(len(chunks))
            ],
        )
        return len(chunks)

    def search(self, query: str, top_k: int, filters: dict[str, Any] | None = None) -> list[SearchHit]:
        where = {k: v for k, v in (filters or {}).items() if isinstance(v, (str, int, float, bool))} or None
        result = self._collection.query(
            query_embeddings=[get_embedder().embed(query).tolist()],
            n_results=max(1, top_k),
            where=where,
        )
        hits: list[SearchHit] = []
        documents = result.get("documents", [[]])[0]
        metadatas = result.get("metadatas", [[]])[0]
        distances = result.get("distances", [[]])[0]
        for text, meta, distance in zip(documents, metadatas, distances):
            hits.append(
                SearchHit(
                    document_id=str(meta.get("documentId", "")),
                    chunk_index=int(meta.get("chunkIndex", 0)),
                    text=text,
                    # Chroma returns cosine distance; convert to similarity.
                    score=float(1.0 - distance),
                    metadata=dict(meta),
                )
            )
        return hits

    def delete_document(self, document_id: str) -> int:
        try:
            self._collection.delete(where={"documentId": document_id})
            return 1
        except Exception:
            return 0

    def stats(self) -> dict[str, Any]:
        return {
            "provider": self.name,
            "chunks": self._collection.count(),
            "documents": None,
            "embeddingProvider": get_embedder().name,
        }

    def clear(self) -> None:
        self._client.delete_collection("careerpilot_knowledge")
        self._collection = self._client.get_or_create_collection(
            name="careerpilot_knowledge", metadata={"hnsw:space": "cosine"}
        )


_store: VectorStore | None = None


def get_vector_store() -> VectorStore:
    """Returns the configured store, degrading to numpy if a backend is missing."""
    global _store
    if _store is not None:
        return _store

    provider = settings.vector_db_provider.lower().strip()
    try:
        if provider == "faiss":
            _store = FaissVectorStore()
        elif provider == "chroma":
            _store = ChromaVectorStore()
        else:
            _store = NumpyVectorStore()
    except ImportError as exc:
        log.warning(
            "Configured vector database is not installed; falling back to the built-in numpy store.",
            extra={"configured": provider, "reason": str(exc)},
        )
        _store = NumpyVectorStore()

    log.info("Vector store ready", extra={"provider": _store.name})
    return _store


def reset_vector_store() -> None:
    global _store
    _store = None
