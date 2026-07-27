/**
 * Authentication and authorization middleware.
 *
 * WP §8: "Enforce permissions on the server for every endpoint — never rely on
 * the UI hiding a button." Every route below /api except the health checks and
 * login goes through requireAuth; anything that writes also names the roles
 * allowed to call it.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { queryOne } from '../lib/db.ts';
import { SESSION_COOKIE, verifySession } from '../lib/auth.ts';
import { forbidden, unauthorized } from '../lib/errors.ts';

export type Role = 'reporter' | 'manager' | 'admin';

export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  emp_num: number | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Roles that may edit master data (WP §8: manager and admin, not reporter). */
export const MASTER_WRITE: Role[] = ['manager', 'admin'];
/** Roles that may manage accounts and clear the log (WP §8: admin only). */
export const ADMIN_ONLY: Role[] = ['admin'];

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (!token) {
    next(unauthorized());
    return;
  }

  const payload = verifySession(token);
  if (!payload) {
    next(unauthorized('auth.expired'));
    return;
  }

  // Loaded per request on purpose — see the note in lib/auth.ts. A deactivated
  // account or a changed role takes effect on the very next call.
  const user = await queryOne<AuthUser & { active: boolean }>(
    `SELECT id, username, display_name, role, emp_num, active FROM users WHERE id = $1`,
    [payload.uid]
  );

  if (!user || !user.active) {
    next(unauthorized('auth.inactive'));
    return;
  }

  req.user = {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    emp_num: user.emp_num,
  };
  next();
};

/** Must be mounted after requireAuth. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(forbidden());
      return;
    }
    next();
  };
}

/** Throws rather than returning undefined, so route handlers stay readable. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
