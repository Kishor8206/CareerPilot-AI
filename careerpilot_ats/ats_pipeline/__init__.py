"""CareerPilot ATS fine-tuning pipeline.

Data preparation, weak labelling and evaluation for the ATS LLM. Everything
here runs on CPU; only training needs a GPU. The prompt, schemas, weights and
normaliser are imported from ai-service/app/ats_model — the modules production
serves — so training and serving cannot drift apart.
"""
import sys
from pathlib import Path

_here = Path(__file__).resolve().parent
for _candidate in (_here.parent / "ai-service", _here.parent.parent / "ai-service"):
    if (_candidate / "app").is_dir():
        if str(_candidate) not in sys.path:
            sys.path.insert(0, str(_candidate))
        break
