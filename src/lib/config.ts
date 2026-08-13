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
  /**
   * Language for user-facing messages. Defaults to English for development;
   * production at Izzy Yogev runs 'he'. Both translations always ship — see
   * lib/messages.ts. Changing this needs a restart.
   */
  UI_LANG: z.enum(['en', 'he']).default('en'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
  /**
   * Outbound email, used only for self-service password-reset links. All of
   * these plus APP_BASE_URL must be set for the feature to switch on; while any
   * are missing the login screen falls back to "contact your administrator".
   */
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default(''),
  /** Public origin the emailed reset links point at, e.g. https://srv1859122.hstgr.cloud */
  APP_BASE_URL: z.string().default(''),
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

const mailVars = [
  parsed.data.SMTP_HOST,
  parsed.data.SMTP_USER,
  parsed.data.SMTP_PASS,
  parsed.data.SMTP_FROM,
  parsed.data.APP_BASE_URL,
];

export const config = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  /** Supabase's pooler presents a chain Node does not trust out of the box. */
  dbSsl: parsed.data.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false }
    : undefined,
  /** True only when every SMTP_* var and APP_BASE_URL are present. */
  mailEnabled: mailVars.every(Boolean),
} as const;

// A half-filled SMTP block means someone meant to enable email reset and
// mistyped a variable name — the feature silently staying off would be the
// confusing failure mode, so call it out at boot.
if (!config.mailEnabled && mailVars.some(Boolean)) {
  console.warn(
    '[config] WARNING: partial SMTP configuration — email password reset stays ' +
      'DISABLED. Set all of SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM and ' +
      'APP_BASE_URL to enable it.'
  );
}

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
