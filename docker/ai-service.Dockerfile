# ==========================================================
# CareerPilot AI - Python AI/ML service
# Build from the repository root:
#   docker build -f docker/ai-service.Dockerfile -t careerpilot-ai .
# ==========================================================

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# build-essential is needed to compile some scientific wheels; it is removed
# again in the same layer so it never reaches the final image.
COPY ai-service/requirements.txt ./requirements.txt
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl \
 && pip install --no-cache-dir -r requirements.txt \
 && apt-get purge -y --auto-remove build-essential \
 && rm -rf /var/lib/apt/lists/*

# Optional: the spaCy model improves name extraction. The parser falls back to
# heuristics when it is absent, so a failure here must not fail the build.
RUN python -m spacy download en_core_web_sm || \
    echo "spaCy model unavailable; the resume parser will use heuristic name detection."

COPY ai-service/app ./app
COPY ai-service/pytest.ini ./pytest.ini

# Writable paths for the vector index and trained model artefacts.
RUN mkdir -p /app/data/vectorstore /app/artifacts \
 && useradd --create-home --uid 1000 aiservice \
 && chown -R aiservice:aiservice /app

USER aiservice
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health/live || exit 1

# Single worker by default: the vector index is held in process memory, so
# multiple workers would each hold their own copy. Scale with replicas plus an
# external vector database (VECTOR_DB_PROVIDER=chroma) instead.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
