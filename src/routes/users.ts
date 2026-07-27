/**
 * Account management (WP §7.2, admin only).
 *
 * Not built on the generic CRUD factory because passwords need separate handling:
 * they are hashed on write and must never appear in any response.
 */
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../lib/db.ts';
import { MIN_PASSWORD_LENGTH, hashPassword } from '../lib/auth.ts';
import { ACTION, ENTITY, logWith } from '../lib/activity.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { t, tf } from '../lib/messages.ts';
import { ADMIN_ONLY, currentUser, requireRole } from '../middleware/auth.ts';

export const usersRouter = Router();

// Every route here is admin-only.
usersRouter.use(requireRole(...ADMIN_ONLY));

/** Columns safe to return. password_hash is never among them. */
const SAFE = 'id, username, display_name, role, emp_num, active, last_login_at, created_at';

const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, tf('field.passwordTooShort', { n: MIN_PASSWORD_LENGTH }))
  .max(200);

const createSchema = z.object({
  username: z
    .string()
    .transform((s) => s.trim())
    .pipe(
      z
        .string()
        .min(3, t('field.usernameTooShort'))
        .max(80)
        .regex(/^\S+$/, t('field.usernameNoSpaces'))
    ),
  password,
  display_name: z.string().transform((s) => s.trim()).pipe(z.string().min(1).max(120)),
  role: z.enum(['reporter', 'manager', 'admin']).default('reporter'),
  emp_num: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
  active: z.coerce.boolean().default(true),
});

const updateSchema = z.object({
  display_name: z.string().transform((s) => s.trim()).pipe(z.string().min(1).max(120)).optional(),
  role: z.enum(['reporter', 'manager', 'admin']).optional(),
  emp_num: z.coerce.number().int().positive().nullish().transform((v) => v ?? null).optional(),
  active: z.coerce.boolean().optional(),
});

usersRouter.get('/', async (_req, res) => {
  const rows = await query(`SELECT ${SAFE} FROM users ORDER BY username`);
  res.json({ data: rows, count: rows.length });
});

usersRouter.get('/:id', async (req, res) => {
  const row = await queryOne(`SELECT ${SAFE} FROM users WHERE id = $1`, [Number(req.params.id)]);
  if (!row) throw notFound();
  res.json({ data: row });
});

usersRouter.post('/', async (req, res) => {
  const actor = currentUser(req);
  const input = createSchema.parse(req.body);
  const hash = await hashPassword(input.password);

  const row = await withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO users (username, password_hash, display_name, role, emp_num, active)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${SAFE}`,
      [input.username, hash, input.display_name, input.role, input.emp_num, input.active]
    );
    const created = inserted.rows[0]!;
    await logWith(client, {
      userId: actor.id,
      action: ACTION.userAdd,
      detail: `${input.username} · role ${input.role}`,
      entity: ENTITY.user,
      entityKey: created.id as number,
    });
    return created;
  });

  res.status(201).json({ data: row });
});

usersRouter.put('/:id', async (req, res) => {
  const actor = currentUser(req);
  const id = Number(req.params.id);
  const input = updateSchema.parse(req.body);

  const fields = Object.entries(input).filter(([, v]) => v !== undefined);
  if (fields.length === 0) throw badRequest('body.noFields');

  // Guard against an admin removing their own access and locking everyone out.
  if (id === actor.id) {
    if (input.active === false) throw badRequest('user.noSelfDeactivate');
    if (input.role && input.role !== 'admin') {
      throw badRequest('user.noSelfDemote');
    }
  }

  // Never leave the system with no way in.
  if (input.active === false || (input.role && input.role !== 'admin')) {
    const others = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active AND id <> $1`,
      [id]
    );
    if ((others?.n ?? 0) === 0) {
      throw badRequest('user.lastAdmin');
    }
  }

  const sets = fields.map(([k], i) => `"${k}" = $${i + 2}`);
  const values = fields.map(([, v]) => v);

  const row = await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING ${SAFE}`,
      [id, ...values]
    );
    if (updated.rowCount === 0) throw notFound();
    await logWith(client, {
      userId: actor.id,
      action: ACTION.userEdit,
      detail: `${updated.rows[0]!.username} · ${fields.map(([k]) => k).join(', ')}`,
      entity: ENTITY.user,
      entityKey: id,
    });
    return updated.rows[0]!;
  });

  res.json({ data: row });
});

/** WP §8: "support an admin password reset". */
usersRouter.put('/:id/password', async (req, res) => {
  const actor = currentUser(req);
  const id = Number(req.params.id);
  const { password: newPassword } = z.object({ password }).parse(req.body);
  const hash = await hashPassword(newPassword);

  await withTransaction(async (client) => {
    const updated = await client.query<{ username: string }>(
      'UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING username',
      [id, hash]
    );
    if (updated.rowCount === 0) throw notFound();
    await logWith(client, {
      userId: actor.id,
      action: ACTION.passwordReset,
      // The password itself is obviously never logged.
      detail: updated.rows[0]!.username,
      entity: ENTITY.user,
      entityKey: id,
    });
  });

  res.status(204).end();
});

usersRouter.delete('/:id', async (req, res) => {
  const actor = currentUser(req);
  const id = Number(req.params.id);

  if (id === actor.id) throw badRequest('user.noSelfDelete');

  const remainingAdmins = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active AND id <> $1`,
    [id]
  );
  if ((remainingAdmins?.n ?? 0) === 0) {
    throw badRequest('user.lastAdmin');
  }

  await withTransaction(async (client) => {
    const existing = await client.query<{ username: string }>(
      'SELECT username FROM users WHERE id = $1',
      [id]
    );
    if (existing.rowCount === 0) throw notFound();

    // activity_log.user_id and reports.created_by are ON DELETE SET NULL, so
    // history survives the account being removed.
    await client.query('DELETE FROM users WHERE id = $1', [id]);
    await logWith(client, {
      userId: actor.id,
      action: ACTION.userDelete,
      detail: existing.rows[0]!.username,
      entity: ENTITY.user,
      entityKey: id,
    });
  });

  res.status(204).end();
});
