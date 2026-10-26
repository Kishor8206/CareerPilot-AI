"""Re-export: the single source of truth is ai-service/app/ats_model/prompts.py.

Training imports the exact module production serves, so the prompt, schema
and weights the model learns can never drift from the ones it is served with.
"""
from app.ats_model.prompts import *  # noqa: F401,F403
from app.ats_model import prompts as _src

__all__ = [n for n in dir(_src) if not n.startswith("__")]
globals().update({n: getattr(_src, n) for n in __all__})
