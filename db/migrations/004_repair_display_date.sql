-- 004_repair_display_date.sql
-- Client feedback round 2 #4: a repair/ticket row must show its own date in the
-- table, not only inside the autocomplete dropdown. The date belongs to the
-- repair (when the ticket was opened), which is distinct from the report date,
-- so it has to come from the repairs table.
--
-- Rather than add a column and a second cell, we fold the date into the existing
-- display_proj_name so the archive, the grid and the Excel exports all render the
-- ticket identically — "תיקון <n> · <client> · <date>". Only the display_proj_name
-- expression changes; every other column of the view is restated verbatim so
-- CREATE OR REPLACE keeps the column list, order and types identical.
CREATE OR REPLACE VIEW v_reports_full AS
SELECT
  r.id,
  r.date,
  r.emp_num,
  e.nick             AS emp_nick,
  e.name             AS emp_name,
  e.contractor,
  e.effective_target,
  r.proj_num,
  p.nick             AS proj_nick,
  p.name             AS proj_name,
  p.client,
  p.overhead,
  r.fix,
  COALESCE(
    p.name,
    CASE WHEN r.fix IS NOT NULL THEN
      'תיקון ' || r.fix
      || CASE WHEN COALESCE(rp.client, '') <> '' THEN ' · ' || rp.client ELSE '' END
      || CASE WHEN rp.date IS NOT NULL THEN ' · ' || to_char(rp.date, 'YYYY-MM-DD') ELSE '' END
    END,
    ''
  )                  AS display_proj_name,
  rp.client          AS repair_client,
  rp.model           AS repair_model,
  r.dept,
  d.num              AS dept_num,
  d.bucket,
  r.hours,
  r.created_by,
  u.display_name     AS created_by_name,
  r.created_at,
  r.updated_at
FROM reports r
JOIN      employees   e  ON e.num  = r.emp_num
LEFT JOIN projects    p  ON p.num  = r.proj_num
LEFT JOIN repairs     rp ON rp.fix = r.fix
LEFT JOIN departments d  ON d.name = r.dept
LEFT JOIN users       u  ON u.id   = r.created_by;
