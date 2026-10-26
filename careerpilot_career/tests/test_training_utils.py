"""Checkpoint resume and prompt-masked tokenisation. CPU only."""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "training"))

import common  # noqa: E402,F401
from train_utils import checkpoint_is_valid, encode_example, find_latest_checkpoint, load_split  # noqa: E402

from app.career.prompts import render  # noqa: E402


def make(root: Path, step: int, state=True, weights=True, corrupt=False):
    d = root / f"checkpoint-{step}"
    d.mkdir(parents=True)
    if state:
        (d / "trainer_state.json").write_text("{not json" if corrupt else json.dumps({"global_step": step}))
    if weights:
        (d / "adapter_model.safetensors").write_bytes(b"weights")
    return d


def test_no_checkpoint_starts_fresh(tmp_path, capsys):
    assert find_latest_checkpoint(tmp_path) is None
    assert "No checkpoint found. Starting fresh." in capsys.readouterr().out
    assert find_latest_checkpoint(tmp_path / "does-not-exist") is None


def test_picks_the_highest_step_numerically_not_alphabetically(tmp_path, capsys):
    for step in (50, 100, 950, 1000):
        make(tmp_path, step)
    assert find_latest_checkpoint(tmp_path).endswith("checkpoint-1000")      # "950" > "1000" as text
    assert "Resuming from checkpoint-1000." in capsys.readouterr().out


def test_skips_a_checkpoint_that_was_interrupted_mid_save(tmp_path, capsys):
    make(tmp_path, 100)
    make(tmp_path, 150, weights=False)                   # crash before weights were written
    make(tmp_path, 200, corrupt=True)                    # crash while writing state
    (make(tmp_path, 250) / "adapter_model.safetensors").write_bytes(b"")   # zero-byte weights
    assert find_latest_checkpoint(tmp_path).endswith("checkpoint-100")
    out = capsys.readouterr().out
    assert "Skipping checkpoint-250" in out and "Skipping checkpoint-200" in out and "Skipping checkpoint-150" in out


def test_ignores_unrelated_folders(tmp_path):
    (tmp_path / "checkpoint-final").mkdir()
    (tmp_path / "runs").mkdir()
    make(tmp_path, 50)
    assert find_latest_checkpoint(tmp_path, verbose=False).endswith("checkpoint-50")
    assert not checkpoint_is_valid(tmp_path / "runs")


@pytest.fixture(scope="module")
def tok():
    from transformers import AutoTokenizer
    path = ROOT / "data" / "knowledge" / "tokenizer"
    if not path.exists():
        pytest.skip("run training/validate_dataset.py first")
    return AutoTokenizer.from_pretrained(str(path))


def test_only_the_answer_is_supervised_and_the_prompt_matches_inference(tok):
    row = load_split("validation", 1)[0]
    enc = encode_example(tok, row["messages"], 4096)
    prompt_ids = tok(render(tok, row["messages"][:2], add_generation_prompt=True), add_special_tokens=False)["input_ids"]
    n = len(prompt_ids)
    assert enc["input_ids"][:n] == prompt_ids                       # training prompt == serving prompt
    assert all(x == -100 for x in enc["labels"][:n])                 # prompt carries no loss
    assert enc["labels"][n:] == enc["input_ids"][n:]                 # answer is fully supervised
    assert enc["input_ids"][-1] == tok.eos_token_id                  # learns to stop
    answer = tok.decode(enc["input_ids"][n:], skip_special_tokens=True)
    assert json.loads(answer) == json.loads(row["messages"][2]["content"])
    assert "</think>" in tok.decode(prompt_ids[-8:])                 # thinking disabled, as at inference


def test_over_length_examples_are_dropped_not_truncated(tok):
    row = load_split("validation", 1)[0]
    assert encode_example(tok, row["messages"], 64) is None
