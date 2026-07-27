/**
 * API error types and the Express error handler.
 *
 * WP §7: validation errors return 400 with a message, permission failures 403.
 *
 * Every response carries a stable `error` code as well as a human `message`. The
 * code is the contract — clients and tests branch on it — while the message is
 * translated text from lib/messages.ts and may change with UI_LANG.
 */
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { config } from './config.ts';
import { t, type MessageKey } from './messages.ts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = 'error',
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Builds an ApiError from a catalogue key so no route hardcodes user-facing text. */
function fromKey(status: number, code: string, key: MessageKey, details?: unknown): ApiError {
  return new ApiError(status, t(key), code, details);
}

export const badRequest = (key: MessageKey = 'error.badRequest', details?: unknown) =>
  fromKey(400, 'bad_request', key, details);
export const unauthorized = (key: MessageKey = 'auth.required') =>
  fromKey(401, 'unauthorized', key);
export const forbidden = (key: MessageKey = 'auth.forbidden') => fromKey(403, 'forbidden', key);
export const notFound = (key: MessageKey = 'error.notFound') => fromKey(404, 'not_found', key);
export const conflict = (key: MessageKey) => fromKey(409, 'conflict', key);

/**
 * Escape hatch for a message that is already translated text rather than a key —
 * currently only the password-length message, which interpolates a number.
 */
export const badRequestText = (message: string, details?: unknown) =>
  new ApiError(400, message, 'bad_request', details);

/** Postgres error codes we can turn into something a user can act on. */
const PG_MESSAGES: Record<string, { status: number; key: MessageKey; code: string }> = {
  '23505': { status: 409, key: 'db.duplicate', code: 'duplicate_key' },
  '23503': { status: 409, key: 'db.referenced', code: 'still_referenced' },
  '23514': { status: 400, key: 'db.checkFailed', code: 'check_violation' },
  '23502': { status: 400, key: 'db.missingRequired', code: 'missing_required' },
  '22P02': { status: 400, key: 'db.badFormat', code: 'bad_format' },
};

function isPgError(err: unknown): err is { code: string; constraint?: string; detail?: string } {
  return typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string';
}

/**
 * body-parser (and multer, in Phase 3) throw errors that already carry an HTTP
 * status — malformed JSON, payload too large, unsupported content type. Without
 * this they fall through to the 500 branch and get logged as unhandled bugs.
 */
function isHttpishError(err: unknown): err is { status: number; type?: string; message: string } {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { status?: unknown; statusCode?: unknown };
  const status = typeof e.status === 'number' ? e.status : e.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500;
}

const BODY_KEYS: Record<string, MessageKey> = {
  'entity.too.large': 'body.tooLarge',
  'entity.parse.failed': 'body.notJson',
  'encoding.unsupported': 'body.badEncoding',
};

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  // Express 5 forwards rejected promises here automatically, so route handlers
  // do not need try/catch just to report failures.

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'bad_request',
      message: t('error.invalidInput'),
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
    return;
  }

  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  if (isPgError(err) && PG_MESSAGES[err.code]) {
    const mapped = PG_MESSAGES[err.code]!;
    console.error(`[api] ${req.method} ${req.originalUrl} pg:${err.code}`, err.detail ?? '');
    res.status(mapped.status).json({
      error: mapped.code,
      message: t(mapped.key),
      ...(config.isProduction ? {} : { pgCode: err.code, constraint: err.constraint }),
    });
    return;
  }

  if (isHttpishError(err)) {
    const e = err as { status?: number; statusCode?: number; type?: string; message: string };
    const status = e.status ?? e.statusCode!;
    const key = e.type ? BODY_KEYS[e.type] : undefined;
    res.status(status).json({
      error: e.type ?? 'bad_request',
      message: t(key ?? 'error.badRequest'),
      ...(config.isProduction ? {} : { detail: e.message }),
    });
    return;
  }

  console.error(`[api] ${req.method} ${req.originalUrl} unhandled:`, err);
  res.status(500).json({
    error: 'internal',
    message: t('error.internal'),
    ...(config.isProduction ? {} : { detail: err instanceof Error ? err.message : String(err) }),
  });
}
