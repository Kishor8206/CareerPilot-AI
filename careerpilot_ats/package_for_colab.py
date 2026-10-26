"""Build careerpilot_ats_colab.zip: exactly what the Colab notebook needs.

    python package_for_colab.py

Contents: the ats_pipeline package, the prepared dataset splits, label and
tokenizer config, and the minimal ai-service modules the grounding guard and
evaluator import (the skill taxonomy and the deterministic ATS engine).

Deliberately EXCLUDED: raw/ (the downloaded source datasets — ~400 MB and not
ours to redistribute), and anything in ai-service unrelated to ATS scoring.
"""
from __future__ import annotations

import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
OUT = HERE / "careerpilot_ats_colab.zip"

AI_SERVICE_MODULES = [
    "app/__init__.py",
    "app/core/__init__.py", "app/core/config.py", "app/core/logging.py",
    "app/nlp/__init__.py", "app/nlp/resume_parser.py", "app/nlp/skills_taxonomy.py",
    "app/services/__init__.py", "app/services/ats.py",
    "app/ats_model/__init__.py", "app/ats_model/prompts.py", "app/ats_model/schemas.py",
    "app/ats_model/scoring.py", "app/ats_model/normalize.py", "app/ats_model/validation.py",
]


def main() -> None:
    files: list[tuple[Path, str]] = []
    for p in sorted((HERE / "ats_pipeline").glob("*.py")):
        files.append((p, f"careerpilot_ats/ats_pipeline/{p.name}"))
    for name in ("ats_train.jsonl", "ats_validation.jsonl", "ats_test.jsonl", "human_review.csv"):
        p = HERE / "dataset" / name
        if not p.exists():
            raise SystemExit(f"missing {p} — run `python -m ats_pipeline.build_dataset` first")
        files.append((p, f"careerpilot_ats/dataset/{name}"))
    for p in (HERE / "config").rglob("*"):
        if p.is_file():
            files.append((p, f"careerpilot_ats/config/{p.relative_to(HERE / 'config').as_posix()}"))
    for rel in AI_SERVICE_MODULES:
        p = REPO / "ai-service" / rel
        if not p.exists():
            raise SystemExit(f"missing ai-service module {rel}")
        # Placed beside ats_pipeline: ats_pipeline/__init__.py finds it there.
        files.append((p, f"careerpilot_ats/ai-service/{rel}"))

    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for src, arc in files:
            z.write(src, arc)
    size = OUT.stat().st_size / 1e6
    print(f"wrote {OUT.name}: {len(files)} files, {size:.1f} MB")
    print("upload it to Google Drive at MyDrive/careerpilot_ats/, then open the notebook in Colab.")


if __name__ == "__main__":
    main()
