/**
 * Authentication primitives — password hashing and session tokens.
 *
 * WP §8: username + password (bcrypt-hashed), server session as an http-only
 * cookie. The token carries only the user id; the middleware loads the user on
 * every request so that disabling an account or changing its role takes effect
 * immediately rather than at the end of a 12-hour token life. At this scale
 * (about ten users) the extra query per request costs nothing and removes a
 * whole class of "I revoked access but they were still in" problem.
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { config } from './config.ts';

export const SESSION_COOKIE = 'izy_session';

/**
 * Cost 12: roughly 250ms per verification on modest hardware. Deliberate — it is
 * the main defence against offline cracking if the hash table ever leaks, and
 * logins are rare enough that the latency is invisible.
 */
const BCRYPT_ROUNDS = 12;

/** WP §8: "enforce a minimum length". */
export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * A dummy hash to compare against when the username does not exist, so that a
 * missing user and a wrong password take the same amount of time. Without this,
 * response timing enumerates valid usernames.
 */
export const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.ehZLmpuMhCPKWJPtVLnBGFCPnHkVBBu';

export interface SessionPayload {
  uid: number;
}

export function signSession(userId: number): string {
  return jwt.sign({ uid: userId } satisfies SessionPayload, config.SESSION_SECRET, {
    expiresIn: `${config.SESSION_TTL_HOURS}h`,
  });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, config.SESSION_SECRET);
    if (typeof decoded !== 'object' || decoded === null) return null;
    const uid = (decoded as Record<string, unknown>).uid;
    return typeof uid === 'number' ? { uid } : null;
  } catch {
    // Expired or tampered — indistinguishable to the caller on purpose.
    return null;
  }
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    // COOKIE_SECURE must stay false until TLS is in place: a Secure cookie is
    // silently dropped over plain HTTP, which looks like a login that succeeds
    // and then instantly forgets you.
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    maxAge: config.SESSION_TTL_HOURS * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
  });
}
