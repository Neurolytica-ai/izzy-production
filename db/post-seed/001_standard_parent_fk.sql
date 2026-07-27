-- db/post-seed/001_standard_parent_fk.sql
--
-- NOT part of the normal migration run. Apply this only AFTER the initial data
-- migration, and only once the orphan parents have been dealt with.
--
-- Why it is separate:
--   WP §4.10 requires standard.parent -> projects.num. In the prototype's seed
--   data 43 of the 78 distinct parent values reference projects that do not
--   exist, so adding this constraint before seeding makes the data migration
--   fail on more than half the distinct parents.
--
--   ADD CONSTRAINT ... NOT VALID does not check rows that already exist, but it
--   DOES check every subsequent INSERT/UPDATE. That is exactly what we want:
--   the historical mess is tolerated, new bad references are rejected.
--
-- Check what you are about to grandfather in first:
--   SELECT * FROM v_orphan_standard_parents;

ALTER TABLE standard
  ADD CONSTRAINT standard_parent_fkey
  FOREIGN KEY (parent) REFERENCES projects (num)
  ON DELETE RESTRICT
  NOT VALID;

-- Once the missing projects have been created (or the orphan box rows deleted),
-- promote the constraint to fully enforced:
--
--   ALTER TABLE standard VALIDATE CONSTRAINT standard_parent_fkey;
--
-- That will error until v_orphan_standard_parents returns zero rows.
