/**
 * Authentication endpoints (WP §7.1).
 */
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../lib/db.ts';
import {
  DUMMY_HASH,
  clearSessionCookie,
  setSessionCookie,
  signSession,
  verifyPassword,
} from '../lib/auth.ts';
import { ACTION, log } from '../lib/activity.ts';
import { unauthorized } from '../lib/errors.ts';
import { currentUser, requireAuth, type Role } from '../middleware/auth.ts';

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().transform((s) => s.trim()).pipe(z.string().min(1).max(80)),
  password: z.string().min(1).max(200),
});

/**
 * Login throttling. In-memory and therefore per-process and reset by a restart —
 * adequate for a single-instance internal tool, and far better than nothing. If
 * this ever runs more than one replica it needs to move to the database or Redis.
 */
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 10 * 60 * 1000;
const attempts = new Map<string, { count: number; first: number }>();

function throttleKey(username: string, ip: string): string {
  return `${username.toLowerCase()}|${ip}`;
}

function isLockedOut(key: string): boolean {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > LOCKOUT_MS) {
    attempts.delete(key);
    return false;
  }
  return rec.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string): void {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > LOCKOUT_MS) {
    attempts.set(key, { count: 1, first: Date.now() });
    return;
  }
  rec.count++;
}

// Keep the map from growing without bound in a long-running process.
setInterval(() => {
  const cutoff = Date.now() - LOCKOUT_MS;
  for (const [key, rec] of attempts) if (rec.first < cutoff) attempts.delete(key);
}, LOCKOUT_MS).unref();

authRouter.post('/login', async (req, res) => {
  const { username, password } = loginSchema.parse(req.body);
  const ip = req.ip ?? 'unknown';
  const key = throttleKey(username, ip);

  if (isLockedOut(key)) {
    await log({
      userId: null,
      action: ACTION.loginFailed,
      detail: `${username} · throttled · ${ip}`,
    });
    throw unauthorized('auth.throttled');
  }

  const user = await queryOne<{
    id: number;
    username: string;
    password_hash: string;
    display_name: string;
    role: Role;
    emp_num: number | null;
    active: boolean;
  }>(
    `SELECT id, username, password_hash, display_name, role, emp_num, active
       FROM users WHERE lower(username) = lower($1)`,
    [username]
  );

  // Always run a bcrypt comparison, even for an unknown username, so response
  // timing cannot be used to enumerate valid accounts.
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);

  if (!user || !ok || !user.active) {
    recordFailure(key);
    // The reason is recorded for the administrator but never returned to the
    // caller — see the single response message below.
    await log({
      userId: user?.id ?? null,
      action: ACTION.loginFailed,
      detail: `${username} · ${!user ? 'no such user' : !ok ? 'wrong password' : 'account inactive'} · ${ip}`,
    });
    // One message for every failure mode — do not reveal which.
    throw unauthorized('auth.badCredentials');
  }

  attempts.delete(key);
  setSessionCookie(res, signSession(user.id));
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  await log({ userId: user.id, action: ACTION.login, detail: `${user.username} · ${ip}` });

  res.json({
    data: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      emp_num: user.emp_num,
    },
  });
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  const user = currentUser(req);
  clearSessionCookie(res);
  await log({ userId: user.id, action: ACTION.logout, detail: user.username });
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ data: currentUser(req) });
});
