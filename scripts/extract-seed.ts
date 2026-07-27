/**
 * Pulls the master data out of the prototype HTML and normalizes it into
 * db/seed/seed.json, ready for load-seed.ts.
 *
 * The prototype embeds everything as one 66 KB `const SEED = {...}` literal on
 * a single line. Rather than hand-copy it (and inherit its quirks silently),
 * this script extracts it, reshapes it to match the SQL schema, and reports
 * every anomaly it finds so nothing gets migrated blind.
 *
 *   npm run seed:extract
 *   npm run seed:extract -- "C:\path\to\other-mockup.html"
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_HTML = path.resolve(
  HERE,
  '..',
  '..',
  'מערכת ניהול ובקרת ייצור - איזי יוגב.html'
);
const OUT = path.join(HERE, '..', 'db', 'seed', 'seed.json');

/* ------------------------------------------------------------------ shapes */

interface RawEmployee {
  num: number;
  name: string;
  nick: string;
  active: boolean;
  contractor: string | null;
  targetHours?: number | null;
}
interface RawProject {
  num: number;
  name: string;
  nick: string;
  client: string;
  overhead: boolean;
}
interface RawDepartment {
  name: string;
  num: number | null;
}
interface RawStandard {
  box?: number;
  num?: number;
  name: string;
  parent: number | null;
  total: number;
  [bucket: string]: number | string | null | undefined;
}
interface RawRepair {
  fix: number;
  client: string;
  date: string;
  model: string | null;
}
interface RawReport {
  date: string;
  empNum: number;
  projNum?: number | null;
  fix?: number | null;
  dept: string;
  hours: number;
}
interface RawSeed {
  employees: RawEmployee[];
  projects: RawProject[];
  departments: RawDepartment[];
  dept2bucket: Record<string, string | null>;
  buckets: Record<string, string>;
  standard: Record<string, RawStandard>;
  repairs: Record<string, RawRepair>;
  seedReport: RawReport[];
}

const BUCKET_KEYS = [
  'pah',
  'misgarot',
  'hazraka',
  'panelim',
  'hadbaka',
  'ritum',
  'dlatot',
  'hashmal',
  'psei',
  'hashlamot',
] as const;

/* ----------------------------------------------------------------- extract */

function extractSeedLiteral(html: string): RawSeed {
  const marker = html.indexOf('const SEED');
  if (marker < 0) throw new Error('Could not find `const SEED` in the HTML.');

  const open = html.indexOf('{', marker);
  if (open < 0) throw new Error('Found `const SEED` but no opening brace after it.');

  // Walk the braces so we stop at SEED's own closing brace rather than guessing
  // at the end of the line. String-aware so braces inside Hebrew names or
  // escaped quotes cannot throw off the depth count.
  let depth = 0;
  let inString = false;
  let escaped = false;
  let close = -1;

  for (let i = open; i < html.length; i++) {
    const ch = html[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close < 0) throw new Error('Unbalanced braces in the SEED literal.');

  return JSON.parse(html.slice(open, close + 1)) as RawSeed;
}

/* --------------------------------------------------------------- normalize */

async function main() {
  const htmlPath = process.argv[2] ?? DEFAULT_HTML;
  const html = await readFile(htmlPath, 'utf8');
  const seed = extractSeedLiteral(html);

  const notes: string[] = [];

  // -- departments: fold the dept2bucket JS constant into the rows -----------
  const deptNames = new Set(seed.departments.map((d) => d.name));
  const mapped = Object.entries(seed.dept2bucket);

  const orphanMappings = mapped
    .map(([name]) => name)
    .filter((name) => !deptNames.has(name));
  if (orphanMappings.length) {
    notes.push(
      `dept2bucket has ${orphanMappings.length} key(s) that are not departments and will be dropped: ` +
        orphanMappings.map((n) => JSON.stringify(n)).join(', ')
    );
    // "חשמל  סולארי" carries a double space. If the real Excel spells it with a
    // single space, its hours resolve to a NULL bucket and vanish from the
    // dashboard chart with no error. Flag it loudly.
    for (const n of orphanMappings) {
      if (/\s{2,}/.test(n)) {
        notes.push(
          `  ^ ${JSON.stringify(n)} contains a DOUBLE SPACE — likely a typo in the source data.`
        );
      }
    }
  }

  const unmapped = [...deptNames].filter((n) => !(n in seed.dept2bucket));
  if (unmapped.length) {
    notes.push(`departments with no bucket mapping at all: ${unmapped.join(', ')}`);
  }

  const departments = seed.departments.map((d) => ({
    name: d.name,
    num: d.num ?? null,
    bucket: seed.dept2bucket[d.name] ?? null,
  }));

  const nonProductive = departments.filter((d) => d.bucket === null).map((d) => d.name);
  if (nonProductive.length) {
    notes.push(
      `${nonProductive.length} department(s) map to no bucket (excluded from standard comparison, per WP §5.2): ${nonProductive.join(', ')}`
    );
  }

  // -- employees ------------------------------------------------------------
  const employees = seed.employees.map((e) => ({
    num: e.num,
    name: e.name.trim(),
    nick: e.nick.trim(),
    active: e.active !== false,
    contractor: e.contractor ?? null,
    target_hours: e.targetHours ?? null,
  }));

  // -- projects -------------------------------------------------------------
  const projects = seed.projects.map((p) => ({
    num: p.num,
    name: p.name.trim(),
    nick: p.nick.trim(),
    client: (p.client ?? '').trim() || '—',
    overhead: p.overhead === true,
  }));

  const nickCounts = new Map<string, number>();
  for (const p of projects) nickCounts.set(p.nick, (nickCounts.get(p.nick) ?? 0) + 1);
  const dupNicks = [...nickCounts].filter(([, c]) => c > 1);
  if (dupNicks.length) {
    notes.push(
      `duplicate project nicknames (the prototype's nick2proj lookup would silently drop one): ` +
        dupNicks.map(([n, c]) => `${n} ×${c}`).join(', ')
    );
  }

  // -- standard: object keyed by box -> array; drop the duplicated num/box ---
  const standard = Object.entries(seed.standard).map(([key, s]) => {
    const box = s.box ?? s.num ?? Number(key);
    const row: Record<string, unknown> = {
      box,
      name: (s.name ?? '').trim(),
      parent: s.parent ?? null,
      total: Number(s.total ?? 0),
    };
    for (const b of BUCKET_KEYS) row[b] = Number(s[b] ?? 0);
    return row;
  });

  const projNums = new Set(projects.map((p) => p.num));
  const orphanParents = [
    ...new Set(
      standard
        .map((s) => s.parent as number | null)
        .filter((p): p is number => p !== null && !projNums.has(p))
    ),
  ].sort((a, b) => a - b);
  if (orphanParents.length) {
    const distinct = new Set(standard.map((s) => s.parent).filter((p) => p !== null)).size;
    notes.push(
      `${orphanParents.length} of ${distinct} distinct standard.parent values reference a project that does not exist: ` +
        `${orphanParents.slice(0, 8).join(', ')}${orphanParents.length > 8 ? ', …' : ''}`
    );
    notes.push(
      `  ^ this is why db/post-seed/001_standard_parent_fk.sql is not a normal migration.`
    );
  }

  const totalMismatch = standard.filter((s) => {
    const sum = BUCKET_KEYS.reduce((acc, b) => acc + Number(s[b] ?? 0), 0);
    return sum !== Number(s.total);
  });
  if (totalMismatch.length) {
    notes.push(
      `${totalMismatch.length} standard row(s) where total <> sum of the 10 buckets ` +
        `(e.g. box ${totalMismatch[0]!.box}). Not corrected — the sheet's total is authoritative.`
    );
  }

  // -- repairs --------------------------------------------------------------
  const repairs = Object.values(seed.repairs).map((r) => ({
    fix: r.fix,
    client: (r.client ?? '').trim(),
    date: r.date || null,
    model: (r.model ?? '').trim() || null,
  }));

  // -- reports: drop the denormalized snapshots, keep the keys ---------------
  const empNums = new Set(employees.map((e) => e.num));
  const fixNums = new Set(repairs.map((r) => r.fix));
  const skipped: string[] = [];

  const reports = seed.seedReport.flatMap((r, i) => {
    const problems: string[] = [];
    if (!empNums.has(r.empNum)) problems.push(`unknown empNum ${r.empNum}`);
    if (r.projNum != null && !projNums.has(r.projNum)) problems.push(`unknown projNum ${r.projNum}`);
    if (r.fix != null && r.fix !== 0 && !fixNums.has(r.fix)) problems.push(`unknown fix ${r.fix}`);
    if (r.dept && !deptNames.has(r.dept)) problems.push(`unknown dept ${r.dept}`);
    if (r.projNum == null && (r.fix == null || r.fix === 0))
      problems.push('neither project nor repair');
    if (!(Number(r.hours) > 0)) problems.push(`non-positive hours ${r.hours}`);

    if (problems.length) {
      skipped.push(`  row ${i + 1} (${r.date}, emp ${r.empNum}): ${problems.join('; ')}`);
      return [];
    }
    return [
      {
        date: r.date,
        emp_num: r.empNum,
        proj_num: r.projNum ?? null,
        fix: r.fix && r.fix !== 0 ? r.fix : null,
        dept: r.dept || null,
        hours: Number(r.hours),
      },
    ];
  });

  if (skipped.length) {
    notes.push(`${skipped.length} report row(s) rejected by the schema's constraints:`);
    notes.push(...skipped);
  }

  // -- write ----------------------------------------------------------------
  const out = {
    _meta: {
      source: path.basename(htmlPath),
      extracted_from: 'const SEED literal in the prototype HTML',
      counts: {
        employees: employees.length,
        projects: projects.length,
        projects_productive: projects.filter((p) => !p.overhead).length,
        projects_overhead: projects.filter((p) => p.overhead).length,
        departments: departments.length,
        standard: standard.length,
        repairs: repairs.length,
        reports: reports.length,
      },
      notes,
    },
    employees,
    projects,
    departments,
    standard,
    repairs,
    reports,
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 2), 'utf8');

  console.log(`Extracted from: ${path.basename(htmlPath)}`);
  console.log(`Wrote:          ${path.relative(process.cwd(), OUT)}\n`);
  console.table(out._meta.counts);
  if (notes.length) {
    console.log('\nAnomalies found in the source data:');
    for (const n of notes) console.log(n.startsWith(' ') ? n : `  • ${n}`);
  } else {
    console.log('\nNo anomalies found.');
  }
}

main().catch((err) => {
  console.error('extract-seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
