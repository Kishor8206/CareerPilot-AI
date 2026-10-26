import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { ErrorCode } from '@careerpilot/shared';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { ApiError } from '../utils/ApiError';

/** 404 handler for unmatched routes. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, ErrorCode.NOT_FOUND, `The endpoint ${req.method} ${req.originalUrl} does not exist.`));
}

/**
 * Translates framework/driver errors into the canonical API error envelope.
 * Stack traces never reach the client (§37).
 */
function normalize(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return ApiError.payloadTooLarge(
        `The uploaded file exceeds the ${env.MAX_UPLOAD_SIZE_MB} MB limit. Please upload a smaller file.`,
      );
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return ApiError.badRequest('Unexpected file field in the upload request.');
    }
    return ApiError.badRequest(`File upload failed: ${error.message}`);
  }

  if (error instanceof mongoose.Error.ValidationError) {
    const details = Object.entries(error.errors).map(([path, err]) => ({ path, message: err.message }));
    return ApiError.badRequest('The submitted data failed validation.', ErrorCode.VALIDATION_ERROR, details);
  }

  if (error instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`'${String(error.value)}' is not a valid identifier for ${error.path}.`);
  }

  const mongoErr = error as { name?: string; code?: number; keyValue?: Record<string, unknown> };
  if (mongoErr?.code === 11000) {
    const field = Object.keys(mongoErr.keyValue ?? {})[0] ?? 'value';
    return ApiError.conflict(`A record with that ${field} already exists.`);
  }
  if (mongoErr?.name === 'MongoNetworkError' || mongoErr?.name === 'MongoServerSelectionError') {
    return ApiError.serviceUnavailable(
      'The database is temporarily unavailable. Please try again shortly.',
      ErrorCode.DB_ERROR,
      error,
    );
  }

  if (error instanceof SyntaxError && 'body' in error) {
    return ApiError.badRequest('The request body is not valid JSON.');
  }

  return ApiError.internal('An unexpected error occurred. Please try again later.', error);
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const apiError = normalize(err);

  const logPayload = {
    err: apiError.isOperational ? { code: apiError.code, message: apiError.message } : err,
    requestId: req.requestId,
    method: req.method,
    url: req.originalUrl,
    statusCode: apiError.statusCode,
    userId: req.auth?.userId,
  };

  if (apiError.statusCode >= 500) {
    logger.error(logPayload, 'Request failed');
  } else if (apiError.statusCode >= 400) {
    logger.warn(logPayload, 'Request rejected');
  }

  if (res.headersSent) return;

  res.status(apiError.statusCode).json({
    success: false,
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details ? { details: apiError.details } : {}),
      ...(req.requestId ? { requestId: req.requestId } : {}),
      // Stack traces are exposed in development only, never in production.
      ...(!env.isProd && !apiError.isOperational && err instanceof Error ? { stack: err.stack } : {}),
    },
  });
}
