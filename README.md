# Izzy Yogev Technologies — Production Management & Control System

Server-backed, multi-user replacement for the single-file browser prototype
(`מערכת ניהול ובקרת ייצור - איזי יוגב.html`). Employees report hours per project ×
department × day; those reports are cross-checked against the Lumen attendance
clock and compared to the costed standard hours per box.

Specification: `Work Plan — Production Management & Control System.docx`, cited
throughout the code as **WP §n**.

## Stack

| Layer | Choice |
| --- | --- |
| Runtime | Node 22.14 (pinned in `.nvmrc`) |
| API | Express 5 + TypeScript (strict) |
| Database | Supabase (managed Postgres 16) |
| Front end | Existing Vanilla JS, to be compiled with TypeScript — see below |
| Deployment | Docker Compose (app + Nginx) |

## Quick start

```bash
nvm use                 # Node 22.14.0
npm install
cp .env.example .env    # then fill in DATABASE_URL and SESSION_SECRET

npm run schema:verify   # runs the whole schema on in-process Postgres — no DB needed
npm run smoke           # boots the app and checks the endpoints

npm run migrate         # apply migrations to DATABASE_URL
npm run seed:extract    # prototype HTML -> db/seed/seed.json
npm run seed:load       # load it into the database
npm run dev             # http://localhost:3000/api/health
```

`npm run schema:verify` and `npm run smoke` need no database and no credentials.
Both are green as of the last commit — run them before every push.

## Scripts

| Script | What it does |
| --- | --- |
| `dev` | API with reload |
| `build` / `start` | Compile to `dist/`, run compiled output |
| `typecheck` | `tsc --noEmit` |
| `smoke` | Boots the app in-process, asserts health/readiness/error shapes |
| `schema:verify` | Applies all migrations to PGlite, loads the seed, asserts the WP §5 business rules |
| `migrate` | Applies `db/migrations/*.sql` once each (`-- --status` to list) |
| `seed:extract` | Parses `const SEED` out of the prototype HTML into `db/seed/seed.json`, reporting every anomaly |
| `seed:load` | Loads that seed file (`-- --master-only` to skip reports) |

## Layout

```
db/migrations/     numbered SQL, applied in order, tracked in schema_migrations
db/post-seed/      DDL that must wait until after the data migration (see below)
db/seed/           seed.json, generated — do not hand-edit
scripts/           migrate, seed extract/load, schema verify, smoke
src/lib/           config, db pool, errors
src/routes/        API routes
nginx/             reverse proxy config (TLS commented until a domain exists)
docs/              OPEN-QUESTIONS.md — assumptions and what needs confirming
```

## Where the schema deliberately differs from the work plan

Every one of these is deliberate and commented at the point of definition. The
WP itself (§13.1) says the prototype is the definitive specification, so where the
document and the prototype disagree, the prototype wins.

- **No denormalized snapshot columns on `reports`.** WP §4.5 lists them and then
  says the server should re-resolve from master data. Doing both guarantees drift.
  `v_reports_full` resolves employee, project, department and repair on read.
- **Daily target (§5.1) is a generated column.** One definition, in the database.
- **All hours are `numeric(5,2)`.** The prototype compares hours with a `0.001`
  epsilon because JS numbers are binary floats; exact decimals remove the need.
- **`standard.parent` has no FK in the normal migrations.** 66 of 159 box rows
  point at parent projects that do not exist. See `db/post-seed/` and
  OPEN-QUESTIONS #1.
- **`reports` requires a project *or* a repair, not exactly one.** WP §4.5 wants
  exactly one; the prototype can produce both. OPEN-QUESTIONS #4.
- **Budget-vs-actual excludes projects with a standard but no hours.** Otherwise
  variance is `0 − std_total` and an untouched project reads as a huge saving.

## Front end

Staying Vanilla JS for now, compiled with TypeScript rather than rewritten in a
framework. Reasoning: every screen renders synchronously off one global `M`
object, so replacing `loadAll()` with API calls leaves four of the seven screens
essentially unchanged. The reporting grid's ergonomics (autocomplete, Enter/Tab
traversal, draft row, save-on-blur) are the proven daily-use surface and the
highest-regression thing to rewrite. WP §13.2 lists this as an open question and
§3.2 leaves the choice to the developer.

Two things must change while wiring it up:

- **Escape output.** Every render builds `innerHTML` from unescaped data. Harmless
  in a single-user local page, stored XSS the moment it is multi-user.
- **Archive paging.** `loadAll()` pulls every report into memory and filters
  client-side. WP §6.2 requires server-side paging performant at tens of
  thousands of rows — roughly one year of real data at 54 employees.

## Deployment

`docker compose up -d --build` runs the app behind Nginx on port 80. The database
is not in the Compose stack — it is on Supabase, reached via `DATABASE_URL`.

**No TLS yet.** Let's Encrypt cannot issue a certificate for a bare IP address,
and no domain has been provided. Nginx and Compose are TLS-ready with the
relevant blocks commented; enabling it is: point a hostname at the server, issue
the certificate, uncomment, and set `COOKIE_SECURE=true`. Do not set that flag
before TLS works — a `Secure` cookie is silently dropped over plain HTTP, so
login appears to succeed and then immediately forgets you.

### Server hardening (not yet done)

The work plan (§10.1) ships a shared root password for `62.72.35.209` in the
document itself. Nothing in this repo has touched that server. Before it is used:
rotate that password first, then create a non-root deploy user, install SSH keys,
disable password login, and enable a firewall (22/80/443) and fail2ban.

### Backups

WP §10.4 calls backups a launch blocker, not a nice-to-have. Supabase provides
managed backups — confirm the plan's retention — and an independent off-site
`pg_dump` should run on a schedule regardless. A restore drill is part of Phase 5
and is not optional: an untested backup is not a backup.

## Status

Phase 0 (Foundations) — schema, migrations, seed pipeline, API skeleton, Compose
and Nginx are done and verified locally. Outstanding: Supabase credentials, and a
domain if HTTPS is wanted before launch.
