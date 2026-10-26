"""Error types and the shared response envelope (§37).

Every route returns `{success, data, meta}` or `{success:false, error:{code,message}}`
so the Node gateway can map failures onto its own error codes without parsing
free-form strings.
"""
from __future__ import annotations

from typing import Any

from fastapi import status
from fastapi.responses import JSONResponse


class ErrorCode:
    VALIDATION_ERROR = "VALIDATION_ERROR"
    UNAUTHENTICATED = "UNAUTHENTICATED"
    RESUME_PARSE_FAILED = "RESUME_PARSE_FAILED"
    UNSUPPORTED_FILE_TYPE = "UNSUPPORTED_FILE_TYPE"
    AI_PROVIDER_ERROR = "AI_PROVIDER_ERROR"
    AI_RESPONSE_INVALID = "AI_RESPONSE_INVALID"
    MODEL_NOT_TRAINED = "MODEL_NOT_TRAINED"
    RAG_INDEX_EMPTY = "RAG_INDEX_EMPTY"
    AGENT_NOT_FOUND = "AGENT_NOT_FOUND"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class ServiceError(Exception):
    """Base class for expected, user-safe failures."""

    status_code = status.HTTP_400_BAD_REQUEST
    code = ErrorCode.VALIDATION_ERROR

    def __init__(self, message: str, *, code: str | None = None, status_code: int | None = None,
                 details: Any = None) -> None:
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code
        self.details = details


class ResumeParseError(ServiceError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = ErrorCode.RESUME_PARSE_FAILED


class UnsupportedFileType(ServiceError):
    status_code = status.HTTP_415_UNSUPPORTED_MEDIA_TYPE
    code = ErrorCode.UNSUPPORTED_FILE_TYPE


class ProviderError(ServiceError):
    status_code = status.HTTP_502_BAD_GATEWAY
    code = ErrorCode.AI_PROVIDER_ERROR


class ModelNotTrainedError(ServiceError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = ErrorCode.MODEL_NOT_TRAINED


class AgentValidationError(ServiceError):
    """Raised when an agent's input or output fails its declared schema (§5)."""

    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = ErrorCode.AI_RESPONSE_INVALID


def success_response(data: Any, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"success": True, "data": data}
    if meta:
        payload["meta"] = meta
    return payload


def error_response(code: str, message: str, status_code: int = 400, details: Any = None) -> JSONResponse:
    body: dict[str, Any] = {"success": False, "error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return JSONResponse(status_code=status_code, content=body)
