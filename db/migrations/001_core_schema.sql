-- 001_core_schema.sql
-- Izzy Yogev Technologies — Production Management & Control System
-- Core relational schema. Replaces the prototype's IndexedDB object stores.
--
-- Design notes (deviations from the work plan are deliberate and marked WP:):
--
-- WP §4.5 lists denormalized snapshot columns on reports (empNick, projNick,
--   projName, empName, deptNum) and then says "server should re-resolve from
--   master". Storing them guarantees drift the first time a nickname changes.
--   They are NOT stored here; v_reports_full resolves them on read instead.
--
-- WP §5.1 (daily target: explicit override, else 10.5 for subcontractors /
--   8.5 for internal) is a GENERATED column so the rule cannot drift between
--   the API, the dashboard and any future report.
--
-- WP §4.10 requires standard.parent -> projects.num. 43 of the 78 distinct
--   parent values in the prototype's seed data reference projects that do not
--   exist. That FK is therefore added in 003 as NOT VALID: new writes are
--   checked, the existing orphans are tolerated and surfaced by
--   v_orphan_standard_parents rather than silently blocking the data migration.

-- ---------------------------------------------------------------------------
-- Reference: standard-hours buckets (10 fixed costing buckets)
-- ---------------------------------------------------------------------------
CREATE TABLE buckets (
  key        text PRIMARY KEY,
  label_he   text NOT NULL,
  sort_order smallint NOT NULL
);

COMMENT ON TABLE buckets IS
  'The 10 costing buckets that standard hours are broken down into. Was a JS constant (SEED.buckets) in the prototype.';

-- ---------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------
CREATE TABLE employees (
  num          integer PRIMARY KEY,
  name         text    NOT NULL CHECK (btrim(name) <> ''),
  nick         text    NOT NULL CHECK (btrim(nick) <> ''),
  active       boolean NOT NULL DEFAULT true,
  contractor   text    NULL,              -- NULL = internal employee
  target_hours numeric(5,2) NULL CHECK (target_hours IS NULL OR target_hours > 0),

  -- WP §5.1
  effective_target numeric(5,2) NOT NULL GENERATED ALWAYS AS (
    COALESCE(target_hours, CASE WHEN contractor IS NULL THEN 8.5 ELSE 10.5 END)
  ) STORED,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX employees_nick_idx   ON employees (nick);
CREATE INDEX employees_active_idx ON employees (active) WHERE active;

COMMENT ON COLUMN employees.contractor IS
  'Subcontractor name (עו"ז, א.ב.הנדסה, סלים, ראיד, בישר). NULL = internal staff.';
COMMENT ON COLUMN employees.effective_target IS
  'WP §5.1 daily target. Generated: explicit override, else 10.5 subcontractor / 8.5 internal.';

CREATE TABLE projects (
  num        integer PRIMARY KEY,
  name       text    NOT NULL CHECK (btrim(name) <> ''),
  nick       text    NOT NULL CHECK (btrim(nick) <> ''),
  client     text    NOT NULL DEFAULT '—',
  overhead   boolean NOT NULL DEFAULT false,   -- true = תקורה, excluded from budget control
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The prototype resolves a typed project nickname through nick2proj, a plain
-- object keyed by nick — so a duplicate nick silently drops a project. Not
-- enforced UNIQUE yet because the customer has not confirmed nicks are unique;
-- this index makes collisions cheap to detect. See docs/OPEN-QUESTIONS.md.
CREATE INDEX projects_nick_idx     ON projects (nick);
CREATE INDEX projects_client_idx   ON projects (client);
CREATE INDEX projects_overhead_idx ON projects (overhead);

CREATE TABLE departments (
  name       text PRIMARY KEY CHECK (btrim(name) <> ''),
  num        integer NULL,
  bucket     text    NULL REFERENCES buckets (key) ON UPDATE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN departments.bucket IS
  'Maps a department to one of the 10 costing buckets. NULL = non-productive, excluded from standard comparison (WP §5.2). Was the SEED.dept2bucket JS constant.';

CREATE TABLE repairs (
  fix        integer PRIMARY KEY,
  client     text NOT NULL DEFAULT '',
  date       date NULL,
  model      text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Standard (costed) hours per box. Many boxes roll up to one parent project.
CREATE TABLE standard (
  box        integer PRIMARY KEY,
  name       text    NOT NULL DEFAULT '',
  parent     integer NULL,        -- FK added NOT VALID in 003; see header note
  total      integer NOT NULL DEFAULT 0 CHECK (total >= 0),

  pah        integer NOT NULL DEFAULT 0 CHECK (pah       >= 0),
  misgarot   integer NOT NULL DEFAULT 0 CHECK (misgarot  >= 0),
  hazraka    integer NOT NULL DEFAULT 0 CHECK (hazraka   >= 0),
  panelim    integer NOT NULL DEFAULT 0 CHECK (panelim   >= 0),
  hadbaka    integer NOT NULL DEFAULT 0 CHECK (hadbaka   >= 0),
  ritum      integer NOT NULL DEFAULT 0 CHECK (ritum     >= 0),
  dlatot     integer NOT NULL DEFAULT 0 CHECK (dlatot    >= 0),
  hashmal    integer NOT NULL DEFAULT 0 CHECK (hashmal   >= 0),
  psei       integer NOT NULL DEFAULT 0 CHECK (psei      >= 0),
  hashlamot  integer NOT NULL DEFAULT 0 CHECK (hashlamot >= 0),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX standard_parent_idx ON standard (parent);

COMMENT ON TABLE standard IS
  'Costed standard hours per box (ארגז). The prototype stored this keyed on "num" with a duplicate "box" field; normalized to a single key here.';

-- ---------------------------------------------------------------------------
-- Accounts (new — the prototype had no auth, just a 3-name dropdown)
-- ---------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('reporter', 'manager', 'admin');

CREATE TABLE users (
  id            bigserial PRIMARY KEY,
  username      text NOT NULL UNIQUE CHECK (btrim(username) <> ''),
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  role          user_role NOT NULL DEFAULT 'reporter',
  emp_num       integer NULL REFERENCES employees (num) ON DELETE SET NULL,
  active        boolean NOT NULL DEFAULT true,
  last_login_at timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_emp_num_idx ON users (emp_num);

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------
CREATE TABLE reports (
  id         bigserial PRIMARY KEY,
  date       date    NOT NULL,
  emp_num    integer NOT NULL REFERENCES employees (num) ON DELETE RESTRICT,
  proj_num   integer NULL     REFERENCES projects  (num) ON DELETE RESTRICT,
  fix        integer NULL     REFERENCES repairs   (fix) ON DELETE RESTRICT,
  dept       text    NULL     REFERENCES departments (name) ON UPDATE CASCADE ON DELETE RESTRICT,
  hours      numeric(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),

  created_by bigint NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- WP §4.5 specifies EITHER project OR repair, never both, and the prototype's
  -- finalizeDraft() permits both to be set. Relaxed to "at least one" so the
  -- schema does not reject rows the existing UI can already produce.
  -- See docs/OPEN-QUESTIONS.md #4 before tightening this to num_nonnulls(...) = 1.
  CONSTRAINT reports_project_or_repair CHECK (proj_num IS NOT NULL OR fix IS NOT NULL)
);

CREATE INDEX reports_date_idx          ON reports (date);
CREATE INDEX reports_emp_date_idx      ON reports (emp_num, date);
CREATE INDEX reports_proj_idx          ON reports (proj_num);
CREATE INDEX reports_dept_idx          ON reports (dept);
CREATE INDEX reports_date_emp_hours_ix ON reports (date, emp_num) INCLUDE (hours);

COMMENT ON CONSTRAINT reports_project_or_repair ON reports IS
  'A report row must reference a project or a repair ticket. WP §4.5 wants exactly one; relaxed pending customer confirmation.';

-- Attendance clock hours (imported from the "Lumen" clock).
CREATE TABLE attendance (
  date       date    NOT NULL,
  emp_num    integer NOT NULL REFERENCES employees (num) ON DELETE CASCADE,
  hours      numeric(5,2) NOT NULL CHECK (hours >= 0 AND hours <= 24),
  source     text    NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  updated_by bigint  NULL REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, emp_num)
);

-- Replaces the prototype's meta store blob {k:'submitted', v:{date:true}}.
CREATE TABLE submitted_days (
  date         date PRIMARY KEY,
  submitted_by bigint NULL REFERENCES users (id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  row_count    integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE submitted_days IS
  'Marks a day as submitted to the archive. NOTE: in the prototype "submit day" does not move any data — rows are already persisted on entry. It sets this marker and rolls the date forward. See docs/OPEN-QUESTIONS.md #3.';

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
CREATE TABLE activity_log (
  id      bigserial PRIMARY KEY,
  ts      timestamptz NOT NULL DEFAULT now(),
  user_id bigint NULL REFERENCES users (id) ON DELETE SET NULL,
  action  text NOT NULL,
  detail  text NOT NULL DEFAULT '',
  entity  text NULL,
  entity_key text NULL
);

CREATE INDEX activity_log_ts_idx   ON activity_log (ts DESC);
CREATE INDEX activity_log_user_idx ON activity_log (user_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employees','projects','departments','repairs','standard','users','reports']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t, t);
  END LOOP;
END $$;
