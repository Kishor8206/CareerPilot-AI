import { ErrorCode } from '@careerpilot/shared';

export interface ErrorDetail {
  path: string;
  message: string;
}

/**
 * Application-level error carrying an HTTP status and a stable machine-readable
 * code (§37). Everything thrown inside a controller should be an ApiError so the
 * error middleware can produce a consistent envelope without leaking internals.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: ErrorDetail[];
  public readonly isOperational: boolean;
  public override readonly cause?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { details?: ErrorDetail[]; isOperational?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.isOperational = options.isOperational ?? true;
    this.cause = options.cause;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message: string, code: string = ErrorCode.VALIDATION_ERROR, details?: ErrorDetail[]) {
    return new ApiError(400, code, message, { details });
  }

  static unauthorized(message = 'Authentication is required to access this resource.', code: string = ErrorCode.UNAUTHENTICATED) {
    return new ApiError(401, code, message);
  }

  static forbidden(message = 'You do not have permission to perform this action.', code: string = ErrorCode.FORBIDDEN) {
    return new ApiError(403, code, message);
  }

  static notFound(resource = 'Resource') {
    return new ApiError(404, ErrorCode.NOT_FOUND, `${resource} was not found.`);
  }

  static conflict(message: string, code: string = ErrorCode.CONFLICT) {
    return new ApiError(409, code, message);
  }

  static payloadTooLarge(message: string) {
    return new ApiError(413, ErrorCode.PAYLOAD_TOO_LARGE, message);
  }

  static unsupportedMedia(message: string) {
    return new ApiError(415, ErrorCode.UNSUPPORTED_FILE_TYPE, message);
  }

  static tooManyRequests(message = 'Too many requests. Please slow down and try again shortly.') {
    return new ApiError(429, ErrorCode.RATE_LIMITED, message);
  }

  static internal(message = 'An unexpected error occurred. Please try again later.', cause?: unknown) {
    return new ApiError(500, ErrorCode.INTERNAL_ERROR, message, { isOperational: false, cause });
  }

  static serviceUnavailable(message: string, code: string = ErrorCode.AI_SERVICE_UNAVAILABLE, cause?: unknown) {
    return new ApiError(503, code, message, { cause });
  }
}
