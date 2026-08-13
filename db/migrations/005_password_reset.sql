-- 005 — self-service password reset (client request, 2026-08-13).
--
-- users.email is where reset links are sent. It is optional: accounts without
-- one keep working and fall back to an admin reset in the Users tab, so the
-- admin can fill addresses in gradually.
--
-- password_reset_tokens stores only a SHA-256 hash of the token. The plaintext
-- token exists solely inside the emailed link — a database leak must not hand
-- out working reset links.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email text NULL;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
  ON password_reset_tokens (user_id);
