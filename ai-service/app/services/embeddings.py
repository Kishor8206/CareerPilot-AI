"""Embedding providers for the RAG pipeline (§10).

Three interchangeable backends:

`hash`                  - the default. A deterministic, dependency-free
                          hashed-bag-of-words projection with sub-word shingles
                          and IDF-style down-weighting of common tokens. It is
                          not a semantic model, but it is genuinely useful for
                          the lexical retrieval this corpus needs, needs no
                          network, and makes the whole RAG path demonstrable
                          offline.
`sentence-transformers` - real semantic embeddings from a local model.
`openai`                - hosted embedding API.

Everything downstream depends only on `embed_texts()`, so switching backends is
a configuration change.
"""
from __future__ import annotations

import hashlib
import math
import re
from typing import Any

import numpy as np

from app.core.config import settings
from app.core.errors import ProviderError
from app.core.logging import get_logger

log = get_logger(__name__)

TOKEN_RE = re.compile(r"[a-z0-9#+.]+")

# Very common English words carry no retrieval signal; down-weighting them
# stops every chunk looking similar to every query.
STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "if", "then", "than", "of", "to", "in",
    "on", "for", "with", "as", "at", "by", "from", "is", "are", "was", "were",
    "be", "been", "being", "this", "that", "these", "those", "it", "its", "we",
    "you", "your", "our", "their", "they", "he", "she", "will", "would", "can",
    "could", "should", "may", "might", "must", "have", "has", "had", "do", "does",
    "did", "not", "no", "so", "such", "into", "about", "over", "also", "more",
}


def _tokenize(text: str) -> list[str]:
    return [t for t in TOKEN_RE.findall(text.lower()) if len(t) > 1 and t not in STOPWORDS]


class HashEmbedder:
    """Deterministic hashed feature projection.

    Each token is hashed into `dimension` buckets. Character trigrams are added
    for words longer than five characters so that morphological variants
    ("interview"/"interviews"/"interviewing") land in overlapping buckets, and
    token weight decays with corpus-independent frequency heuristics.
    """

    name = "hash"

    def __init__(self, dimension: int = 384) -> None:
        self.dimension = dimension

    def _bucket(self, token: str, salt: str = "") -> int:
        digest = hashlib.md5(f"{salt}{token}".encode()).digest()
        return int.from_bytes(digest[:4], "big") % self.dimension

    def _sign(self, token: str) -> float:
        # Signed hashing halves the collision bias of pure additive hashing.
        return 1.0 if hashlib.md5(token.encode()).digest()[4] % 2 == 0 else -1.0

    def embed(self, text: str) -> np.ndarray:
        vector = np.zeros(self.dimension, dtype=np.float32)
        tokens = _tokenize(text)
        if not tokens:
            return vector

        counts: dict[str, int] = {}
        for token in tokens:
            counts[token] = counts.get(token, 0) + 1

        for token, count in counts.items():
            # Sub-linear term frequency: the 10th occurrence matters far less
            # than the 1st.
            weight = (1.0 + math.log(count)) * self._sign(token)
            vector[self._bucket(token)] += weight

            if len(token) > 5:
                for i in range(len(token) - 2):
                    trigram = token[i : i + 3]
                    vector[self._bucket(trigram, salt="tri:")] += weight * 0.25

        norm = float(np.linalg.norm(vector))
        return vector / norm if norm > 0 else vector

    def embed_batch(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dimension), dtype=np.float32)
        return np.vstack([self.embed(t) for t in texts])


class SentenceTransformerEmbedder:
    name = "sentence-transformers"

    def __init__(self, model_name: str = "all-MiniLM-L6-v2") -> None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise ProviderError(
                "EMBEDDING_PROVIDER=sentence-transformers requires the sentence-transformers package. "
                "Install it with: pip install -r ai-service/requirements-optional.txt"
            ) from exc
        self._model = SentenceTransformer(model_name)
        self.dimension = int(self._model.get_sentence_embedding_dimension())

    def embed(self, text: str) -> np.ndarray:
        return np.asarray(self._model.encode(text, normalize_embeddings=True), dtype=np.float32)

    def embed_batch(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dimension), dtype=np.float32)
        return np.asarray(self._model.encode(texts, normalize_embeddings=True), dtype=np.float32)


class OpenAiEmbedder:
    name = "openai"

    def __init__(self) -> None:
        if not settings.ai_api_key:
            raise ProviderError("EMBEDDING_PROVIDER=openai requires AI_API_KEY.")
        self.dimension = 1536
        self._base = (settings.ai_base_url or "https://api.openai.com/v1").rstrip("/")

    def _request(self, texts: list[str]) -> np.ndarray:
        import httpx

        response = httpx.post(
            f"{self._base}/embeddings",
            headers={"Authorization": f"Bearer {settings.ai_api_key}"},
            json={"model": settings.ai_embedding_model, "input": texts},
            timeout=60.0,
        )
        response.raise_for_status()
        payload = response.json()["data"]
        vectors = np.asarray([item["embedding"] for item in payload], dtype=np.float32)
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return vectors / norms

    def embed(self, text: str) -> np.ndarray:
        return self._request([text])[0]

    def embed_batch(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dimension), dtype=np.float32)
        # The API caps batch size; 96 keeps requests comfortably under it.
        chunks = [texts[i : i + 96] for i in range(0, len(texts), 96)]
        return np.vstack([self._request(chunk) for chunk in chunks])


Embedder = HashEmbedder | SentenceTransformerEmbedder | OpenAiEmbedder

_embedder: Any = None


def get_embedder() -> Any:
    """Returns the configured embedder, degrading to the offline hash embedder."""
    global _embedder
    if _embedder is not None:
        return _embedder

    provider = settings.embedding_provider.lower().strip()
    try:
        if provider == "sentence-transformers":
            _embedder = SentenceTransformerEmbedder()
        elif provider == "openai":
            _embedder = OpenAiEmbedder()
        else:
            _embedder = HashEmbedder(settings.embedding_dimension)
    except ProviderError as exc:
        log.warning(
            "Embedding provider unavailable; falling back to the offline hash embedder.",
            extra={"configured": provider, "reason": str(exc)},
        )
        _embedder = HashEmbedder(settings.embedding_dimension)

    log.info("Embedder ready", extra={"provider": _embedder.name, "dimension": _embedder.dimension})
    return _embedder


def embed_texts(texts: list[str]) -> np.ndarray:
    return get_embedder().embed_batch(texts)


def embed_text(text: str) -> np.ndarray:
    return get_embedder().embed(text)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity for pre-normalised vectors, guarded against zeros."""
    denominator = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denominator == 0:
        return 0.0
    return float(np.dot(a, b) / denominator)


def reset_embedder() -> None:
    global _embedder
    _embedder = None
