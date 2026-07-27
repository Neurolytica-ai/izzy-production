/**
 * API error types and the Express error handler.
 *
 * WP §7: validation errors return 400 with a message, permission failures 403.
 */
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { config } from './config.ts';

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

export const badRequest = (msg: string, details?: unknown) =>
  new ApiError(400, msg, 'bad_request', details);
export const unauthorized = (msg = 'נדרשת התחברות') => new ApiError(401, msg, 'unauthorized');
export const forbidden = (msg = 'אין הרשאה לפעולה זו') => new ApiError(403, msg, 'forbidden');
export const notFound = (msg = 'הרשומה לא נמצאה') => new ApiError(404, msg, 'not_found');
export const conflict = (msg: string) => new ApiError(409, msg, 'conflict');

/** Postgres error codes we can turn into something a user can act on. */
const PG_MESSAGES: Record<string, { status: number; message: string }> = {
  '23505': { status: 409, message: 'רשומה עם מספר זה כבר קיימת' }, // unique_violation
  '23503': { status: 409, message: 'לא ניתן לבצע: קיימות רשומות המקושרות לרשומה זו' }, // fk_violation
  '23514': { status: 400, message: 'הנתונים אינם עומדים בכללי המערכת' }, // check_violation
  '23502': { status: 400, message: 'חסר שדה חובה' }, // not_null_violation
  '22P02': { status: 400, message: 'פורמט נתונים שגוי' }, // invalid_text_representation
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

const BODY_MESSAGES: Record<string, string> = {
  'entity.too.large': 'הקובץ או הבקשה גדולים מדי',
  'entity.parse.failed': 'תוכן הבקשה אינו JSON תקין',
  'encoding.unsupported': 'קידוד התוכן אינו נתמך',
};

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  // Express 5 forwards rejected promises here automatically, so route handlers
  // do not need try/catch just to report failures.

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'bad_request',
      message: 'קלט לא תקין',
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
      error: 'database',
      message: mapped.message,
      ...(config.isProduction ? {} : { pgCode: err.code, constraint: err.constraint }),
    });
    return;
  }

  if (isHttpishError(err)) {
    const e = err as { status?: number; statusCode?: number; type?: string; message: string };
    const status = e.status ?? e.statusCode!;
    res.status(status).json({
      error: e.type ?? 'bad_request',
      message: (e.type && BODY_MESSAGES[e.type]) ?? 'הבקשה אינה תקינה',
      ...(config.isProduction ? {} : { detail: e.message }),
    });
    return;
  }

  console.error(`[api] ${req.method} ${req.originalUrl} unhandled:`, err);
  res.status(500).json({
    error: 'internal',
    message: 'שגיאת מערכת. נסה שוב או פנה למנהל המערכת.',
    ...(config.isProduction ? {} : { detail: err instanceof Error ? err.message : String(err) }),
  });
}
