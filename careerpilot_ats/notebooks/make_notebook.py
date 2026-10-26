"""Generates CareerPilot_ATS_FineTune.ipynb from the cells below.

Keeping the notebook as Python source means it can be diffed, reviewed and
syntax-checked; the .ipynb is a build artefact.  python make_notebook.py
"""
import ast
import json
from pathlib import Path

CELLS: list[tuple[str, str]] = []


def md(text: str) -> None:
    CELLS.append(("markdown", text.strip("\n")))


def code(text: str) -> None:
    CELLS.append(("code", text.strip("\n")))


# =============================================================================
md("""
# CareerPilot ATS — QLoRA fine-tuning of Qwen3-4B-Instruct-2507

Fine-tunes one model for two modes (`GENERAL_ATS`, `JOB_MATCH_ATS`) that predicts **component scores and
evidence**. The final ATS score is always computed in Python from fixed weights — the model never decides it.

**Runtime:** Runtime → Change runtime type → **T4 GPU** (or better). Run cells top to bottom.

**Before you start:** upload `careerpilot_ats_colab.zip` (built locally by `package_for_colab.py`) to
`MyDrive/careerpilot_ats/`. Checkpoints are written to Drive, so a Colab disconnect loses at most one save
interval — re-running CELL 11 resumes.

Verified API assumptions (checked against the release wheels, not memory):
* Unsloth pins `trl<=0.24`; the plain-HF fallback gets TRL 1.x. Both expose `max_length` (not
  `max_seq_length`), `completion_only_loss`, and `processing_class` (not `tokenizer`).
* `warmup_ratio` does not exist in transformers 5.x — `warmup_steps` is used.
* A T4 cannot compute in bfloat16; precision is chosen at runtime.
""")

md("## CELL 1 — Environment and GPU detection")
code("""
import sys, platform, subprocess
print("python    ", sys.version.split()[0], "|", platform.platform())
import torch
print("torch     ", torch.__version__, "| CUDA", torch.version.cuda)
assert torch.cuda.is_available(), "No GPU. Runtime > Change runtime type > T4 GPU, then re-run."
props = torch.cuda.get_device_properties(0)
VRAM_GB = props.total_memory / 1e9
BF16 = torch.cuda.is_bf16_supported()
print(f"GPU        {props.name} | VRAM {VRAM_GB:.1f} GB | compute {props.major}.{props.minor} | bf16 {BF16}")
print(subprocess.run(["nvidia-smi", "--query-gpu=driver_version,memory.used,memory.total", "--format=csv"],
                     capture_output=True, text=True).stdout)
""")

md("""
## CELL 2 — Install dependencies

Unsloth is pinned to the version verified for this pipeline; it resolves compatible `transformers`/`trl`/`peft`.
If this cell fails, run **CELL 2b** instead — the rest of the notebook works on either path.
""")
code("""
%pip install -q "unsloth==2026.9.12"
%pip install -q "spacy==3.8.3" pydantic-settings scipy
!python -m spacy download en_core_web_sm -q
""")

md("### CELL 2b — Fallback: plain Hugging Face + PEFT + TRL (only if CELL 2 failed)")
code("""
# Uncomment ONLY if the Unsloth install failed.
# %pip install -q "transformers>=4.51.3" "trl>=0.24" "peft>=0.18" "bitsandbytes>=0.45.5" accelerate "datasets>=3.4.1,<4.4"
# %pip install -q "spacy==3.8.3" pydantic-settings scipy
# !python -m spacy download en_core_web_sm -q
""")

md("## CELL 3 — Verify versions and the exact APIs this notebook relies on")
code("""
import importlib
try:
    import unsloth  # must be imported before transformers/trl so its patches apply
    USE_UNSLOTH = True
except Exception as exc:
    print("Unsloth unavailable -> Hugging Face + PEFT fallback:", type(exc).__name__, exc)
    USE_UNSLOTH = False

VERSIONS = {}
for m in ["torch", "transformers", "trl", "peft", "bitsandbytes", "accelerate", "datasets", "unsloth"]:
    try:
        VERSIONS[m] = importlib.import_module(m).__version__
    except Exception:
        VERSIONS[m] = "not installed"
for k, v in VERSIONS.items():
    print(f"{k:<14}{v}")

from trl import SFTConfig, SFTTrainer
import inspect
fields = SFTConfig.__dataclass_fields__
assert "max_length" in fields, "this TRL has no SFTConfig.max_length"
assert "completion_only_loss" in fields, "this TRL cannot mask the prompt from the loss"
assert "processing_class" in inspect.signature(SFTTrainer.__init__).parameters
print("\\nAPI checks passed | path:", "Unsloth" if USE_UNSLOTH else "HF+PEFT")
""")

md("""
## CELL 4 — Mount Drive, unpack code and data

Code and data unpack to fast local disk; checkpoints and outputs go to Drive so they survive a disconnect.
""")
code("""
from google.colab import drive
drive.mount("/content/drive")
import os, zipfile, sys, pathlib
DRIVE = pathlib.Path("/content/drive/MyDrive/careerpilot_ats")
WORK = pathlib.Path("/content/careerpilot_ats")
ZIP = DRIVE / "careerpilot_ats_colab.zip"
assert ZIP.exists(), f"Upload careerpilot_ats_colab.zip to {DRIVE}"
if not (WORK / "ats_pipeline").exists():
    zipfile.ZipFile(ZIP).extractall(WORK.parent)
sys.path[:0] = [str(WORK), str(WORK / "ai-service")]

# Versioned output (§27). An unfinished run of this version RESUMES; a finished
# one is never overwritten — bump MODEL_VERSION to train again.
MODEL_VERSION = "careerpilot-ats-qwen3-4b-v1"
OUT = DRIVE / "runs" / MODEL_VERSION
if (OUT / "model" / "adapter" / "adapter_model.safetensors").exists():
    raise SystemExit(f"{MODEL_VERSION} is already trained at {OUT}. Set MODEL_VERSION to a new "
                     "version (e.g. ...-v2) to train again; previous versions are never overwritten.")
for d in ["model/adapter", "checkpoints", "evaluation", "inference", "config", "logs"]:
    (OUT / d).mkdir(parents=True, exist_ok=True)
print("code+data:", WORK, "| outputs:", OUT)
print(sorted(p.name for p in (WORK / "dataset").iterdir()))
""")

md("## CELL 5 — Load and inspect the dataset (§15). Training does not start if this fails.")
code("""
import json, statistics
from collections import Counter

def load(split):
    return [json.loads(l) for l in open(WORK / "dataset" / f"ats_{split}.jsonl", encoding="utf-8")]

data = {s: load(s) for s in ("train", "validation", "test")}
bad = []
for split, recs in data.items():
    modes = Counter(r["mode"] for r in recs)
    toks = [r["n_tokens"] for r in recs]
    print(f"{split:<11} n={len(recs):>5} | modes {dict(modes)} | tokens mean={statistics.mean(toks):.0f} "
          f"max={max(toks)} | fit {dict(Counter(r['fit_label'] for r in recs if r['fit_label']))}")
    for r in recs:
        m = r["messages"]
        if [x["role"] for x in m] != ["system", "user", "assistant"]:
            bad.append((r["id"], "roles"))
        try:
            json.loads(m[-1]["content"])
        except Exception:
            bad.append((r["id"], "assistant JSON"))
print("\\nmalformed records:", len(bad))
assert not bad, bad[:5]
ex = data["train"][0]
print("\\nexample target:", ex["messages"][-1]["content"][:400], "...")
""")

md("""
## CELL 6 — Auto-configure for this GPU (§13, §14, §30)

Sequence length, batch size and accumulation adapt to VRAM. The dataset was built for 3072 tokens; on a GPU
that cannot hold 3072, longer examples are **dropped, not truncated**, because truncating a prompt after its
label was computed would teach the model to cite text it cannot see.
""")
code("""
if VRAM_GB >= 38:   MAX_LEN, BS, GA = 4096, 4, 4     # A100 40/80 GB
elif VRAM_GB >= 22: MAX_LEN, BS, GA = 3072, 2, 8     # L4 / A10 24 GB
elif VRAM_GB >= 14: MAX_LEN, BS, GA = 3072, 1, 16    # T4 15 GB
else:               MAX_LEN, BS, GA = 2048, 1, 16    # small GPUs

CFG = {
    "base_model": "Qwen/Qwen3-4B-Instruct-2507",
    "unsloth_checkpoint": "unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit",
    "model_version": MODEL_VERSION,
    "dataset_version": json.load(open(WORK / "config" / "label_config.json")).get("dataset_version", "cp-ats-data-v1"),
    "label_version": json.load(open(WORK / "config" / "label_config.json"))["label_version"],
    "evaluation_version": "cp-ats-eval-v1",
    "max_length": MAX_LEN, "per_device_train_batch_size": BS, "gradient_accumulation_steps": GA,
    "effective_batch": BS * GA,
    "lora_r": 16, "lora_alpha": 32, "lora_dropout": 0.05,
    "target_modules": ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    "learning_rate": 1e-4, "num_train_epochs": 2, "warmup_steps": 10, "lr_scheduler_type": "cosine",
    "weight_decay": 0.01, "max_grad_norm": 1.0, "optim": "paged_adamw_8bit",
    "eval_steps": 25, "save_steps": 25, "early_stopping_patience": 3, "eval_subset": 150,
    "packing": False, "completion_only_loss": True,
    "precision": "bf16" if BF16 else "fp16", "seed": 42,
    "gpu": props.name, "vram_gb": round(VRAM_GB, 1), "versions": VERSIONS, "path": "unsloth" if USE_UNSLOTH else "hf",
}
# QUICK_RUN = True  -> a real but small run: 300 examples, 1 epoch (fits a short free-T4 session).
# QUICK_RUN = False -> the full run: every training example, 2 epochs (several hours on a T4).
# Either way the run is recorded in training_config.json, so results are reported for what was actually trained.
QUICK_RUN = True
MAX_TRAIN_EXAMPLES = 300 if QUICK_RUN else 0     # 0 = use everything
if QUICK_RUN:
    # ~18 optimiser steps in total, so evaluate/checkpoint every 6 instead of every 25.
    CFG.update(num_train_epochs=1, eval_steps=6, save_steps=6, eval_subset=60, warmup_steps=2)
CFG["quick_run"] = QUICK_RUN
CFG["max_train_examples"] = MAX_TRAIN_EXAMPLES
for k in ("max_length", "per_device_train_batch_size", "gradient_accumulation_steps", "precision"):
    print(f"{k:<30}{CFG[k]}")
""")

md("## CELL 7 — Load Qwen3-4B in 4-bit (Unsloth, with a Hugging Face fallback)")
code("""
import torch
DTYPE = torch.bfloat16 if BF16 else torch.float16
if USE_UNSLOTH:
    from unsloth import FastLanguageModel
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=CFG["unsloth_checkpoint"], max_seq_length=MAX_LEN, dtype=None, load_in_4bit=True)
else:
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                             bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=DTYPE)
    tokenizer = AutoTokenizer.from_pretrained(CFG["base_model"])
    model = AutoModelForCausalLM.from_pretrained(CFG["base_model"], quantization_config=bnb,
                                                 device_map={"": 0}, torch_dtype=DTYPE)

# pad must differ from eos, or the model never learns where to stop.
if tokenizer.pad_token is None or tokenizer.pad_token_id == tokenizer.eos_token_id:
    tokenizer.pad_token = "<|endoftext|>"
assert tokenizer.pad_token_id != tokenizer.eos_token_id
print("eos:", tokenizer.eos_token, "| pad:", tokenizer.pad_token)
print(f"GPU memory after load: {torch.cuda.memory_allocated()/1e9:.2f} GB")
""")

md("## CELL 8 — Apply LoRA adapters (QLoRA)")
code("""
if USE_UNSLOTH:
    model = FastLanguageModel.get_peft_model(
        model, r=CFG["lora_r"], lora_alpha=CFG["lora_alpha"], lora_dropout=CFG["lora_dropout"],
        target_modules=CFG["target_modules"], bias="none",
        use_gradient_checkpointing="unsloth", random_state=CFG["seed"])
else:
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    model = get_peft_model(model, LoraConfig(
        r=CFG["lora_r"], lora_alpha=CFG["lora_alpha"], lora_dropout=CFG["lora_dropout"],
        target_modules=CFG["target_modules"], bias="none", task_type="CAUSAL_LM"))
trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
total = sum(p.numel() for p in model.parameters())
CFG["trainable_params"] = trainable
print(f"trainable {trainable/1e6:.1f}M of {total/1e6:.0f}M ({100*trainable/total:.2f}%)")
""")

md("""
## CELL 9 — Prompt/completion format

The loss must cover **only the assistant JSON**. A plain `messages` dataset would make TRL compute loss on the
full sequence — the model would spend capacity learning to reproduce resumes. Prompt/completion plus
`completion_only_loss=True` masks the prompt, and fails loudly if the shape is wrong.
""")
code("""
from datasets import Dataset
import random

def to_pc(recs):
    rows = [{"prompt": r["messages"][:2], "completion": r["messages"][2:], "id": r["id"], "mode": r["mode"]}
            for r in recs if r["n_tokens"] <= MAX_LEN]
    return rows, len(recs) - len(rows)

train_rows, dropped_train = to_pc(data["train"])
if MAX_TRAIN_EXAMPLES:
    random.Random(CFG["seed"]).shuffle(train_rows)
    train_rows = train_rows[:MAX_TRAIN_EXAMPLES]
val_rows, dropped_val = to_pc(data["validation"])
random.Random(CFG["seed"]).shuffle(val_rows)
eval_rows = val_rows[: CFG["eval_subset"]]            # a fixed subset keeps eval affordable on T4
train_ds, eval_ds = Dataset.from_list(train_rows), Dataset.from_list(eval_rows)
CFG.update(train_examples=len(train_ds), eval_examples=len(eval_ds),
           dropped_over_max_len={"train": dropped_train, "validation": dropped_val})
print(train_ds, "\\n", eval_ds)
print("dropped (> max_len):", CFG["dropped_over_max_len"])
print("mode mix:", Counter(train_ds["mode"]))
""")

md("## CELL 10 — Trainer: evaluation during training, checkpoints, early stopping")
code("""
from transformers import EarlyStoppingCallback
args = SFTConfig(
    output_dir=str(OUT / "checkpoints"),
    max_length=MAX_LEN,
    packing=False,                       # packing + prompt masking can leak across examples; ours are long anyway
    completion_only_loss=True,
    per_device_train_batch_size=BS, per_device_eval_batch_size=1, gradient_accumulation_steps=GA,
    num_train_epochs=CFG["num_train_epochs"], learning_rate=CFG["learning_rate"],
    warmup_steps=CFG["warmup_steps"], lr_scheduler_type=CFG["lr_scheduler_type"],
    weight_decay=CFG["weight_decay"], max_grad_norm=CFG["max_grad_norm"], optim=CFG["optim"],
    bf16=BF16, fp16=not BF16,
    gradient_checkpointing=not USE_UNSLOTH,   # Unsloth applies its own
    eval_strategy="steps", eval_steps=CFG["eval_steps"],
    save_strategy="steps", save_steps=CFG["save_steps"], save_total_limit=3,
    load_best_model_at_end=True, metric_for_best_model="eval_loss", greater_is_better=False,
    logging_steps=5, report_to="none", seed=CFG["seed"],
)
tokenizer.padding_side = "right"
trainer = SFTTrainer(model=model, args=args, train_dataset=train_ds, eval_dataset=eval_ds,
                     processing_class=tokenizer,
                     callbacks=[EarlyStoppingCallback(early_stopping_patience=CFG["early_stopping_patience"])])

# Prove the prompt is masked: labels must be -100 over the prompt, real ids over the JSON.
batch = trainer.data_collator([trainer.train_dataset[0]])
lab = batch["labels"][0]
supervised = int((lab != -100).sum()); total_tok = int(lab.numel())
print(f"supervised tokens {supervised} / {total_tok} ({100*supervised/total_tok:.1f}%) — only the JSON is learned")
assert 0 < supervised < total_tok * 0.6, "prompt masking is NOT active"
steps = (len(train_ds) // (BS * GA)) * CFG["num_train_epochs"]
print(f"~{steps} optimiser steps | eval every {CFG['eval_steps']}")
""")

md("## CELL 11 — Train (re-run this cell after a disconnect: it resumes from the last checkpoint)")
code("""
import time, glob
ckpts = sorted(glob.glob(str(OUT / "checkpoints" / "checkpoint-*")), key=lambda p: int(p.rsplit("-", 1)[1]))
resume = ckpts[-1] if ckpts else None
print("resuming from", resume) if resume else print("fresh run")
t0 = time.time()
result = trainer.train(resume_from_checkpoint=resume)
CFG["train_runtime_min"] = round((time.time() - t0) / 60, 1)
CFG["train_metrics"] = result.metrics
print(result.metrics)
print(f"peak GPU memory: {torch.cuda.max_memory_allocated()/1e9:.2f} GB")
""")

md("## CELL 12 — Evaluate validation loss, save adapter, config and loss curve")
code("""
import datetime
val_metrics = trainer.evaluate()
CFG["final_eval"] = val_metrics
CFG["best_checkpoint"] = trainer.state.best_model_checkpoint
CFG["training_date"] = datetime.date.today().isoformat()
print("validation:", val_metrics, "| best:", CFG["best_checkpoint"])

ADAPTER = OUT / "model" / "adapter"
model.save_pretrained(str(ADAPTER))          # LoRA adapter only — a few tens of MB, not the 8 GB base
tokenizer.save_pretrained(str(ADAPTER))
json.dump(CFG, open(OUT / "config" / "training_config.json", "w"), indent=2, default=str)
json.dump(trainer.state.log_history, open(OUT / "logs" / "log_history.json", "w"), indent=2)

import matplotlib.pyplot as plt
h = trainer.state.log_history
tr = [(x["step"], x["loss"]) for x in h if "loss" in x]
ev = [(x["step"], x["eval_loss"]) for x in h if "eval_loss" in x]
plt.figure(figsize=(7, 4))
plt.plot(*zip(*tr), label="train loss", alpha=.7)
if ev: plt.plot(*zip(*ev), "o-", label="validation loss")
plt.xlabel("step"); plt.ylabel("loss"); plt.legend(); plt.title("CareerPilot ATS QLoRA"); plt.grid(alpha=.3)
plt.savefig(OUT / "logs" / "loss_curve.png", dpi=150, bbox_inches="tight"); plt.show()
print("saved adapter ->", ADAPTER)
""")

md("""
## CELL 13 — Generation helper

Greedy decoding (deterministic). Batched with left padding; `add_special_tokens=False` because the chat
template already contains them.
""")
code("""
if USE_UNSLOTH:
    FastLanguageModel.for_inference(model)
model.eval()

def generate(batch_messages, max_new_tokens=900):
    tokenizer.padding_side = "left"
    texts = [tokenizer.apply_chat_template(m, add_generation_prompt=True, tokenize=False) for m in batch_messages]
    enc = tokenizer(texts, return_tensors="pt", padding=True, add_special_tokens=False).to(model.device)
    with torch.no_grad():
        out = model.generate(**enc, max_new_tokens=max_new_tokens, do_sample=False,
                             pad_token_id=tokenizer.pad_token_id, eos_token_id=tokenizer.eos_token_id)
    return [tokenizer.decode(o[enc["input_ids"].shape[1]:], skip_special_tokens=True) for o in out]

def one(messages):  # adapter for ats_pipeline.inference.analyze
    return generate([messages])[0]

from ats_pipeline.prompts import chat_messages
print(generate([chat_messages("GENERAL_ATS", "Skills\\nPython, SQL\\nEducation\\nB.Tech CSE 2025", "")])[0][:600])
""")

md("""
## CELL 14 — Predictions on the test split: fine-tuned AND base model (§17, §18)

The base model is the *same weights with the adapter disabled*, so the comparison isolates the effect of
fine-tuning. Raw outputs are saved unparsed; the evaluator re-validates them with the production validator.
`EVAL_LIMIT` caps per-mode examples to fit a session; the report always states the real n.
""")
code("""
from tqdm.auto import tqdm
EVAL_LIMIT = 40 if QUICK_RUN else 150   # per mode; 0 = full test split
BATCH = 4 if VRAM_GB < 22 else 8
test = data["test"]
by_mode = {m: [r for r in test if r["mode"] == m] for m in ("GENERAL_ATS", "JOB_MATCH_ATS")}
eval_set = [r for m in by_mode for r in (by_mode[m][:EVAL_LIMIT] if EVAL_LIMIT else by_mode[m])]
print({m: sum(r["mode"] == m for r in eval_set) for m in by_mode})

def predict(tag):
    path = OUT / "evaluation" / f"pred_{tag}.jsonl"
    done = {json.loads(l)["id"] for l in open(path)} if path.exists() else set()
    todo = [r for r in eval_set if r["id"] not in done]
    t0 = time.time()
    with open(path, "a", encoding="utf-8") as f:           # appends: resumable after a disconnect
        for i in tqdm(range(0, len(todo), BATCH), desc=tag):
            chunk = todo[i:i + BATCH]
            outs = generate([r["messages"][:2] for r in chunk])
            for r, o in zip(chunk, outs):
                f.write(json.dumps({"id": r["id"], "mode": r["mode"], "raw_output": o}) + "\\n")
    print(f"{tag}: {len(todo)} generated in {(time.time()-t0)/60:.1f} min -> {path}")
    return path

PRED_FT = predict("finetuned")
with model.disable_adapter():
    PRED_BASE = predict("base")
""")

md("## CELL 15 — Evaluate: deterministic baseline vs base Qwen vs fine-tuned Qwen")
code("""
import subprocess
cmd = [sys.executable, "-m", "ats_pipeline.evaluate",
       "--pred", f"base_qwen={PRED_BASE}", "--pred", f"finetuned_qwen={PRED_FT}"]
r = subprocess.run(cmd, cwd=str(WORK), capture_output=True, text=True, env={**os.environ,
                   "PYTHONPATH": f"{WORK}:{WORK/'ai-service'}"})
print(r.stdout[-6000:]); print(r.stderr[-3000:])
import shutil
for f in ("metrics.json", "metrics_table.md"):
    shutil.copy(WORK / "evaluation" / f, OUT / "evaluation" / f)
""")

md("""
## CELL 16 — 20 scenario tests + automatic hallucination test (§19, §20)

Every case runs through `analyze()` — the production path with validation, grounding, retry and fallback — and
prints raw output, parsed JSON, validated components, the Python-computed score and recommendations.
""")
code("""
from ats_pipeline.inference import analyze, parse_and_validate
from ats_pipeline.scenarios import GENERAL_CASES, JOB_MATCH_CASES, HALLUCINATION_CASES

def run_case(mode, name, resume, jd=""):
    raw = one(chat_messages(mode, resume, jd))
    parsed = parse_and_validate(mode, raw, resume, jd)
    final = analyze(mode, resume, jd, generator=one)
    return {"name": name, "mode": mode, "raw_output": raw, "valid": parsed.ok, "error": parsed.error,
            "grounding": parsed.grounding, "result": final["result"], "inference": final["inference"]}

results = {"GENERAL_ATS": [], "JOB_MATCH_ATS": []}
for name, resume in GENERAL_CASES:
    results["GENERAL_ATS"].append(run_case("GENERAL_ATS", name, resume))
for name, resume, jd in JOB_MATCH_CASES:
    results["JOB_MATCH_ATS"].append(run_case("JOB_MATCH_ATS", name, resume, jd))

for mode, rs in results.items():
    print("=" * 90, "\\n", mode)
    for x in rs:
        res = x["result"]
        print(f"\\n--- {x['name']} | valid={x['valid']} | provider={x['inference']['provider']} ---")
        print("raw   :", x["raw_output"][:220].replace("\\n", " "), "...")
        print("comps :", res["componentScores"])
        print("score :", res["atsScore"], "(computed in Python)")
        if mode == "JOB_MATCH_ATS":
            print("match :", res["matchedSkills"], "| missing:", res["missingSkills"],
                  "| hallucinations caught:", x["grounding"].get("hallucinated_matched"))
        print("recs  :", res["recommendations"][:3])

json.dump(results["GENERAL_ATS"], open(OUT / "inference" / "test_general.json", "w"), indent=2)
json.dump(results["JOB_MATCH_ATS"], open(OUT / "inference" / "test_job_match.json", "w"), indent=2)

print("\\n" + "=" * 90 + "\\nHALLUCINATION TESTS (raw model output, before the grounding guard)")
hall = []
for name, resume, jd, must_match, must_miss in HALLUCINATION_CASES:
    raw = one(chat_messages("JOB_MATCH_ATS", resume, jd))
    p = parse_and_validate("JOB_MATCH_ATS", raw, resume, jd)
    raw_matched = set(json.loads(raw[raw.find("{"):raw.rfind("}") + 1]).get("matchedSkills", [])) if p.ok else set()
    ok = p.ok and not (raw_matched & set(must_miss)) and set(must_match) <= raw_matched
    hall.append({"name": name, "passed": ok, "raw_matched": sorted(raw_matched),
                 "caught_by_guard": p.grounding.get("hallucinated_matched") if p.ok else None, "error": p.error})
    print(f"{'PASS' if ok else 'FAIL'}  {name} | model matched {sorted(raw_matched)} | expected {must_match}")
json.dump(hall, open(OUT / "inference" / "hallucination_tests.json", "w"), indent=2)
print(f"\\nmodel passed {sum(h['passed'] for h in hall)}/{len(hall)} unaided; "
      "the grounding guard corrects any failure before it reaches a user.")
""")

md("""
## CELL 17 — Package artefacts and (optional) Hugging Face upload

Only the **LoRA adapter** is published — never the training resumes. Nothing uploads unless you run the
commented lines yourself.
""")
code("""
import shutil
shutil.make_archive(str(DRIVE / "careerpilot_ats_run"), "zip", OUT)
print("artefacts ->", DRIVE / "careerpilot_ats_run.zip")
print(sorted(str(p.relative_to(OUT)) for p in OUT.rglob("*") if p.is_file() and "checkpoint-" not in str(p))[:40])

# --- Hugging Face (run manually, only with permission; adapter only, no data) ---
# from huggingface_hub import login, HfApi
# login()                                                    # paste a WRITE token
# HfApi().create_repo("<your-user>/careerpilot-ats-qwen3-4b-v1", private=True, exist_ok=True)
# HfApi().upload_folder(folder_path=str(OUT / "model" / "adapter"),
#                       repo_id="<your-user>/careerpilot-ats-qwen3-4b-v1", commit_message="v1 LoRA adapter")
""")


def build() -> None:
    for kind, src in CELLS:
        if kind == "code":
            ast.parse("\n".join(l for l in src.splitlines() if not l.lstrip().startswith(("%", "!"))))
    nb = {"nbformat": 4, "nbformat_minor": 5,
          "metadata": {"accelerator": "GPU", "colab": {"gpuType": "T4", "provenance": []},
                       "kernelspec": {"name": "python3", "display_name": "Python 3"},
                       "language_info": {"name": "python"}},
          "cells": []}
    for i, (kind, src) in enumerate(CELLS):
        cell = {"cell_type": kind, "metadata": {}, "source": src.splitlines(keepends=True), "id": f"c{i:02d}"}
        if kind == "code":
            cell.update(execution_count=None, outputs=[])
        nb["cells"].append(cell)
    out = Path(__file__).with_name("CareerPilot_ATS_FineTune.ipynb")
    out.write_text(json.dumps(nb, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out} ({sum(k == 'code' for k, _ in CELLS)} code cells, all syntax-checked)")


if __name__ == "__main__":
    build()
