"""Training helpers that need no GPU, so they can be tested on any machine.

  find_latest_checkpoint  resume logic for interrupted Colab sessions
  encode_example          tokenisation with the prompt masked out of the loss
  load_split / to_dataset data loading
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from common import DATA

from app.career.prompts import render

_CKPT = re.compile(r"^checkpoint-(\d+)$")
# A usable checkpoint has trainer state (to resume the schedule) and adapter weights.
_WEIGHTS = ("adapter_model.safetensors", "adapter_model.bin")


def checkpoint_is_valid(path: Path) -> bool:
    """Colab can die mid-save. A checkpoint counts only if its state file
    parses and its adapter weights exist and are non-empty."""
    state = path / "trainer_state.json"
    if not state.is_file():
        return False
    try:
        if "global_step" not in json.loads(state.read_text(encoding="utf-8")):
            return False
    except (json.JSONDecodeError, OSError):
        return False
    return any((path / w).is_file() and (path / w).stat().st_size > 0 for w in _WEIGHTS)


def find_latest_checkpoint(checkpoint_dir: str | Path, verbose: bool = True) -> str | None:
    """Newest VALID checkpoint by training step, or None.

    Half-written checkpoints are skipped with a message, so a crash during the
    most recent save falls back to the one before it instead of failing.
    """
    root = Path(checkpoint_dir)
    found = []
    if root.is_dir():
        for child in root.iterdir():
            match = _CKPT.match(child.name)
            if match and child.is_dir():
                found.append((int(match.group(1)), child))
    for step, path in sorted(found, reverse=True):
        if checkpoint_is_valid(path):
            if verbose:
                print(f"Resuming from checkpoint-{step}.")
            return str(path)
        if verbose:
            print(f"Skipping checkpoint-{step}: incomplete or corrupt.")
    if verbose:
        print("No checkpoint found. Starting fresh.")
    return None


def load_split(name: str, limit: int = 0) -> list[dict[str, Any]]:
    rows = [json.loads(line) for line in open(DATA / name / "career_sft.jsonl", encoding="utf-8")]
    return rows[:limit] if limit else rows


def encode_example(tokenizer: Any, messages: list[dict[str, str]], max_length: int) -> dict[str, list[int]] | None:
    """-> input_ids, attention_mask, labels; or None if it does not fit.

    The prompt is rendered exactly as at inference (thinking disabled, ending
    in the assistant header) and its tokens are masked with -100, so the loss
    covers only the JSON answer and the end-of-turn token. The ids are built
    as prompt ids + answer ids, which makes the training prompt identical to
    the serving prompt by construction rather than by assumption.

    Examples longer than max_length are DROPPED, never truncated: truncation
    would cut off the end of the JSON the model is supposed to learn.
    """
    prompt = render(tokenizer, messages[:2], add_generation_prompt=True)
    prompt_ids = tokenizer(prompt, add_special_tokens=False)["input_ids"]
    answer_ids = tokenizer(messages[2]["content"] + tokenizer.eos_token, add_special_tokens=False)["input_ids"]
    if len(prompt_ids) + len(answer_ids) > max_length:
        return None
    return {"input_ids": prompt_ids + answer_ids, "attention_mask": [1] * (len(prompt_ids) + len(answer_ids)),
            "labels": [-100] * len(prompt_ids) + answer_ids}


def to_dataset(tokenizer: Any, rows: list[dict[str, Any]], max_length: int):
    from datasets import Dataset
    encoded, dropped = [], 0
    for r in rows:
        e = encode_example(tokenizer, r["messages"], max_length)
        if e is None:
            dropped += 1
        else:
            encoded.append(e)
    return Dataset.from_list(encoded), dropped
