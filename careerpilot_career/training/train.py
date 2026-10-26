"""Fine-tune Qwen/Qwen3-1.7B for career roadmaps with QLoRA. Needs a CUDA GPU.

    python training/train.py --run-dir /content/drive/MyDrive/careerpilot_career/runs/career-roadmap-qwen3-1.7b
    python training/train.py --quick          # 600 examples, 1 epoch: a real but short run

Interrupted? Run the same command again. It finds the newest valid checkpoint
in <run-dir>/checkpoints and resumes; checkpoints are written every 50 steps.

This is a SEPARATE model from the ATS model: different base (Qwen3-1.7B, not
Qwen3-4B), its own run directory, and it never loads ATS weights or checkpoints.
The script refuses to run if --run-dir points inside an ATS directory.

The steps are separate functions so the Colab notebook can run them one cell
at a time (load model, add LoRA, build trainer, find checkpoint, train, save).

Implementation notes (each one prevents a silent failure)
  * Qwen3-1.7B is a thinking model. Prompts are rendered with thinking
    disabled, in training and at inference, by app.career.prompts.render.
  * Examples are tokenised here as prompt ids + answer ids with the prompt
    masked from the loss (train_utils.encode_example), and trained with the
    plain transformers Trainer. No library re-renders the chat template.
  * A T4 cannot compute in bfloat16; precision is chosen from the GPU.
  * If Qwen3-1.7B cannot be loaded the script STOPS. It does not substitute
    another model.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

from common import DATA, DATASET_VERSION, MODELS, REPO, read_json
from train_utils import find_latest_checkpoint, load_split, to_dataset

BASE_MODEL = "Qwen/Qwen3-1.7B"
UNSLOTH_4BIT = "unsloth/Qwen3-1.7B-unsloth-bnb-4bit"
MODEL_VERSION = "career-roadmap-qwen3-1.7b-v1"
TARGET_MODULES = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]


def git_commit() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return "not a git repository"


def gpu_plan(max_length: int = 4096) -> dict:
    """Batch size, accumulation and length for this GPU. Stops if there is none."""
    import torch
    if not torch.cuda.is_available():
        sys.exit("No CUDA GPU found. Run this in Google Colab (Runtime > Change runtime type > T4 GPU).")
    props = torch.cuda.get_device_properties(0)
    vram = props.total_memory / 1e9
    if vram >= 22:
        batch, accumulate = 4, 4
    elif vram >= 14:
        batch, accumulate = 2, 8
    else:
        batch, accumulate, max_length = 1, 16, min(max_length, 3072)
    plan = {"gpu": props.name, "vram_gb": round(vram, 1), "bf16": torch.cuda.is_bf16_supported(),
            "batch": batch, "accumulate": accumulate, "max_length": max_length}
    print(f"GPU {plan['gpu']} | {plan['vram_gb']} GB | bf16 {plan['bf16']} | batch {batch} x accumulation {accumulate} "
          f"| max_length {max_length}")
    return plan


def run_dirs(run_dir: str | Path) -> dict[str, Path]:
    run = Path(run_dir)
    if "careerpilot_ats" in run.as_posix().lower() or "/ats/" in run.as_posix().lower():
        sys.exit(f"Refusing to write career-model files into an ATS directory: {run}")
    dirs = {"run": run, "checkpoints": run / "checkpoints", "final": run / "final", "logs": run / "logs",
            "config": run / "config", "evaluation": run / "evaluation", "inference": run / "inference",
            "metadata": run / "metadata"}
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)
    return dirs


def load_model(max_length: int):
    """Unsloth if available, otherwise Hugging Face + bitsandbytes. The same base model either way."""
    import torch
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    try:
        from unsloth import FastLanguageModel
        model, tok = FastLanguageModel.from_pretrained(model_name=UNSLOTH_4BIT, max_seq_length=max_length,
                                                       dtype=None, load_in_4bit=True)
        return model, tok, "unsloth"
    except ImportError:
        pass
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    tok = AutoTokenizer.from_pretrained(BASE_MODEL)
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL, device_map={"": 0}, torch_dtype=dtype,
        quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                                               bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=dtype))
    return model, tok, "hf"


def prepare_tokenizer(tok):
    if tok.pad_token is None or tok.pad_token_id == tok.eos_token_id:
        tok.pad_token = "<|endoftext|>"          # pad must differ from eos, or the model never learns to stop
    tok.padding_side = "right"
    return tok


def add_lora(model, path: str, r: int = 16, alpha: int = 32, dropout: float = 0.05, seed: int = 42):
    if path == "unsloth":
        from unsloth import FastLanguageModel
        return FastLanguageModel.get_peft_model(model, r=r, lora_alpha=alpha, lora_dropout=dropout,
                                                target_modules=TARGET_MODULES, bias="none",
                                                use_gradient_checkpointing="unsloth", random_state=seed)
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    return get_peft_model(model, LoraConfig(r=r, lora_alpha=alpha, lora_dropout=dropout, target_modules=TARGET_MODULES,
                                            bias="none", task_type="CAUSAL_LM"))


def build_datasets(tok, max_length: int, max_train: int = 0, eval_examples: int = 80, seed: int = 42):
    train_rows = load_split("train")
    if max_train:
        import random
        random.Random(seed).shuffle(train_rows)
        train_rows = train_rows[:max_train]
    train_ds, dropped_train = to_dataset(tok, train_rows, max_length)
    eval_ds, dropped_eval = to_dataset(tok, load_split("validation", eval_examples), max_length)
    supervised = sum(1 for x in train_ds[0]["labels"] if x != -100)
    print(f"train {len(train_ds)} (dropped {dropped_train} over length) | eval {len(eval_ds)} (dropped {dropped_eval}) | "
          f"first example: {supervised}/{len(train_ds[0]['labels'])} tokens supervised (the JSON only)")
    assert 0 < supervised < len(train_ds[0]["labels"]), "prompt masking is not active"
    return train_ds, eval_ds, {"train": dropped_train, "validation": dropped_eval}


def build_trainer(model, tok, train_ds, eval_ds, dirs: dict, plan: dict, path: str, *, epochs: float = 2,
                  lr: float = 1e-4, save_steps: int = 50, seed: int = 42):
    """A plain transformers Trainer: checkpoints every `save_steps`, keeps the latest 3, evaluates at
    each checkpoint, and stops early if validation loss stops improving."""
    import torch
    from transformers import DataCollatorForSeq2Seq, EarlyStoppingCallback, Trainer, TrainerCallback, TrainingArguments

    log_path = dirs["logs"] / "training_log.json"

    class Telemetry(TrainerCallback):
        """Loss, learning rate, GPU memory and elapsed time at every logging step."""

        def __init__(self) -> None:
            # Keep earlier rows so the log survives a resume.
            self.rows = json.loads(log_path.read_text(encoding="utf-8")) if log_path.exists() else []
            self.t0 = time.time()

        def on_log(self, a, state, control, logs=None, **kw):
            self.rows.append({"step": state.global_step, "epoch": round(state.epoch or 0, 3),
                              "elapsed_min": round((time.time() - self.t0) / 60, 1),
                              "gpu_memory_gb": round(torch.cuda.max_memory_allocated() / 1e9, 2), **(logs or {})})
            log_path.write_text(json.dumps(self.rows, indent=1), encoding="utf-8")

    steps_per_epoch = max(1, len(train_ds) // (plan["batch"] * plan["accumulate"]))
    training_args = TrainingArguments(
        output_dir=str(dirs["checkpoints"]), num_train_epochs=epochs, learning_rate=lr,
        per_device_train_batch_size=plan["batch"], per_device_eval_batch_size=1,
        gradient_accumulation_steps=plan["accumulate"],
        warmup_steps=min(20, max(1, steps_per_epoch // 4)), lr_scheduler_type="cosine", weight_decay=0.01,
        max_grad_norm=1.0, optim="paged_adamw_8bit", bf16=plan["bf16"], fp16=not plan["bf16"],
        gradient_checkpointing=(path == "hf"),
        logging_steps=10, eval_strategy="steps", eval_steps=save_steps,
        save_strategy="steps", save_steps=save_steps, save_total_limit=3,
        load_best_model_at_end=True, metric_for_best_model="eval_loss", greater_is_better=False,
        report_to="none", seed=seed,        # (group_by_length no longer exists in transformers 5.x)
    )
    print(f"~{int(steps_per_epoch * epochs)} optimiser steps | checkpoint + evaluation every {save_steps} steps "
          f"-> {dirs['checkpoints']}")
    return Trainer(model=model, args=training_args, train_dataset=train_ds, eval_dataset=eval_ds,
                   data_collator=DataCollatorForSeq2Seq(tok, padding=True, label_pad_token_id=-100),
                   callbacks=[Telemetry(), EarlyStoppingCallback(early_stopping_patience=4)])


def save_final(trainer, model, tok, dirs: dict, plan: dict, path: str, *, train_metrics: dict, minutes: float,
               resumed_from, lora_r: int = 16, lr: float = 1e-4, epochs: float = 2, quick: bool = False,
               dropped: dict | None = None, seed: int = 42) -> dict:
    """Save the LoRA adapter (not a merged model), the configuration and model_metadata.json."""
    import torch
    final_eval = trainer.evaluate()
    model.save_pretrained(str(dirs["final"]))
    tok.save_pretrained(str(dirs["final"]))
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    n_train = len(trainer.train_dataset)
    config = {
        "model_version": MODEL_VERSION, "base_model": BASE_MODEL,
        "loaded_from": UNSLOTH_4BIT if path == "unsloth" else BASE_MODEL, "loading_path": path,
        "quantization": "4-bit NF4",
        "lora": {"r": lora_r, "alpha": lora_r * 2, "dropout": 0.05, "target_modules": TARGET_MODULES,
                 "trainable_parameters": trainable},
        "max_length": plan["max_length"], "batch_size": plan["batch"],
        "gradient_accumulation_steps": plan["accumulate"], "learning_rate": lr, "epochs_requested": epochs,
        "quick_run": bool(quick), "train_examples": n_train, "eval_examples": len(trainer.eval_dataset),
        "dropped_over_length": dropped or {}, "precision": "bf16" if plan["bf16"] else "fp16",
        "thinking_disabled": True, "loss": "answer tokens only", "gpu": plan["gpu"], "vram_gb": plan["vram_gb"],
        "resumed_from": resumed_from, "seed": seed,
    }
    (dirs["config"] / "training_config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    metadata = {
        "model_name": "CareerPilot Career Roadmap", "base_model": BASE_MODEL, "training_method": "QLoRA",
        "dataset_version": DATASET_VERSION, "training_date": time.strftime("%Y-%m-%d"),
        "epochs": round(trainer.state.epoch or 0, 3), "steps": trainer.state.global_step, "adapter_type": "LoRA",
        "source_manifest": "careerpilot_career/data/knowledge/data_source_manifest.json",
        "git_commit": git_commit(), "model_version": MODEL_VERSION,
        "final_train_loss": train_metrics.get("train_loss"), "final_eval_loss": final_eval.get("eval_loss"),
        "best_checkpoint": trainer.state.best_model_checkpoint, "training_minutes": round(minutes, 1),
        "peak_gpu_memory_gb": round(torch.cuda.max_memory_allocated() / 1e9, 2), "quick_run": bool(quick),
        "dataset_counts": read_json(DATA / "dataset_version.json")["counts"],
    }
    for target in (dirs["final"] / "model_metadata.json", dirs["metadata"] / "model_metadata.json"):
        target.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    subset = " (QUICK RUN subset)" if quick else ""
    readme = "\n".join([
        "# CareerPilot Career Roadmap adapter", "",
        f"LoRA adapter for `{BASE_MODEL}` (QLoRA, r={lora_r}). Version `{MODEL_VERSION}`.", "",
        f"- Dataset: `{DATASET_VERSION}`, {n_train} training examples{subset}",
        f"- Steps: {trainer.state.global_step} | final validation loss: {final_eval.get('eval_loss')}",
        "- Build prompts with `app.career.prompts` and render them with thinking disabled.",
        "- Training targets were generated by a deterministic planner over curated knowledge;",
        "  see `careerpilot_career/README.md` for what that does and does not show.",
        "- This is not the ATS model and shares no weights with it.", "",
    ])
    (dirs["final"] / "README.md").write_text(readme, encoding="utf-8")
    print(json.dumps(metadata, indent=2))
    print(f"adapter saved to {dirs['final']}")
    return metadata


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-dir", default=str(MODELS))
    ap.add_argument("--epochs", type=float, default=2)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--max-length", type=int, default=4096)
    ap.add_argument("--max-train", type=int, default=0, help="cap training examples (0 = all)")
    ap.add_argument("--eval-examples", type=int, default=80)
    ap.add_argument("--save-steps", type=int, default=50)
    ap.add_argument("--lora-r", type=int, default=16)
    ap.add_argument("--quick", action="store_true", help="600 examples, 1 epoch")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    if args.quick:
        args.max_train, args.epochs, args.eval_examples = args.max_train or 600, 1, 40

    dirs = run_dirs(args.run_dir)
    plan = gpu_plan(args.max_length)
    try:
        model, tok, path = load_model(plan["max_length"])
    except Exception as exc:
        sys.exit(f"STOP: could not load {BASE_MODEL} ({type(exc).__name__}: {exc}). No other model is substituted.")
    tok = prepare_tokenizer(tok)
    model = add_lora(model, path, args.lora_r, args.lora_r * 2, 0.05, args.seed)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"loading path: {path} | trainable parameters: {trainable / 1e6:.1f}M")

    train_ds, eval_ds, dropped = build_datasets(tok, plan["max_length"], args.max_train, args.eval_examples, args.seed)
    trainer = build_trainer(model, tok, train_ds, eval_ds, dirs, plan, path, epochs=args.epochs, lr=args.lr,
                            save_steps=args.save_steps, seed=args.seed)
    resume = find_latest_checkpoint(dirs["checkpoints"])
    t0 = time.time()
    result = trainer.train(resume_from_checkpoint=resume)
    save_final(trainer, model, tok, dirs, plan, path, train_metrics=result.metrics, minutes=(time.time() - t0) / 60,
               resumed_from=resume, lora_r=args.lora_r, lr=args.lr, epochs=args.epochs, quick=args.quick,
               dropped=dropped, seed=args.seed)


if __name__ == "__main__":
    main()
