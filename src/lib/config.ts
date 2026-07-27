/**
 * Environment configuration, validated once at boot.
 *
 * Anything missing or malformed should stop the process here rather than surface
 * as a confusing runtime failure on the third screen someone opens.
 */
import { z } from 'zod';
import 'dotenv/config';

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .or(z.boolean());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required — see .env.example'),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  COOKIE_SECURE: bool.default(false),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nCopy .env.example to .env and fill it in.');
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  /** Supabase's pooler presents a chain Node does not trust out of the box. */
  dbSsl: parsed.data.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false }
    : undefined,
} as const;

// A Secure cookie is silently dropped over plain HTTP, so the combination below
// produces a login that appears to succeed and then immediately forgets you.
// There is no TLS on this deployment yet; fail loudly if someone flips one flag
// without the other.
if (config.isProduction && !config.COOKIE_SECURE) {
  console.warn(
    '[config] WARNING: running in production with COOKIE_SECURE=false. Session ' +
      'cookies will travel in clear text. Set up TLS and flip this to true.'
  );
}
