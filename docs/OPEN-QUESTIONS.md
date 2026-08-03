# Open questions & decisions

Things that need an answer from Arad or the customer, and the decisions taken in
the meantime so work is not blocked. Each item says what was assumed, so if the
answer differs we know exactly what to change.

Reference: `Work Plan — Production Management & Control System.docx` (cited as WP)
and the prototype `מערכת ניהול ובקרת ייצור - איזי יוגב.html`.

---

## Blocking — needed before the data migration is final

### 1. 43 orphan parent projects in the standard-hours data
66 of the 159 box rows roll up to a `parent` project that does not exist in the
projects table — 43 distinct missing project numbers (24321, 24359, 24360, …).
The prototype hides this: the dashboard only lists projects present in *both*
tables, so those boxes and their standard hours are invisible today.

**Question:** are these missing projects that should be created, or dead box rows
to delete?

**Assumed for now:** neither. The FK WP §4.10 asks for is kept out of the normal
migrations (`db/post-seed/001_standard_parent_fk.sql`) and applied afterwards as
`NOT VALID`, so new bad references are rejected while the existing mess is
tolerated and reported by `v_orphan_standard_parents`.

### 2. `חשמל  סולארי` has a double space
`SEED.dept2bucket` maps `"חשמל  סולארי"` (two spaces) to the `hashmal` bucket, and
it is not a department. If the real Excel spells it with one space, its hours
resolve to a NULL bucket and vanish from the dashboard chart with no error.
`חנוכה` is mapped too and likewise is not a department.

**Question:** typo, or a genuinely separate department?

**Assumed for now:** dropped at extraction (both are reported by
`npm run seed:extract`). 13 of 14 departments map to a bucket; only `לא יצרני` is
deliberately unmapped.

### 3. What does "submit day to archive" actually mean?
WP §7.3 specifies `POST /api/reports/submit-day` to "commit a day's draft rows to
the archive". In the prototype there is no draft state — rows are persisted the
moment they are entered, and `submitDay` (`:778`) only sets a flag and rolls the
date forward one day.

**Question:** should submitting lock the day against further edits (a real
workflow step), or stay a marker?

**Assumed for now:** a marker. `submitted_days` records date, who and how many
rows. Nothing is locked. Making it a lock later is additive; unwinding a lock
nobody wanted is not.

### 4. Can a report row reference both a project and a repair?
WP §4.5 says EITHER/OR with a CHECK constraint. The prototype's `finalizeDraft`
(`:503`) accepts both being set.

**ANSWERED by client feedback 2026-08-03 (Shai, items #3/#5): exactly one.**
Selecting a project must disable the ticket field and vice versa; a ticket-only
row is valid. Enforced 2026-08-03 in the API (`resolveOrThrow` rejects both with
`project_or_repair_exclusive`) and in the grid (each cell locks while the other
is filled). The DB CHECK stays "at least one" because rows written before this
rule may carry both; tighten to `num_nonnulls(proj_num, fix) = 1` only after
verifying `SELECT count(*) FROM reports WHERE proj_num IS NOT NULL AND fix IS
NOT NULL` is zero in production (and cleaning up if not).

### 5. The real Excel files
WP §9.1's column mappings do not match what the prototype's parsers actually do,
and the parsers are what work against the customer's real files:

- project `client` is **not** read from a `לקוח` column — it is derived from the
  project name by `clientOf()` (`:840`)
- `contractor` is **not** read from a `קבלן` column — it is regex-matched against
  a hardcoded list (`עו"ז`, `א.ב`, `סלים`, `ראיד`, `בישר`) in `contractorOf()` (`:838`)
- standard-hours headers are `פוליאוריתן` → `hazraka` and `הדבקות` (plural)
- employee nickname is looked up as `מוקלד` / `להקלדה` before `כינוי`
- the departments parser skips rows starting with `omer`

**Needed:** one real copy of each of the 7 import files. Phase 3 cannot be
finished honestly without them.

---

## Non-blocking

### 6. Are project nicknames unique?
The prototype resolves a typed nickname through `nick2proj` (`:255`), an object
keyed by nick — a duplicate silently drops one project. No duplicates exist in
the current seed data.

**Assumed for now:** indexed but not UNIQUE. Add the constraint once confirmed.

### 7. Reporters entering hours for other people
WP §13.2 asks this. Affects the reporting screen and the permission model.

**Assumed for now:** any authenticated user with the `reporter` role can enter
rows for anyone, matching the prototype. `users.emp_num` exists so restricting it
later is a WHERE clause, not a redesign.

### 8. Nine boxes where `total` ≠ sum of the 10 buckets
Found during extraction (e.g. box 24399).

**Assumed for now:** the sheet's `total` is authoritative and is stored as given;
the buckets are stored as given too. Not silently corrected.

### 9. Hardcoded "today"
The prototype pins `const TODAY = '2026-07-20'` (`:301`) and every date default
flows from it. The week filter also uses the latest date *present in the data*
rather than the actual current date, and computes the range with `toISOString()`,
which shifts by timezone.

**Assumed for now:** the server uses real dates. The week window will be an
explicit from/to computed server-side — the timezone bug is not being ported.

### 10. Activity log retention
WP §13.2 asks. No policy assumed; the log grows unbounded for now. Worth raising
before go-live, not before Phase 1.

---

## Decisions taken without needing an answer

| Decision | Why |
| --- | --- |
| Denormalized snapshot columns on `reports` dropped | WP §4.5 lists them then says the server should re-resolve from master. Storing both guarantees drift. `v_reports_full` resolves on read. |
| Daily target is a generated column | WP §5.1 in one place, so the API, dashboard and any future report cannot disagree. |
| `numeric(5,2)` for all hours, no float epsilons | The prototype compares with a `0.001` fudge because JS numbers are binary floats. Exact decimals remove the need. |
| Business rules live in SQL functions | `fn_coverage`, `fn_budget_vs_actual`, `fn_bucket_hours`, `fn_dashboard_kpis` — testable directly, and WP §12 wants these specific rules covered by tests. |
| Projects with a standard but zero hours are excluded from budget-vs-actual | Otherwise variance is `0 − std_total` and a project nobody has started reads as a large *saving*. |
| Front end stays Vanilla, compiled with TypeScript | Rewriting the reporting grid in React is the highest-regression work in the project and does not fit the deadline. See the note in README. |
| No TLS yet | No domain exists, and Let's Encrypt cannot issue for a bare IP. Nginx and Compose are TLS-ready and commented. |
