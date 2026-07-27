/**
 * Activity log writer.
 *
 * WP §6.7 acceptance: "Each data-changing operation produces exactly one log
 * entry attributing the correct user." So the write and its log entry go into the
 * same transaction — a change that succeeds while its audit entry is lost, or the
 * reverse, is worse than either failing outright.
 *
 * activity_log.action and .entity store stable codes (see ACTION / ENTITY in
 * lib/messages.ts), never display text. The prototype wrote Hebrew strings
 * directly into the log, which makes the history unfilterable by action type and
 * would leave a permanent mix of languages the moment anything is translated.
 */
import type { PoolClient } from 'pg';
import { query } from './db.ts';
import type { ActionCode, EntityCode } from './messages.ts';

export { ACTION, ENTITY } from './messages.ts';

export interface LogEntry {
  userId: number | null;
  action: ActionCode;
  /**
   * Free-text context: which record, which fields. Names and numbers only — never
   * a password, a token, or anything that would make the log itself sensitive.
   */
  detail?: string;
  entity?: EntityCode;
  entityKey?: string | number;
}

const SQL = `INSERT INTO activity_log (user_id, action, detail, entity, entity_key)
             VALUES ($1, $2, $3, $4, $5)`;

function params(e: LogEntry): unknown[] {
  return [
    e.userId,
    e.action,
    e.detail ?? '',
    e.entity ?? null,
    e.entityKey === undefined ? null : String(e.entityKey),
  ];
}

/**
 * Logs inside an existing transaction. Use this whenever there is a client to
 * hand — the entry then commits or rolls back with the change it describes.
 */
export async function logWith(client: PoolClient, entry: LogEntry): Promise<void> {
  await client.query(SQL, params(entry));
}

/**
 * Logs outside a transaction, for events with nothing to be atomic with (sign-in,
 * sign-out, a failed attempt). Deliberately swallows its own errors: losing an
 * audit line for a login must not turn a successful login into a 500.
 */
export async function log(entry: LogEntry): Promise<void> {
  try {
    await query(SQL, params(entry));
  } catch (err) {
    console.error('[activity] failed to write log entry:', err instanceof Error ? err.message : err);
  }
}
