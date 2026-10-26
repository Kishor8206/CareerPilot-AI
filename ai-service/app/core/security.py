"""Internal-service authentication.

The AI service is not internet-facing: only the Node gateway may call it. Every
request must carry `X-Internal-Key` matching the shared secret. The comparison
is constant-time so the key cannot be recovered by timing.
"""
from __future__ import annotations

import secrets

from fastapi import Header, HTTPException, status

from app.core.config import settings


async def require_internal_key(x_internal_key: str | None = Header(default=None)) -> None:
    if not x_internal_key or not secrets.compare_digest(x_internal_key, settings.ai_service_internal_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "UNAUTHENTICATED",
                "message": "A valid internal service key is required to call the AI service.",
            },
        )
