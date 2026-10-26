"""Fine-tuned ATS model integration (optional; off by default).

This package is the SINGLE SOURCE OF TRUTH for the prompt, output schema and
score weights. The training pipeline in careerpilot_ats/ imports these same
modules, so the model is served exactly the prompt it was trained on.

With ATS_MODEL_PROVIDER=none (the default) nothing here runs and the
ResumeIntelligenceAgent behaves exactly as it did before fine-tuning existed.
"""
