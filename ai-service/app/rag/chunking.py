"""Document chunking for the RAG pipeline (§10).

Chunks respect sentence and paragraph boundaries rather than slicing at a fixed
character count. A chunk cut mid-sentence retrieves badly and reads badly when
cited back to the user, which defeats the point of showing sources.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.core.config import settings

SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'(])")
PARAGRAPH_BREAK = re.compile(r"\n\s*\n")


@dataclass
class Chunk:
    text: str
    index: int
    metadata: dict[str, Any]

    @property
    def char_count(self) -> int:
        return len(self.text)


def _split_sentences(text: str) -> list[str]:
    parts = SENTENCE_END.split(text.strip())
    return [p.strip() for p in parts if p.strip()]


def chunk_text(
    text: str,
    *,
    chunk_size: int | None = None,
    overlap: int | None = None,
    metadata: dict[str, Any] | None = None,
) -> list[Chunk]:
    """Splits `text` into overlapping, boundary-aligned chunks.

    Overlap carries the tail sentences of one chunk into the next so a fact
    stated across a boundary is retrievable from either side.
    """
    chunk_size = chunk_size or settings.rag_chunk_size
    overlap = overlap if overlap is not None else settings.rag_chunk_overlap
    metadata = metadata or {}

    text = text.strip()
    if not text:
        return []
    if len(text) <= chunk_size:
        return [Chunk(text=text, index=0, metadata=dict(metadata))]

    chunks: list[Chunk] = []
    current: list[str] = []
    current_len = 0

    # Paragraphs first: they are the strongest semantic boundary available.
    for paragraph in PARAGRAPH_BREAK.split(text):
        paragraph = paragraph.strip()
        if not paragraph:
            continue

        units = [paragraph] if len(paragraph) <= chunk_size else _split_sentences(paragraph)

        for unit in units:
            # A single sentence longer than the budget must still be broken up.
            if len(unit) > chunk_size:
                words = unit.split()
                buffer: list[str] = []
                for word in words:
                    if sum(len(w) + 1 for w in buffer) + len(word) > chunk_size and buffer:
                        chunks.append(Chunk(" ".join(buffer), len(chunks), dict(metadata)))
                        buffer = []
                    buffer.append(word)
                if buffer:
                    current.append(" ".join(buffer))
                    current_len += sum(len(w) + 1 for w in buffer)
                continue

            if current_len + len(unit) + 1 > chunk_size and current:
                chunks.append(Chunk(" ".join(current), len(chunks), dict(metadata)))
                # Carry the tail of the previous chunk forward as overlap.
                tail: list[str] = []
                tail_len = 0
                for previous in reversed(current):
                    if tail_len + len(previous) > overlap:
                        break
                    tail.insert(0, previous)
                    tail_len += len(previous) + 1
                current = tail
                current_len = tail_len

            current.append(unit)
            current_len += len(unit) + 1

    if current:
        chunks.append(Chunk(" ".join(current), len(chunks), dict(metadata)))

    # Drop fragments too small to carry meaning.
    return [c for c in chunks if len(c.text) >= 40]
