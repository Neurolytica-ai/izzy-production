-- 006 — archived projects (hours-history import, Arad 2026-09-29).
--
-- The office workbook's "דיווחי שעות" sheet carries report history back to
-- 2012. Most of it books hours to ~2,450 old projects that the current project
-- list (sheet ProjectNum) no longer has, and reports.proj_num is a real FK — so
-- the import creates those projects, flagged archived. Archived projects keep
-- their history visible (archive, exports, dashboard) but are left out of the
-- hours grid's project suggestions so they do not bury the live ones. A project
-- that reappears in ProjectNum is un-archived by the next import.
--
-- Additive with a default: code that predates it is unaffected.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
