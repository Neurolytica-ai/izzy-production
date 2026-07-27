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
```

`npm run schema:verify` and `npm run smoke` need no database and no credentials.

## Running it in development

Two processes, two terminals:

```bash
npm run dev        # API on :3000
npm run web:dev    # front end on :5173
```

Then open **http://localhost:5173** — not :3000. The API serves no HTML in
development; Vite serves the app and proxies `/api` through to :3000.

The proxy is deliberate rather than using CORS: it keeps the front end and the API
on one origin, so the session cookie is first-party and cookie behaviour in
development is identical to production behind Nginx. There is no CORS
configuration to get wrong and no dev-only cookie exception.

Create an account first if you have not:

```bash
npm run user:create -- --username admin --name "System Admin" --role admin
```

In production Nginx serves `public/` (built by `npm run web:build`) and proxies
`/api` to the app container, so everything is on one origin there too.

## Scripts

| Script | What it does |
| --- | --- |
| `dev` | API with reload |
| `build` / `start` | Compile to `dist/`, run compiled output |
| `typecheck` | `tsc --noEmit` |
| `smoke` | Boots the app in-process against a deliberately unreachable database; asserts it degrades rather than crashes |
| `schema:verify` | Applies all migrations to PGlite, loads the seed, asserts the WP §5 business rules. Destructive, but on a throwaway in-memory database |
| `verify:live` | **Read-only** checks against `DATABASE_URL`. Safe against production; the post-deploy check |
| `verify:api` | End-to-end auth/roles/CRUD/resolution tests. **Writes** — namespaced and self-cleaning, refuses `NODE_ENV=production` |
| `migrate` | Applies `db/migrations/*.sql` once each (`--status` to list) |
| `seed:extract` | Parses `const SEED` out of the prototype HTML into `db/seed/seed.json`, reporting every anomaly |
| `seed:load` | Loads that seed file (`--master-only` to skip reports) |
| `user:create` | Creates an account and prints a generated password once |

Run `verify:api`, `schema:verify` and `smoke` before every push. All four suites
are green as of the last commit (81 / 42 / 41 / 17).

Note: PowerShell swallows npm's `--` separator, so pass script flags directly:
`npx tsx scripts/migrate.ts --status` rather than `npm run migrate -- --status`.

## Language

All user-facing text lives in `src/lib/messages.ts`, in **both English and
Hebrew**, keyed by a stable code. `UI_LANG` in `.env` selects one.

- Development runs `en`.
- **Production must be set to `he` before go-live** — the end users are
  Hebrew-speaking shop-floor staff, and the prototype they are replacing is
  entirely Hebrew/RTL.

Two rules keep the switch a one-liner rather than a rewrite:

1. Every API response carries a machine-readable `error` code as well as the
   translated `message`. Clients and tests branch on the code, never the text.
2. Nothing user-facing is written as a literal anywhere else. If it is not in
   `messages.ts`, it does not reach a user.

`activity_log.action` and `.entity` store stable codes (`master.edit`,
`employee`), not display text — the prototype wrote Hebrew strings straight into
its log, which makes it unfilterable by action type and would leave a permanent
mix of languages after any translation. `GET /api/meta/vocabulary` returns the
labels for the active language so the client never hardcodes a translation table.

## First account

There is deliberately no seeded default account — a migration that ships
`admin/admin` is the usual way an internal tool ends up publicly writable.

```bash
npm run user:create -- --username admin --name "System Admin" --role admin
```

The password is generated and printed once. Roles are `reporter`, `manager`,
`admin` (WP §8).

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

**React 19 + TypeScript, built with Vite.** WP §13.2 lists framework choice as an
open question and §3.2 leaves it to the developer; the customer asked for React.

The trade-off, recorded because it affects the schedule: rewriting the reporting
grid's ergonomics (autocomplete, Enter/Tab cell traversal, the always-present
draft row, save-on-blur) is the most expensive and highest-regression part of the
project, and it is work that keeping the prototype's Vanilla JS would largely have
avoided. Phases 3–5 absorb that cost.

Two things React gives us that the prototype could not:

- **Output is escaped by default.** Every prototype render concatenated unescaped
  data into `innerHTML` — harmless in a single-user local page, stored XSS the
  moment the data is shared between users.
- **Server state is cached and invalidated deliberately** (React Query), which is
  how WP §6.1's "two users entering rows for the same date do not overwrite each
  other" gets satisfied: the server stays authoritative and writes invalidate
  rather than the client trusting its own copy.

Still outstanding regardless of framework:

- **Archive paging.** WP §6.2 requires server-side paging performant at tens of
  thousands of rows — roughly one year of real data at 54 employees. The
  prototype loaded every report into memory and filtered client-side.

### Layout

```
web/index.html          lang/dir are placeholders, set from /api/meta/config
web/src/api/client.ts   the only place that talks to the server
web/src/api/hooks.ts    React Query bindings; query keys and invalidation
web/src/App.tsx         shell, nav, auth gate
web/src/screens/        one file per tab
web/src/components/     Modal, RecordForm, Toast
web/src/styles.css      extracted verbatim from the prototype (RTL-tuned)
```

No router: seven fixed tabs need deep-linking and survive-a-refresh, which is
`useHashTab` in about fifteen lines. `react-router` was installed and then removed
— it currently ships a high-severity CSRF advisory that, while not exploitable in
a plain SPA, is not worth explaining to the client's security scanner. `npm audit`
reports zero vulnerabilities.

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

**Phase 0 — Foundations: done.** Schema, migrations, seed pipeline, API skeleton,
Compose and Nginx. Applied and seeded to Supabase (PostgreSQL 17.6).

**Phase 1 — Core & auth: API done.** Sessions with bcrypt + JWT-in-an-http-only
cookie, three roles enforced server-side on every endpoint, master-data CRUD for
all five resources, account management, and the WP §5.7 derived-field resolution
with autocomplete. 81 API tests green.

Phase 1's admin *screens* are deliberately deferred to the start of Phase 2, so
the TypeScript front-end build is set up once rather than twice.

Outstanding across the project:

- **A domain**, if HTTPS is wanted before launch (Let's Encrypt cannot issue for
  a bare IP). `COOKIE_SECURE` stays `false` until then.
- **`UI_LANG=he`** before go-live.
- **The 7 real Excel files** — Phase 3's hard blocker. WP §9.1's column mappings
  do not match what the prototype actually parses, and the prototype is
  authoritative.
- **Rotate the Supabase database password** before go-live.
- Nothing has touched `62.72.35.209`, and the shared root password in WP §10.1
  should be rotated regardless.
