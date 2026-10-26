"""Shared paths and helpers for the career-roadmap training scripts.

Each script in this folder runs on its own:  python training/<script>.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]            # careerpilot_career/
REPO = ROOT.parent
DATA = ROOT / "data"
RAW, KNOWLEDGE, GENERATED, VALIDATED = DATA / "raw", DATA / "knowledge", DATA / "generated", DATA / "validated"
MODELS = ROOT / "models" / "career_roadmap"
# Compiled knowledge the AI service loads at runtime (single source for training and serving).
RUNTIME = REPO / "ai-service" / "app" / "career" / "data"

for _p in (str(REPO / "ai-service"), str(Path(__file__).resolve().parent)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

DATASET_VERSION = "career-sft-v1"
PREPROCESSING_VERSION = "career-prep-v1"


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def publish(name: str, obj: Any) -> None:
    """Write a knowledge file to data/knowledge AND to the AI service runtime copy."""
    write_json(KNOWLEDGE / name, obj)
    write_json(RUNTIME / name, obj)
