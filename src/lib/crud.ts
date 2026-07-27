/**
 * Master-data CRUD router factory (WP §7.2).
 *
 * The five master resources differ only in table, key and validation, so they
 * share one implementation. That matters beyond tidiness: permission checks,
 * activity logging and the "blocked because rows reference this" behaviour are
 * written once and therefore cannot drift between resources.
 *
 * WP §6.6 acceptance criteria this implements:
 *   - duplicate business keys rejected with a clear message (via the unique
 *     violation mapping in lib/errors.ts)
 *   - deleting a referenced record is blocked, not cascaded (ON DELETE RESTRICT
 *     in the schema surfaces as 409)
 */
import { Router, type RequestHandler } from 'express';
import type { z } from 'zod';
import { query, queryOne, withTransaction } from './db.ts';
import { ACTION, logWith } from './activity.ts';
import { badRequest, notFound } from './errors.ts';
import { entityLabel, type EntityCode } from './messages.ts';
import { currentUser, requireRole, type Role } from '../middleware/auth.ts';

export interface CrudConfig<TRow extends Record<string, unknown>> {
  /** Table name. Interpolated into SQL, so it must never come from user input. */
  table: string;
  /** Primary key column. */
  key: string;
  /** How to coerce a path parameter into the key's type. */
  keyKind: 'int' | 'text';
  /** Columns returned by list/get, in display order. */
  select: string[];
  /** Columns writable on create. */
  insertable: string[];
  /** Columns writable on update (the key is normally excluded). */
  updatable: string[];
  createSchema: z.ZodType<Record<string, unknown>>;
  updateSchema: z.ZodType<Record<string, unknown>>;
  /** Roles allowed to write. Reading only ever requires authentication. */
  writeRoles: Role[];
  /** Stable entity code recorded in the activity log. */
  entity: EntityCode;
  /** Human-readable label for the activity log. */
  label: (row: TRow) => string;
  /** ORDER BY clause for list. Fixed string, never user input. */
  orderBy: string;
  /** Optional extra WHERE for list, driven by query params. */
  listFilter?: (params: Record<string, string | undefined>) => { sql: string; values: unknown[] };
}

/**
 * Express 5 types a path parameter as `string | string[]` (a repeated parameter
 * yields an array). Narrow it here rather than casting at each call site, so a
 * crafted path cannot smuggle an array into a query parameter.
 */
function coerceKey(raw: string | string[] | undefined, kind: 'int' | 'text'): string | number {
  if (typeof raw !== 'string' || raw === '') throw badRequest('key.missing');

  if (kind === 'text') {
    const decoded = decodeURIComponent(raw).trim();
    if (!decoded) throw badRequest('key.missing');
    return decoded;
  }

  const n = Number(raw);
  if (!Number.isInteger(n)) throw badRequest('key.invalid');
  return n;
}

export function createCrudRouter<TRow extends Record<string, unknown>>(
  cfg: CrudConfig<TRow>
): Router {
  const router = Router();
  const cols = cfg.select.map((c) => `"${c}"`).join(', ');
  const write = requireRole(...cfg.writeRoles);

  // ---- list ---------------------------------------------------------------
  const list: RequestHandler = async (req, res) => {
    const extra = cfg.listFilter?.(req.query as Record<string, string | undefined>);
    const where = extra?.sql ? `WHERE ${extra.sql}` : '';
    const rows = await query<TRow>(
      `SELECT ${cols} FROM ${cfg.table} ${where} ORDER BY ${cfg.orderBy}`,
      extra?.values ?? []
    );
    res.json({ data: rows, count: rows.length });
  };

  // ---- get one ------------------------------------------------------------
  const getOne: RequestHandler = async (req, res) => {
    const key = coerceKey(req.params.key, cfg.keyKind);
    const row = await queryOne<TRow>(
      `SELECT ${cols} FROM ${cfg.table} WHERE "${cfg.key}" = $1`,
      [key]
    );
    if (!row) throw notFound();
    res.json({ data: row });
  };

  // ---- create -------------------------------------------------------------
  const create: RequestHandler = async (req, res) => {
    const user = currentUser(req);
    const parsed = cfg.createSchema.parse(req.body);

    const columns = cfg.insertable.filter((c) => parsed[c] !== undefined);
    if (columns.length === 0) throw badRequest('body.empty');

    const values = columns.map((c) => parsed[c]);
    const placeholders = columns.map((_, i) => `$${i + 1}`);

    const row = await withTransaction(async (client) => {
      const inserted = await client.query<TRow>(
        `INSERT INTO ${cfg.table} (${columns.map((c) => `"${c}"`).join(', ')})
         VALUES (${placeholders.join(', ')})
         RETURNING ${cols}`,
        values
      );
      const created = inserted.rows[0]!;
      await logWith(client, {
        userId: user.id,
        action: ACTION.masterAdd,
        detail: `${entityLabel(cfg.entity)}: ${cfg.label(created)}`,
        entity: cfg.entity,
        entityKey: created[cfg.key] as string | number,
      });
      return created;
    });

    res.status(201).json({ data: row });
  };

  // ---- update -------------------------------------------------------------
  const update: RequestHandler = async (req, res) => {
    const user = currentUser(req);
    const key = coerceKey(req.params.key, cfg.keyKind);
    const parsed = cfg.updateSchema.parse(req.body);

    const columns = cfg.updatable.filter((c) => parsed[c] !== undefined);
    if (columns.length === 0) throw badRequest('body.noFields');

    const sets = columns.map((c, i) => `"${c}" = $${i + 2}`);
    const values = columns.map((c) => parsed[c]);

    const row = await withTransaction(async (client) => {
      const updated = await client.query<TRow>(
        `UPDATE ${cfg.table} SET ${sets.join(', ')} WHERE "${cfg.key}" = $1 RETURNING ${cols}`,
        [key, ...values]
      );
      if (updated.rowCount === 0) throw notFound();
      const after = updated.rows[0]!;
      await logWith(client, {
        userId: user.id,
        action: ACTION.masterEdit,
        detail: `${entityLabel(cfg.entity)}: ${cfg.label(after)} · ${columns.join(', ')}`,
        entity: cfg.entity,
        entityKey: key,
      });
      return after;
    });

    res.json({ data: row });
  };

  // ---- delete -------------------------------------------------------------
  const remove: RequestHandler = async (req, res) => {
    const user = currentUser(req);
    const key = coerceKey(req.params.key, cfg.keyKind);

    await withTransaction(async (client) => {
      // Read first so the log entry can name what was removed.
      const existing = await client.query<TRow>(
        `SELECT ${cols} FROM ${cfg.table} WHERE "${cfg.key}" = $1`,
        [key]
      );
      if (existing.rowCount === 0) throw notFound();
      const row = existing.rows[0]!;

      // A foreign-key violation here is expected, not exceptional: the schema
      // uses ON DELETE RESTRICT so history is never cascaded away (WP §4.10).
      // errorHandler maps 23503 to 409 with a message the user can act on.
      await client.query(`DELETE FROM ${cfg.table} WHERE "${cfg.key}" = $1`, [key]);

      await logWith(client, {
        userId: user.id,
        action: ACTION.masterDelete,
        detail: `${entityLabel(cfg.entity)}: ${cfg.label(row)}`,
        entity: cfg.entity,
        entityKey: key,
      });
    });

    res.status(204).end();
  };

  router.get('/', list);
  router.get('/:key', getOne);
  router.post('/', write, create);
  router.put('/:key', write, update);
  router.delete('/:key', write, remove);

  return router;
}
