/**
 * Authentication endpoints (WP §7.1).
 */
import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../lib/db.ts';
import {
  DUMMY_HASH,
  MIN_PASSWORD_LENGTH,
  clearSessionCookie,
  hashPassword,
  setSessionCookie,
  signSession,
  verifyPassword,
} from '../lib/auth.ts';
import { ACTION, ENTITY, log, logWith } from '../lib/activity.ts';
import { badRequest, unauthorized } from '../lib/errors.ts';
import { config } from '../lib/config.ts';
import { sendPasswordResetEmail } from '../lib/mailer.ts';
import { tf } from '../lib/messages.ts';
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

/* -------------------------------------------------------------------------- */
/* Self-service password reset (client request, 2026-08-13)                   */
/* -------------------------------------------------------------------------- */

const RESET_TTL_MINUTES = 60;

/**
 * Same in-memory throttle shape as login, with a tighter budget: three link
 * requests per username+IP per lockout window is plenty for a person and
 * useless for a mailbox-flooding loop.
 */
const RESET_MAX_REQUESTS = 3;
const resetAttempts = new Map<string, { count: number; first: number }>();

setInterval(() => {
  const cutoff = Date.now() - LOCKOUT_MS;
  for (const [key, rec] of resetAttempts) if (rec.first < cutoff) resetAttempts.delete(key);
}, LOCKOUT_MS).unref();

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

authRouter.post('/forgot', async (req, res) => {
  const { username } = z
    .object({ username: z.string().transform((s) => s.trim()).pipe(z.string().min(1).max(80)) })
    .parse(req.body);

  // Explicit 400 rather than a silent 204: the client hides the email form
  // when the flag is off, so reaching this without SMTP configured is either
  // a stale tab or someone probing — both deserve the honest answer.
  if (!config.mailEnabled) throw badRequest('auth.resetUnavailable');

  const ip = req.ip ?? 'unknown';
  const key = throttleKey(username, ip);
  const rec = resetAttempts.get(key);
  const throttled = rec !== undefined && Date.now() - rec.first <= LOCKOUT_MS && rec.count >= RESET_MAX_REQUESTS;

  if (!rec || Date.now() - rec.first > LOCKOUT_MS) {
    resetAttempts.set(key, { count: 1, first: Date.now() });
  } else {
    rec.count++;
  }

  const user = throttled
    ? null
    : await queryOne<{ id: number; username: string; display_name: string; email: string | null; active: boolean }>(
        `SELECT id, username, display_name, email, active
           FROM users WHERE lower(username) = lower($1)`,
        [username]
      );

  if (user && user.active && user.email) {
    // The plaintext token lives only in the emailed link; the database stores
    // its hash. base64url keeps it safe inside a URL fragment.
    const token = randomBytes(32).toString('base64url');
    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [user.id, sha256(token), RESET_TTL_MINUTES]
    );
    const link = `${config.APP_BASE_URL.replace(/\/+$/, '')}/#reset=${token}`;
    try {
      await sendPasswordResetEmail({
        to: user.email,
        displayName: user.display_name,
        username: user.username,
        link,
      });
      await log({ userId: user.id, action: ACTION.passwordResetRequest, detail: `${user.username} · ${ip}` });
    } catch (err) {
      // Still answer 204 — a different response here would leak that the
      // account exists. The failure is for the operator, in the server log.
      console.error('[mailer] password-reset send failed:', err instanceof Error ? err.message : err);
      await log({
        userId: user.id,
        action: ACTION.passwordResetRequest,
        detail: `${user.username} · email send FAILED · ${ip}`,
      });
    }
  } else {
    // The reason is recorded for the administrator but never returned.
    await log({
      userId: user?.id ?? null,
      action: ACTION.passwordResetRequest,
      detail: `${username} · ${throttled ? 'throttled' : !user ? 'no such user' : !user.active ? 'account inactive' : 'no email on account'} · ${ip}`,
    });
  }

  // One response for every outcome: whether the account exists, has an email,
  // or was throttled must not be observable from outside.
  res.status(204).end();
});

authRouter.post('/reset', async (req, res) => {
  const { token, password: newPassword } = z
    .object({
      token: z.string().min(20).max(200),
      password: z
        .string()
        .min(MIN_PASSWORD_LENGTH, tf('field.passwordTooShort', { n: MIN_PASSWORD_LENGTH }))
        .max(200),
    })
    .parse(req.body);

  const row = await queryOne<{ user_id: number; username: string }>(
    `SELECT prt.user_id, u.username
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
      WHERE prt.token_hash = $1
        AND prt.used_at IS NULL
        AND prt.expires_at > now()
        AND u.active`,
    [sha256(token)]
  );
  if (!row) throw badRequest('auth.resetInvalid');

  const hash = await hashPassword(newPassword);
  await withTransaction(async (client) => {
    await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [row.user_id, hash]);
    // Burn every outstanding token for this user, not just the one used —
    // an older email must not stay a working credential after a reset.
    await client.query(
      'UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
      [row.user_id]
    );
    await logWith(client, {
      userId: row.user_id,
      action: ACTION.passwordReset,
      detail: `${row.username} · via email link`,
      entity: ENTITY.user,
      entityKey: row.user_id,
    });
  });

  res.status(204).end();
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
