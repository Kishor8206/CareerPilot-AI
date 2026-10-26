"""Build careerpilot_career_colab.zip: what the Colab notebook needs, and nothing else.

    python package_for_colab.py

Included: the training scripts, the curated knowledge, the O*NET archive and
cached ESCO responses, the verified resource catalogue, the prepared splits,
and the AI-service modules the career code imports.

Deliberately EXCLUDED
  * .env and every secret — the YouTube API key never leaves this machine;
  * data/raw/youtube (raw API responses) and anything under careerpilot_ats/;
  * the ATS model code (ai-service/app/ats_model): this model does not use it.
The script scans the finished archive for key-shaped strings and fails if it finds one.
"""
from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
OUT = HERE / "careerpilot_career_colab.zip"

AI_SERVICE = ["app/__init__.py", "app/core/__init__.py", "app/core/config.py", "app/core/logging.py",
              "app/nlp/__init__.py", "app/nlp/skills_taxonomy.py", "app/career/__init__.py"]
SECRET = re.compile(rb"AIza[0-9A-Za-z_\-]{30,}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----")


def main() -> None:
    files: list[tuple[Path, str]] = []
    for p in sorted((HERE / "training").glob("*.py")):
        files.append((p, f"careerpilot_career/training/{p.name}"))
    for sub in ("knowledge", "train", "validation", "test"):
        for p in sorted((HERE / "data" / sub).rglob("*")):
            if p.is_file():
                files.append((p, f"careerpilot_career/data/{sub}/{p.relative_to(HERE / 'data' / sub).as_posix()}"))
    for name in ("dataset_manifest.json", "dataset_version.json"):
        files.append((HERE / "data" / name, f"careerpilot_career/data/{name}"))
    files.append((HERE / "data/raw/onet/db_31_0_text.zip", "careerpilot_career/data/raw/onet/db_31_0_text.zip"))
    for p in sorted((HERE / "data/raw/esco").glob("*.json")):
        files.append((p, f"careerpilot_career/data/raw/esco/{p.name}"))
    for rel in AI_SERVICE:
        files.append((REPO / "ai-service" / rel, f"ai-service/{rel}"))
    for p in sorted((REPO / "ai-service/app/career").rglob("*")):
        if p.is_file() and "__pycache__" not in p.parts and p.name != "__init__.py":
            files.append((p, f"ai-service/app/career/{p.relative_to(REPO / 'ai-service/app/career').as_posix()}"))
    # The skill recommender artefact gives job-demand evidence to build_career_knowledge.py.
    rec = REPO / "ai-service/artifacts/skill_recommender.json"
    if rec.exists():
        files.append((rec, "ai-service/artifacts/skill_recommender.json"))

    missing = [str(src) for src, _ in files if not src.exists()]
    if missing:
        sys.exit("missing files — build the dataset first:\n  " + "\n  ".join(missing[:8]))

    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for src, arc in files:
            z.write(src, arc)

    leaks = []
    with zipfile.ZipFile(OUT) as z:
        names = z.namelist()
        for name in names:
            if name.endswith((".zip", ".safetensors")):
                continue
            if SECRET.search(z.read(name)):
                leaks.append(name)
    forbidden = [n for n in names if ".env" in n.split("/")[-1] or "ats_model" in n or "careerpilot_ats" in n or "raw/youtube" in n]
    if leaks or forbidden:
        OUT.unlink()
        sys.exit(f"REFUSING to package: secrets in {leaks} / forbidden paths {forbidden}")
    print(f"wrote {OUT.name}: {len(files)} files, {OUT.stat().st_size / 1e6:.1f} MB")
    print("secret scan: clean | no .env, no ATS model code, no raw YouTube responses")
    print("upload it to Google Drive at MyDrive/careerpilot_career/")


if __name__ == "__main__":
    main()
