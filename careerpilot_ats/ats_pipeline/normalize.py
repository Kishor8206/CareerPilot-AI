"""Re-export: the single source of truth is ai-service/app/ats_model/normalize.py."""
from app.ats_model import normalize as _src

__all__ = [n for n in dir(_src) if not n.startswith("__")]
globals().update({n: getattr(_src, n) for n in __all__})
