/**
 * Creates or updates an account.
 *
 *   npm run user:create -- --username admin --name "מנהל מערכת" --role admin
 *   npm run user:create -- --username yigal --name "יגאל" --role manager --emp 221
 *   npm run user:create -- --username yigal --reset-password
 *   npm run user:create -- --username yigal --rename-to admin --reset-password
 *
 * --rename-to changes the login name in place, so the account keeps its id and
 * its activity-log history stays attributed to it. Creating a replacement account
 * and deleting the old one would orphan that history (user_id is ON DELETE SET
 * NULL, so the entries survive but stop naming anyone).
 *
 * The password is generated and printed once unless --password is given. There is
 * deliberately no seeded default account: a migration that ships admin/admin is
 * the single most common way an internal tool ends up publicly writable.
 *
 * Passing --password puts the secret in your shell history. Prefer the generated
 * one and change it after first login.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import 'dotenv/config';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/lib/auth.ts';
import { ACTION, ENTITY } from '../src/lib/messages.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

/** Ambiguity-free alphabet: no O/0, l/1/I. These get read off a screen and typed. */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(20);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

async function main() {
  const username = arg('username');
  if (!username) {
    console.error('Usage: npm run user:create -- --username <name> [--name <display>] [--role reporter|manager|admin] [--emp <num>] [--password <pw>] [--reset-password]');
    process.exit(1);
  }

  const role = arg('role') ?? 'reporter';
  if (!['reporter', 'manager', 'admin'].includes(role)) {
    console.error(`Invalid role "${role}". Must be reporter, manager or admin.`);
    process.exit(1);
  }

  const explicit = arg('password');
  if (explicit && explicit.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }
  const plain = explicit ?? generatePassword();

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    const existing = await client.query<{ id: number; role: string }>(
      'SELECT id, role FROM users WHERE lower(username) = lower($1)',
      [username]
    );

    const empNum = arg('emp') ? Number(arg('emp')) : null;
    if (empNum !== null) {
      const emp = await client.query('SELECT num, name FROM employees WHERE num = $1', [empNum]);
      if (emp.rowCount === 0) {
        console.error(`No employee with number ${empNum}. Omit --emp or use an existing number.`);
        process.exit(1);
      }
      console.log(`Linking to employee ${empNum} (${emp.rows[0]!.name})`);
    }

    const hash = await hashPassword(plain);

    const renameTo = arg('rename-to')?.trim();
    if (renameTo && !/^\S{3,80}$/.test(renameTo)) {
      console.error('--rename-to must be 3-80 characters with no spaces.');
      process.exit(1);
    }

    if (existing.rowCount && existing.rowCount > 0) {
      const id = existing.rows[0]!.id;
      if (!flag('reset-password') && !explicit && !renameTo) {
        console.error(
          `User "${username}" already exists. Pass --reset-password to set a new password, ` +
            `--rename-to <name> to change the login name, or use the API to change role/details.`
        );
        process.exit(1);
      }

      if (renameTo) {
        const clash = await client.query('SELECT 1 FROM users WHERE lower(username) = lower($1) AND id <> $2', [renameTo, id]);
        if (clash.rowCount && clash.rowCount > 0) {
          console.error(`Cannot rename: "${renameTo}" is already taken.`);
          process.exit(1);
        }
        await client.query('UPDATE users SET username = $2 WHERE id = $1', [id, renameTo]);
        await client.query(
          `INSERT INTO activity_log (user_id, action, detail, entity, entity_key)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, ACTION.userEdit, `${username} renamed to ${renameTo} · via CLI`, ENTITY.user, String(id)]
        );
        console.log(`\nRenamed "${username}" to "${renameTo}".`);
      }

      if (flag('reset-password') || explicit) {
        await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, hash]);
      } else {
        // Rename only — nothing further to do, and no password to print.
        console.log('Password unchanged.');
        return;
      }
      // After a rename the old name is gone — log and report the new one.
      const effectiveName = renameTo ?? username;
      await client.query(
        `INSERT INTO activity_log (user_id, action, detail, entity, entity_key)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, ACTION.passwordReset, `${effectiveName} · via CLI`, ENTITY.user, String(id)]
      );
      console.log(`Password reset for "${effectiveName}".`);
    } else {
      const displayName = arg('name') ?? username;
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO users (username, password_hash, display_name, role, emp_num, active)
         VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [username, hash, displayName, role, empNum]
      );
      const id = inserted.rows[0]!.id;
      await client.query(
        `INSERT INTO activity_log (user_id, action, detail, entity, entity_key)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, ACTION.userAdd, `${username} · role ${role} · via CLI`, ENTITY.user, String(id)]
      );
      console.log(`\nCreated user "${username}" (${role}), id ${id}.`);
    }

    if (!explicit) {
      console.log(`\n  password: ${plain}\n`);
      console.log('This is shown once and is not stored anywhere in plain text.');
      console.log('Give it to the user over a channel you trust, and have them change it.');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('\nuser:create failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
