-- 003_views_and_rules.sql
-- The business rules from WP §5 expressed in SQL, so the API, the dashboard and
-- any future report cannot disagree about them.
--
-- Note on epsilons: the prototype compares hours with a 0.001 fudge factor
-- (statusOf, finalizeDraft) because JS numbers are binary floats. Every hours
-- column here is numeric(5,2) — exact decimal — so the comparisons below are
-- plain >= / > with no fudge. Do not port the epsilons.

-- ---------------------------------------------------------------------------
-- Reports, with every derived/display field resolved from master data.
-- Replaces the prototype's denormalized snapshot columns and derivedVal().
-- ---------------------------------------------------------------------------
CREATE VIEW v_reports_full AS
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
  -- Mirrors stampRepair() + derivedVal('projName') in the prototype: a repair
  -- row displays as "תיקון <n> · <client>" where no project is set.
  COALESCE(
    p.name,
    CASE WHEN r.fix IS NOT NULL THEN
      'תיקון ' || r.fix || CASE WHEN COALESCE(rp.client, '') <> '' THEN ' · ' || rp.client ELSE '' END
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

COMMENT ON VIEW v_reports_full IS
  'Reports with employee/project/department/repair fields resolved. The read model for the archive and the reporting grid.';

-- ---------------------------------------------------------------------------
-- Standard hours rolled up from boxes to parent project (WP §5.3).
-- ---------------------------------------------------------------------------
CREATE VIEW v_standard_by_parent AS
SELECT
  parent                AS proj_num,
  count(*)::integer     AS boxes,
  sum(total)::integer   AS std_total,
  sum(pah)::integer       AS pah,
  sum(misgarot)::integer  AS misgarot,
  sum(hazraka)::integer   AS hazraka,
  sum(panelim)::integer   AS panelim,
  sum(hadbaka)::integer   AS hadbaka,
  sum(ritum)::integer     AS ritum,
  sum(dlatot)::integer    AS dlatot,
  sum(hashmal)::integer   AS hashmal,
  sum(psei)::integer      AS psei,
  sum(hashlamot)::integer AS hashlamot
FROM standard
WHERE parent IS NOT NULL
GROUP BY parent;

-- ---------------------------------------------------------------------------
-- Data-quality: box rows whose parent project does not exist.
-- 43 of 78 distinct parents in the prototype's seed data. WP §4.10 wants this
-- as an enforced FK; see db/post-seed/001_standard_parent_fk.sql.
-- ---------------------------------------------------------------------------
CREATE VIEW v_orphan_standard_parents AS
SELECT
  s.parent          AS missing_proj_num,
  count(*)::integer AS box_count,
  sum(s.total)::integer AS orphaned_std_hours,
  min(s.box)        AS example_box
FROM standard s
LEFT JOIN projects p ON p.num = s.parent
WHERE s.parent IS NOT NULL AND p.num IS NULL
GROUP BY s.parent
ORDER BY s.parent;

COMMENT ON VIEW v_orphan_standard_parents IS
  'Standard-hours rows pointing at a non-existent parent project. These are invisible on the dashboard: budget-vs-actual only shows projects present in both tables.';

-- ---------------------------------------------------------------------------
-- WP §5.5 + §5.6 — daily coverage and attendance cross-check for one date.
-- Returns a row per ACTIVE employee, including those who reported nothing
-- (which a plain view over reports could not do).
-- ---------------------------------------------------------------------------
CREATE FUNCTION fn_coverage(p_date date)
RETURNS TABLE (
  emp_num        integer,
  nick           text,
  name           text,
  contractor     text,
  is_contractor  boolean,
  reported       numeric,
  target         numeric,
  status         text,
  clock          numeric,
  variance       numeric,
  flagged        boolean
)
LANGUAGE sql STABLE AS $$
  SELECT
    e.num,
    e.nick,
    e.name,
    e.contractor,
    e.contractor IS NOT NULL,
    COALESCE(r.reported, 0)::numeric,
    e.effective_target::numeric,
    CASE
      WHEN COALESCE(r.reported, 0) <= 0                 THEN 'not_reported'
      WHEN COALESCE(r.reported, 0) >= e.effective_target THEN 'complete'
      ELSE 'partial'
    END,
    a.hours::numeric,
    CASE WHEN a.hours IS NULL THEN NULL
         ELSE (a.hours - COALESCE(r.reported, 0))::numeric END,
    -- WP §5.5: |clock - reported| > 1.0 is flagged. No clock entry = not flagged.
    CASE WHEN a.hours IS NULL THEN false
         ELSE abs(a.hours - COALESCE(r.reported, 0)) > 1.0 END
  FROM employees e
  LEFT JOIN (
    SELECT emp_num, sum(hours) AS reported
    FROM reports
    WHERE date = p_date
    GROUP BY emp_num
  ) r ON r.emp_num = e.num
  LEFT JOIN attendance a ON a.emp_num = e.num AND a.date = p_date
  WHERE e.active
  -- Prototype sorts least-covered first so the gaps surface at the top.
  ORDER BY COALESCE(r.reported, 0) ASC, e.nick ASC;
$$;

COMMENT ON FUNCTION fn_coverage(date) IS
  'WP §5.5/§5.6. Backs GET /api/coverage?date=. One row per active employee.';

-- ---------------------------------------------------------------------------
-- WP §5.3 — budget control: standard vs actual per productive project.
-- Overhead projects are excluded by definition (WP §5.4).
-- ---------------------------------------------------------------------------
CREATE FUNCTION fn_budget_vs_actual(
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_client text DEFAULT NULL
)
RETURNS TABLE (
  proj_num    integer,
  proj_nick   text,
  proj_name   text,
  client      text,
  boxes       integer,
  std_total   integer,
  actual      numeric,
  variance    numeric,
  utilization numeric,
  state       text
)
LANGUAGE sql STABLE AS $$
  SELECT
    p.num,
    p.nick,
    p.name,
    p.client,
    COALESCE(s.boxes, 0),
    COALESCE(s.std_total, 0),
    COALESCE(a.actual, 0)::numeric,
    (COALESCE(a.actual, 0) - COALESCE(s.std_total, 0))::numeric,
    CASE WHEN COALESCE(s.std_total, 0) > 0
         THEN round(COALESCE(a.actual, 0) * 100.0 / s.std_total, 1)
         ELSE NULL END,
    CASE
      WHEN COALESCE(s.std_total, 0) = 0 THEN 'no_standard'
      WHEN COALESCE(a.actual, 0) > s.std_total THEN 'overrun'
      WHEN COALESCE(a.actual, 0) < s.std_total THEN 'saving'
      ELSE 'on_target'
    END
  FROM projects p
  LEFT JOIN v_standard_by_parent s ON s.proj_num = p.num
  LEFT JOIN (
    SELECT proj_num, sum(hours) AS actual
    FROM reports
    WHERE proj_num IS NOT NULL
      AND (p_from IS NULL OR date >= p_from)
      AND (p_to   IS NULL OR date <= p_to)
    GROUP BY proj_num
  ) a ON a.proj_num = p.num
  WHERE NOT p.overhead
    AND (p_client IS NULL OR p.client = p_client)
    -- Only projects with hours in the period. A project that has a standard but
    -- no reported hours yet is not "in progress", and including it would report
    -- its entire standard as a saving (variance = 0 - std_total), which reads as
    -- a spectacular efficiency win rather than "not started". The prototype
    -- avoids this by building its table from reported rows outward; so do we.
    AND COALESCE(a.actual, 0) > 0
  ORDER BY (COALESCE(a.actual, 0) - COALESCE(s.std_total, 0)) DESC;
$$;

COMMENT ON FUNCTION fn_budget_vs_actual(date, date, text) IS
  'WP §5.3. Unlike the prototype, projects with no standard defined are returned with state=no_standard instead of being silently dropped (WP §6.4 acceptance criterion).';

-- ---------------------------------------------------------------------------
-- Hours grouped into costing buckets (the dashboard's department chart).
-- Departments with bucket IS NULL are excluded — WP §5.2.
-- ---------------------------------------------------------------------------
CREATE FUNCTION fn_bucket_hours(
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_client text DEFAULT NULL
)
RETURNS TABLE (
  bucket     text,
  label_he   text,
  hours      numeric,
  sort_order smallint
)
LANGUAGE sql STABLE AS $$
  SELECT b.key, b.label_he, COALESCE(sum(r.hours), 0)::numeric, b.sort_order
  FROM buckets b
  LEFT JOIN departments d ON d.bucket = b.key
  LEFT JOIN reports     r ON r.dept   = d.name
    AND (p_from IS NULL OR r.date >= p_from)
    AND (p_to   IS NULL OR r.date <= p_to)
  LEFT JOIN projects    p ON p.num    = r.proj_num
  WHERE (p_client IS NULL OR p.client = p_client)
  GROUP BY b.key, b.label_he, b.sort_order
  HAVING COALESCE(sum(r.hours), 0) > 0
  ORDER BY COALESCE(sum(r.hours), 0) DESC;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard KPI cards (WP §6.4). Productive/overhead ratio counts ALL hours;
-- the budget table above counts only productive ones (WP §5.4).
-- ---------------------------------------------------------------------------
CREATE FUNCTION fn_dashboard_kpis(
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_client text DEFAULT NULL
)
RETURNS TABLE (
  total_hours      numeric,
  productive_hours numeric,
  overhead_hours   numeric,
  productive_pct   numeric,
  overhead_pct     numeric,
  overruns         integer,
  savings          integer,
  no_standard      integer
)
LANGUAGE sql STABLE AS $$
  WITH h AS (
    SELECT
      COALESCE(sum(r.hours), 0)                                            AS total,
      COALESCE(sum(r.hours) FILTER (WHERE NOT p.overhead), 0)              AS prod,
      COALESCE(sum(r.hours) FILTER (WHERE p.overhead), 0)                  AS oh
    FROM reports r
    JOIN projects p ON p.num = r.proj_num
    WHERE (p_from IS NULL OR r.date >= p_from)
      AND (p_to   IS NULL OR r.date <= p_to)
      AND (p_client IS NULL OR p.client = p_client)
  ), b AS (
    SELECT
      count(*) FILTER (WHERE state = 'overrun')::integer     AS overruns,
      count(*) FILTER (WHERE state = 'saving')::integer      AS savings,
      count(*) FILTER (WHERE state = 'no_standard')::integer AS no_standard
    FROM fn_budget_vs_actual(p_from, p_to, p_client)
  )
  SELECT
    h.total::numeric,
    h.prod::numeric,
    h.oh::numeric,
    CASE WHEN h.total > 0 THEN round(h.prod * 100.0 / h.total, 1) ELSE 0 END,
    CASE WHEN h.total > 0 THEN round(h.oh   * 100.0 / h.total, 1) ELSE 0 END,
    b.overruns, b.savings, b.no_standard
  FROM h, b;
$$;
