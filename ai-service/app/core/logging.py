"""Structured logging for the AI service (§38).

Emits newline-delimited JSON so the same log shipper handles both services.
A `correlation_id` context variable threads the Node gateway's request id
through every log line produced while handling that request.
"""
from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import datetime, timezone

from app.core.config import settings

correlation_id: ContextVar[str] = ContextVar("correlation_id", default="-")

_RESERVED = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "taskName", "message", "asctime",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "time": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "service": "careerpilot-ai",
            "logger": record.name,
            "message": record.getMessage(),
            "correlationId": correlation_id.get(),
        }
        # Anything passed via `extra=` becomes a first-class JSON field.
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class HumanFormatter(logging.Formatter):
    """Readable single-line output for local development."""

    def format(self, record: logging.LogRecord) -> str:
        stamp = datetime.now().strftime("%H:%M:%S")
        extras = {
            k: v for k, v in record.__dict__.items()
            if k not in _RESERVED and not k.startswith("_")
        }
        suffix = f"  {json.dumps(extras, default=str)}" if extras else ""
        return f"{stamp} {record.levelname:<7} {record.name:<28} {record.getMessage()}{suffix}"


def configure_logging() -> None:
    root = logging.getLogger()
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if settings.is_production else HumanFormatter())
    root.addHandler(handler)
    root.setLevel(settings.log_level.upper())

    # uvicorn's own access log duplicates our request logging.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
