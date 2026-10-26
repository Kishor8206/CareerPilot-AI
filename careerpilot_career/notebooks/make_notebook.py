"""Generates CareerPilot_Career_Roadmap_FineTune.ipynb.   python notebooks/make_notebook.py

The notebook is a build artefact of this file, so it can be reviewed and
syntax-checked as ordinary Python.
"""
import ast
import json
from pathlib import Path

CELLS: list[tuple[str, str]] = []


def md(text: str) -> None:
    CELLS.append(("markdown", text.strip("\n")))


def code(text: str) -> None:
    CELLS.append(("code", text.strip("\n")))


md("""
# CareerPilot Career Roadmap — QLoRA fine-tuning of Qwen3-1.7B

A **separate** model from the CareerPilot ATS model: different base model, its own Drive folder
(`MyDrive/careerpilot_career/`), no shared weights or checkpoints.

**Before you start**
1. Runtime → Change runtime type → **T4 GPU**.
2. Upload `careerpilot_career_colab.zip` (built by `package_for_colab.py`) to `MyDrive/careerpilot_career/`.

**If Colab disconnects:** re-run cells 1–14, then cell 15. It finds the newest valid checkpoint on Drive and
resumes. Checkpoints are saved every 50 steps and the latest three are kept.

`RUN_SIZE` in cell 3 sets how much to train. Measured on a T4, training takes about 6.6 seconds per example:

| RUN_SIZE | Examples | Learning updates | Time on a T4 |
|---|---|---|---|
| `"quick"` | 600 | ~150 | about 1 hour |
| `"medium"` (default) | 1,500 | ~375 | about 3 hours |
| `"full"` | 7,157 × 2 epochs | ~3,500 | about 26 hours, across several sessions |

The first run of this notebook (v1) used 600 examples with only 37 updates and did not learn the output format
(valid JSON 52%, schema-valid 7%). This version updates the model four times as often for the same compute, and
writes to a new run folder so v1 is kept.
""")

md("## Cell 1 — Install dependencies")
code("""
%pip install -q "unsloth==2026.9.12"
%pip install -q pydantic-settings httpx
import torch, sys
print("python", sys.version.split()[0], "| torch", torch.__version__, "| CUDA available:", torch.cuda.is_available())
assert torch.cuda.is_available(), "No GPU. Runtime > Change runtime type > T4 GPU, then re-run."
""")

md("## Cell 2 — Mount Google Drive")
code("""
from google.colab import drive
drive.mount("/content/drive")
""")

md("""
## Cell 3 — Configure paths

Code and data unpack to fast local disk. Checkpoints, logs, evaluation and the final adapter go to Drive, in a
folder that is not, and must not be, the ATS folder.
""")
code("""
import os, sys, zipfile, pathlib, json

RUN_SIZE = "medium"       # "quick" (600 examples), "medium" (1,500), or "full" (everything, 2 epochs)
SIZES = {"quick": (600, 1, 40, 60), "medium": (1500, 1, 60, 100), "full": (0, 2, 80, 200)}
MAX_TRAIN, EPOCHS, EVAL_EXAMPLES, EVAL_LIMIT = SIZES[RUN_SIZE]   # train examples, epochs, validation examples, test examples
QUICK_RUN = RUN_SIZE != "full"

DRIVE = pathlib.Path("/content/drive/MyDrive/careerpilot_career")
RUN = DRIVE / "runs" / "career-roadmap-qwen3-1.7b-v2"      # v1 (37 updates) is kept, not overwritten
WORK = pathlib.Path("/content/careerpilot_career")
ZIP = DRIVE / "careerpilot_career_colab.zip"
assert ZIP.exists(), f"Upload careerpilot_career_colab.zip to {DRIVE}"
assert "careerpilot_ats" not in str(RUN), "The career model must not use the ATS directory"

if not (WORK / "training").exists():
    zipfile.ZipFile(ZIP).extractall("/content")
os.chdir(WORK)
sys.path[:0] = [str(WORK / "training"), "/content/ai-service"]
os.environ["PYTHONPATH"] = f"{WORK / 'training'}:/content/ai-service"
print("code + data:", WORK)
print("run directory (Drive):", RUN)
""")

md("## Cell 4 — Load datasets (source data and manifest)")
code("""
manifest = json.load(open(WORK / "data/knowledge/data_source_manifest.json"))
for s in manifest["sources"]:
    print(f"- {s['source']} | version {s['version']} | licence: {s['license'][:70]}")
print("O*NET archive present:", (WORK / "data/raw/onet/db_31_0_text.zip").exists())
print("ESCO occupations cached:", len(list((WORK / "data/raw/esco").glob("*.json"))))
""")

md("## Cell 5 — Build the knowledge base (canonical skill taxonomy)")
code("""
!python training/build_skill_taxonomy.py
""")

md("## Cell 6 — Normalise skills (self-checks: JS → JavaScript; Java, JavaScript, TypeScript stay distinct)")
code("""
!python training/normalize_skills.py
""")

md("## Cell 7 — Build the prerequisite graph and the career-role knowledge")
code("""
!python training/build_skill_graph.py
!python training/build_career_knowledge.py
""")

md("""
## Cell 8 — Build the fine-tuning dataset

Deterministic (fixed seed), so this reproduces the dataset that was validated locally. The resource catalogue
is shipped pre-verified; it is not re-fetched here.
""")
code("""
!python training/build_training_dataset.py --n 10000
""")

md("## Cell 9 — Validate the dataset. Training must not start if this fails.")
code("""
import subprocess
r = subprocess.run([sys.executable, "training/validate_dataset.py", "--samples", "1"], capture_output=True, text=True)
print(r.stdout[-6000:])
assert r.returncode == 0, "Dataset failed validation. Do not train.\\n" + r.stderr[-2000:]
""")

md("## Cell 10 — Split the dataset (by learner profile; two roles held out for testing)")
code("""
!python training/split_dataset.py
print(json.dumps(json.load(open(WORK / "data/dataset_version.json")), indent=2))
""")

md("""
## Cell 11 — Load Qwen3-1.7B in 4-bit

If the model cannot be loaded this stops. No other model is substituted.
""")
code("""
import train
from train_utils import find_latest_checkpoint

dirs = train.run_dirs(RUN)
plan = train.gpu_plan(4096)
# Update the model every 4 examples instead of every 16. v1 made only 37 updates from 600 examples, which was
# too few to learn the output format; this gives four times as many updates for the same amount of computation.
plan["accumulate"] = max(1, 4 // plan["batch"])
print("effective batch:", plan["batch"] * plan["accumulate"])
try:
    model, tokenizer, path = train.load_model(plan["max_length"])
except Exception as exc:
    raise SystemExit(f"STOP: could not load {train.BASE_MODEL}: {type(exc).__name__}: {exc}")
tokenizer = train.prepare_tokenizer(tokenizer)
print("loaded via:", path, "| eos:", tokenizer.eos_token, "| pad:", tokenizer.pad_token)
""")

md("## Cell 12 — Configure LoRA / QLoRA")
code("""
model = train.add_lora(model, path, r=16, alpha=32, dropout=0.05)
trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
total = sum(p.numel() for p in model.parameters())
print(f"trainable {trainable/1e6:.1f}M of {total/1e6:.0f}M parameters ({100*trainable/total:.2f}%)")
""")

md("""
## Cell 13 — Create the trainer

Examples are tokenised as *prompt + answer* with the prompt masked from the loss, and the prompt is rendered
with thinking disabled — exactly as it is at inference.
""")
code("""
train_ds, eval_ds, dropped = train.build_datasets(tokenizer, plan["max_length"], max_train=MAX_TRAIN,
                                                  eval_examples=EVAL_EXAMPLES)
trainer = train.build_trainer(model, tokenizer, train_ds, eval_ds, dirs, plan, path,
                              epochs=EPOCHS, lr=1e-4, save_steps=50)
""")

md("## Cell 14 — Detect a checkpoint")
code("""
resume = find_latest_checkpoint(dirs["checkpoints"])
""")

md("## Cell 15 — Train (or resume)")
code("""
import time
t0 = time.time()
result = trainer.train(resume_from_checkpoint=resume)
minutes = (time.time() - t0) / 60
print(result.metrics)
print(f"peak GPU memory: {torch.cuda.max_memory_allocated()/1e9:.2f} GB | {minutes:.1f} min")
""")

md("## Cell 16 — Save the final adapter (LoRA only, not a merged model) and the loss curve")
code("""
metadata = train.save_final(trainer, model, tokenizer, dirs, plan, path, train_metrics=result.metrics, minutes=minutes,
                            resumed_from=resume, epochs=EPOCHS, quick=QUICK_RUN, dropped=dropped)
import matplotlib.pyplot as plt
log = json.load(open(dirs["logs"] / "training_log.json"))
tr = [(r["step"], r["loss"]) for r in log if "loss" in r]
ev = [(r["step"], r["eval_loss"]) for r in log if "eval_loss" in r]
plt.figure(figsize=(7, 4))
if tr: plt.plot(*zip(*tr), label="training loss", alpha=.7)
if ev: plt.plot(*zip(*ev), "o-", label="validation loss")
plt.xlabel("step"); plt.ylabel("loss"); plt.legend(); plt.grid(alpha=.3); plt.title("Career Roadmap QLoRA")
plt.savefig(dirs["logs"] / "loss_curve.png", dpi=150, bbox_inches="tight"); plt.show()
""")

md("""
## Cell 17 — Evaluate

Generates on held-out test examples with the fine-tuned model **and** the untuned base model (the same weights
with the adapter switched off), then scores both on the 13 metrics. Results are reported separately for roles
seen in training and for the two roles held out of it.
""")
code("""
import gc
del trainer, model
gc.collect(); torch.cuda.empty_cache()

!python training/evaluate.py generate --adapter "{dirs['final']}" --out "{dirs['evaluation']}" --limit {EVAL_LIMIT}
!python training/evaluate.py score --pred "finetuned={dirs['evaluation']}/pred_finetuned.jsonl" --pred "base={dirs['evaluation']}/pred_base.jsonl" --out "{dirs['evaluation']}"
!python training/evaluate.py human-sheet --pred "finetuned={dirs['evaluation']}/pred_finetuned.jsonl" --out "{dirs['evaluation']}"
""")

md("""
## Cell 18 — Run the inference tests

The ten required profiles and the final example, through the real pipeline with the fine-tuned model:
validation, repair, retry and fallback included. Each result says whether it came from the model, was
repaired, or fell back to the deterministic planner.
""")
code("""
os.environ["CAREER_MODEL_PROVIDER"] = "local"
os.environ["CAREER_MODEL_ADAPTER_PATH"] = str(dirs["final"])
!python training/inference_test.py --out "{dirs['inference']}"
""")

md("## Cell 19 — Export model metadata")
code("""
print(json.dumps(json.load(open(dirs["final"] / "model_metadata.json")), indent=2))
print("\\nfinal adapter files:", sorted(p.name for p in dirs["final"].iterdir()))
import shutil
shutil.make_archive(str(DRIVE / "career_roadmap_final_adapter"), "zip", dirs["final"])
print("adapter archive:", DRIVE / "career_roadmap_final_adapter.zip")
print("evaluation table:", dirs["evaluation"] / "evaluation_table.md")
""")


def build() -> None:
    for kind, src in CELLS:
        if kind == "code":
            ast.parse("\n".join(line for line in src.splitlines() if not line.lstrip().startswith(("%", "!"))))
    nb = {"nbformat": 4, "nbformat_minor": 5,
          "metadata": {"accelerator": "GPU", "colab": {"gpuType": "T4", "provenance": []},
                       "kernelspec": {"name": "python3", "display_name": "Python 3"}, "language_info": {"name": "python"}},
          "cells": []}
    for i, (kind, src) in enumerate(CELLS):
        cell = {"cell_type": kind, "metadata": {}, "source": src.splitlines(keepends=True), "id": f"c{i:02d}"}
        if kind == "code":
            cell.update(execution_count=None, outputs=[])
        nb["cells"].append(cell)
    out = Path(__file__).with_name("CareerPilot_Career_Roadmap_FineTune.ipynb")
    out.write_text(json.dumps(nb, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out.name}: {sum(k == 'code' for k, _ in CELLS)} code cells, all syntax-checked")


if __name__ == "__main__":
    build()
