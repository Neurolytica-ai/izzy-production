-- 007 — closed repair tickets (client feedback round 3, 2026-09-30).
--
-- The hours grid's suggestion lists must offer only what is currently open:
-- projects already have `archived` (006); tickets get `closed`. The workbook
-- import closes a ticket that is no longer on the "repairs" sheet — only after
-- the user confirms it in the preview — and re-opens one that reappears.
-- A closed ticket keeps its report history; it is just not offered for new rows.
--
-- Additive with a default: code that predates it is unaffected.

ALTER TABLE repairs ADD COLUMN IF NOT EXISTS closed boolean NOT NULL DEFAULT false;
