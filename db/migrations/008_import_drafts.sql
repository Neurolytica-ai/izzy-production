-- 008 — pending workbook imports (client feedback round 4 #2/#3, 2026-10-06).
--
-- An uploaded workbook that has not been approved yet used to live only in the
-- Import screen's memory: switching tabs or refreshing lost it, and the user had
-- to upload and wait again. It is now kept here, one per user, until it is
-- approved, cancelled, or expires (the client asked for at least 30 minutes;
-- the app keeps it 2 hours from the last change).
--
--   extract_gz  the workbook's data as the browser extracted it (gzipped JSON,
--               ~2 MB) — approval re-checks THIS against the database, so what
--               is applied is current even if the data changed meanwhile;
--   preview     what the review screen shows (counts, changes, new hours rows);
--   choices     the user's decisions so far — records ticked for removal and
--               duplicated hours rows (#3) — so a refresh loses nothing.
--
-- A new table only: code that predates it is unaffected.

CREATE TABLE IF NOT EXISTS import_drafts (
  user_id    bigint      PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  file_name  text        NOT NULL,
  extract_gz bytea       NOT NULL,
  preview    jsonb       NOT NULL,
  choices    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS import_drafts_expires_idx ON import_drafts (expires_at);
