/**
 * The seven import parsers (WP §6.5, §9.1) — ported from the prototype's
 * IMPORTERS table (:842-902), which is the authoritative spec (OPEN-QUESTIONS
 * #5: WP §9.1's column table does not match the files the company actually
 * uses; the prototype's patterns do).
 *
 * Each parser turns a worksheet grid into normalized rows plus row-level errors
 * (WP §9.2: "Malformed rows are reported with row numbers and skipped without
 * aborting the whole import"). Row numbers are 1-based as shown in Excel.
 *
 * Deliberate deviations from the prototype, each safer for a server:
 *   - A bulk-report row with an unresolvable employee/project/department is an
 *     ERROR, not silently stored with a null key (the prototype kept typing-
 *     mistake rows invisible to the dashboard).
 *   - A bulk-report row without a date is an ERROR; the prototype defaulted it
 *     to "today", which mis-dates historical rows.
 *   - A row with both a project and a repair is an ERROR (client feedback
 *     2026-08-03 settled OPEN-QUESTIONS #4: exactly one).
 *   - The departments sheet's `code` column is dropped — the schema has no such
 *     column; `bucket` is never touched by import (it is maintenance-screen
 *     data, and clobbering it would silently break the dashboard buckets).
 */
import { query } from './db.ts';
import { tf } from './messages.ts';
import { cellDate, clientOf, colMap, contractorOf, findHeader, type Grid } from './xlsx.ts';

export const IMPORT_TYPES = [
  'employees',
  'projects',
  'departments',
  'standard',
  'repairs',
  'attendance',
  'reports',
] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export interface RowError {
  /** 1-based row number as the user sees it in Excel. */
  row: number;
  reason: string;
}

export interface ParseResult {
  /** Normalized rows, column names matching the database. */
  items: Record<string, unknown>[];
  errors: RowError[];
  /** True when the header row could not be located at all. */
  headerMissing?: boolean;
}

const asInt = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

const text = (v: unknown): string => (v == null ? '' : String(v).trim());

/* ------------------------------------------------------------- employees */

function parseEmployees(grid: Grid): ParseResult {
  const h = findHeader(grid, ["מס' עובד", 'מס עובד', 'שם עובד']);
  if (h.idx < 0) return { items: [], errors: [], headerMissing: true };
  const cm = colMap(h.row, {
    num: ["מס' עובד", 'מס עובד', 'מספר עובד'],
    name: ['שם עובד'],
    nick: ['מוקלד', 'להקלדה', 'כינוי'],
    status: ['סטטוס'],
  });

  const items: Record<string, unknown>[] = [];
  const errors: RowError[] = [];
  for (let i = h.idx + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const rawNum = r[cm.num!];
    if (rawNum == null || rawNum === 0) continue; // blank / spacer row
    const name = text(r[cm.name!]);
    if (!name) continue;
    const num = asInt(rawNum);
    if (num == null) {
      errors.push({ row: i + 1, reason: tf('import.badNumber', { v: text(rawNum) }) });
      continue;
    }
    const nick = cm.nick != null && r[cm.nick] ? text(r[cm.nick]) : name.split(' ')[0]!;
    items.push({
      num,
      name,
      nick,
      active: text(r[cm.status!] ?? 'עובד') !== 'לא עובד',
      contractor: contractorOf(name),
    });
  }
  return { items, errors };
}

/* -------------------------------------------------------------- projects */

function parseProjects(grid: Grid): ParseResult {
  const h = findHeader(grid, ['פרויקט אב', 'פרוייקט אב', 'שם הפרויקט']);
  if (h.idx < 0) return { items: [], errors: [], headerMissing: true };
  const cm = colMap(h.row, {
    num: ['פרויקט אב', 'פרוייקט אב'],
    name: ['שם הפרויקט', 'שם הפרוייקט'],
    nick: ['להקלדה', 'כינוי'],
  });

  const items: Record<string, unknown>[] = [];
  const errors: RowError[] = [];
  for (let i = h.idx + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const rawNum = r[cm.num!];
    if (rawNum == null) continue;
    const name = text(r[cm.name!]);
    if (!name) continue;
    const num = asInt(rawNum);
    if (num == null) {
      errors.push({ row: i + 1, reason: tf('import.badNumber', { v: text(rawNum) }) });
      continue;
    }
    // Prototype rule (:852): overhead projects are the ones numbered below 1000.
    const overhead = num < 1000;
    const nick = cm.nick != null && r[cm.nick] ? text(r[cm.nick]) : name;
    items.push({
      num,
      name,
      nick,
      client: overhead ? 'תקורה' : clientOf(name),
      overhead,
    });
  }
  return { items, errors };
}

/* ----------------------------------------------------------- departments */

function parseDepartments(grid: Grid): ParseResult {
  const h = findHeader(grid, ["מס' מחלקה", 'מס מחלקה', 'שם מחלקה']);
  if (h.idx < 0) return { items: [], errors: [], headerMissing: true };
  const cm = colMap(h.row, {
    num: ["מס' מחלקה", 'מס מחלקה'],
    name: ['שם'],
  });

  const items: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (let i = h.idx + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const name = text(r[cm.name!]);
    if (!name) continue;
    if (name.startsWith('omer')) continue; // stray test row in the real file (prototype :859)
    if (seen.has(name)) continue;
    seen.add(name);
    const num = r[cm.num!] != null ? asInt(r[cm.num!]) : null;
    items.push({ name, num });
  }
  return { items, errors: [] };
}

/* -------------------------------------------------------------- standard */

/**
 * Bucket columns by header fragment (prototype :863). Note פוליאוריתן → hazraka
 * (the injection bucket — the real file does not say הזרקה), and both דלתות and
 * פרזול accumulate into dlatot.
 */
const BUCKET_COLS: Record<string, string> = {
  'עבודות פח': 'pah',
  'מסגרות': 'misgarot',
  'פוליאוריתן': 'hazraka',
  'פנלים': 'panelim',
  'הדבקות': 'hadbaka',
  'ריתום': 'ritum',
  'דלתות': 'dlatot',
  'פרזול': 'dlatot',
  'חשמל': 'hashmal',
  'פסי קשירה': 'psei',
  'השלמות': 'hashlamot',
};

const BUCKET_KEYS = ['pah', 'misgarot', 'hazraka', 'panelim', 'hadbaka', 'ritum', 'dlatot', 'hashmal', 'psei', 'hashlamot'];

function parseStandard(grid: Grid): ParseResult {
  const h = findHeader(grid, ["ארגז מס'", 'פרויקט אב', 'סה"כ שעות תקן']);
  if (h.idx < 0) return { items: [], errors: [], headerMissing: true };

  const idxBox = h.row.findIndex((c) => String(c).includes('ארגז'));
  const idxName = h.row.findIndex(
    (c) => String(c).includes('שם הפרויקט') || String(c).includes('שם הפרוייקט')
  );
  const idxParent = h.row.findIndex((c) => String(c).includes('פרויקט אב'));
  const idxTot = h.row.findIndex((c) => String(c).includes('סה"כ') || String(c).includes('סה”כ'));
  const colBuckets = h.row.map((c) => {
    for (const [label, bucket] of Object.entries(BUCKET_COLS)) {
      if (String(c).includes(label)) return bucket;
    }
    return null;
  });

  const items: Record<string, unknown>[] = [];
  const errors: RowError[] = [];
  for (let i = h.idx + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const rawBox = idxBox >= 0 ? r[idxBox] : r[idxParent];
    if (rawBox == null) continue;
    const box = asInt(rawBox);
    if (box == null) {
      errors.push({ row: i + 1, reason: tf('import.badNumber', { v: text(rawBox) }) });
      continue;
    }

    const rec: Record<string, unknown> = {
      box,
      name: idxName >= 0 && r[idxName] ? text(r[idxName]) : '',
      parent: idxParent >= 0 && r[idxParent] != null ? asInt(r[idxParent]) : null,
      /** Excel row number, for FK errors reported later in the diff step. */
      __row: i + 1,
    };
    for (const k of BUCKET_KEYS) rec[k] = 0;
    colBuckets.forEach((bucket, ci) => {
      const v = r[ci];
      if (bucket && typeof v === 'number') rec[bucket] = (rec[bucket] as number) + v;
    });
    rec.total =
      idxTot >= 0 && typeof r[idxTot] === 'number'
        ? r[idxTot]
        : BUCKET_KEYS.reduce((s, k) => s + (rec[k] as number), 0);
    items.push(rec);
  }
  return { items, errors };
}

/* --------------------------------------------------------------- repairs */

function parseRepairs(grid: Grid): ParseResult {
  const h = findHeader(grid, ["מס' תיקון", 'מס תיקון', 'תיקון']);
  if (h.idx < 0) return { items: [], errors: [], headerMissing: true };
  const cm = colMap(h.row, {
    fix: ["מס' תיקון", 'מס תיקון', 'תיקון'],
    client: ['לקוח'],
    date: ['תאריך'],
    model: ['דגם'],
  });

  const items: Record<string, unknown>[] = [];
  const errors: RowError[] = [];
  for (let i = h.idx + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const rawFix = r[cm.fix!];
    if (rawFix == null) continue;
    const fix = asInt(rawFix);
    if (fix == null) {
      errors.push({ row: i + 1, reason: tf('import.badNumber', { v: text(rawFix) }) });
      continue;
    }
    items.push({
      fix,
      client: cm.client != null ? text(r[cm.client]) : '',
      date: cm.date != null ? cellDate(r[cm.date]) : null,
      model: cm.model != null && r[cm.model] ? text(r[cm.model]) : null,
    });
  }
  return { items, errors };
}

/* ------------------------------------------------------------ attendance */

function parseAttendance(grid: Grid): ParseResult {
  const h = findHeader(grid, ['מס עובד', "מס' עובד", 'תאריך']);
  if (h.idx < 0) return { items: [], errors: [], headerMissing: true };
  const cm = colMap(h.row, {
    num: ['מס עובד', "מס' עובד"],
    date: ['תאריך'],
    tot: ['סה"כ', 'סהכ', 'שעות נוכחות', 'סך'],
  });

  const items: Record<string, unknown>[] = [];
  const errors: RowError[] = [];
  for (let i = h.idx + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const rawNum = r[cm.num!];
    if (rawNum == null) continue;
    const emp_num = asInt(rawNum);
    if (emp_num == null) {
      errors.push({ row: i + 1, reason: tf('import.badNumber', { v: text(rawNum) }) });
      continue;
    }
    const date = cellDate(r[cm.date!]);
    if (!date) {
      errors.push({ row: i + 1, reason: tf('import.missingDate', {}) });
      continue;
    }
    const rawTot = r[cm.tot!];
    if (rawTot == null) continue; // no clock figure — the prototype skips these too
    const hours = Number(rawTot);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
      errors.push({ row: i + 1, reason: tf('import.missingHours', {}) });
      continue;
    }
    items.push({ date, emp_num, hours, __row: i + 1 });
  }
  return { items, errors };
}

/* -------------------------------------------------- bulk historical reports */

/**
 * Bulk reports resolve against master data in memory, like the prototype did
 * against its loaded stores (:896-897) — one query per table, not per row.
 */
async function parseReports(grid: Grid): Promise<ParseResult> {
  const h = findHeader(grid, ['דיווח שעות', 'שם הפרויקט', 'עובד']);
  if (h.idx < 0) return { items: [], errors: [], headerMissing: true };
  const cm = colMap(h.row, {
    date: ['תאריך'],
    emp: ['עובד'],
    proj: ['הפרויקט + מס', 'הפרויקט +', 'שם הפרויקט'],
    hours: ['דיווח שעות', 'שעות'],
    dept: ['מחלקה'],
    fix: ['תיקון'],
  });

  const [emps, projs, depts, fixes] = await Promise.all([
    query<{ num: number; nick: string; name: string }>('SELECT num, nick, name FROM employees'),
    query<{ num: number; nick: string; name: string }>('SELECT num, nick, name FROM projects'),
    query<{ name: string }>('SELECT name FROM departments'),
    query<{ fix: number }>('SELECT fix FROM repairs'),
  ]);
  const empBy = new Map<string, number>();
  for (const e of emps) {
    empBy.set(e.nick, e.num);
    if (!empBy.has(e.name)) empBy.set(e.name, e.num);
  }
  const projBy = new Map<string, number>();
  for (const p of projs) {
    projBy.set(p.nick, p.num);
    projBy.set(String(p.num), p.num);
    if (!projBy.has(p.name)) projBy.set(p.name, p.num);
  }
  // Whitespace-insensitive department lookup — the master data contains a
  // double-spaced name (OPEN-QUESTIONS #2) and files will have it single-spaced.
  const squash = (s: string) => s.replace(/\s+/g, ' ');
  const deptBy = new Map<string, string>();
  for (const d of depts) deptBy.set(squash(d.name), d.name);
  const fixSet = new Set(fixes.map((f) => f.fix));

  const items: Record<string, unknown>[] = [];
  const errors: RowError[] = [];
  for (let i = h.idx + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const empText = text(r[cm.emp!]);
    if (!empText) continue; // blank row

    const rowNo = i + 1;
    const emp_num = empBy.get(empText);
    if (emp_num == null) {
      errors.push({ row: rowNo, reason: tf('import.empNotFound', { name: empText }) });
      continue;
    }

    const date = cellDate(r[cm.date!]);
    if (!date) {
      errors.push({ row: rowNo, reason: tf('import.missingDate', {}) });
      continue;
    }

    const projText = text(r[cm.proj!]);
    const fixText = cm.fix != null ? text(r[cm.fix]) : '';
    const proj_num = projText ? projBy.get(projText) ?? null : null;
    if (projText && proj_num == null) {
      errors.push({ row: rowNo, reason: tf('import.projNotFound', { name: projText }) });
      continue;
    }
    let fix: number | null = null;
    if (fixText) {
      fix = asInt(fixText);
      if (fix == null || !fixSet.has(fix)) {
        errors.push({ row: rowNo, reason: tf('import.fixNotFound', { n: fixText }) });
        continue;
      }
    }
    if (proj_num != null && fix != null) {
      errors.push({ row: rowNo, reason: tf('import.bothProjAndFix', {}) });
      continue;
    }
    if (proj_num == null && fix == null) {
      errors.push({ row: rowNo, reason: tf('import.projNotFound', { name: projText || '—' }) });
      continue;
    }

    const deptText = text(r[cm.dept!]);
    const dept = deptBy.get(squash(deptText));
    if (!dept) {
      errors.push({ row: rowNo, reason: tf('import.deptNotFound', { name: deptText || '—' }) });
      continue;
    }

    const hours = Number(r[cm.hours!] ?? 0);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      errors.push({ row: rowNo, reason: tf('import.missingHours', {}) });
      continue;
    }

    items.push({ date, emp_num, proj_num, fix, dept, hours });
  }
  return { items, errors };
}

/* ------------------------------------------------------------------ entry */

export async function parseImport(type: ImportType, grid: Grid): Promise<ParseResult> {
  switch (type) {
    case 'employees':
      return parseEmployees(grid);
    case 'projects':
      return parseProjects(grid);
    case 'departments':
      return parseDepartments(grid);
    case 'standard':
      return parseStandard(grid);
    case 'repairs':
      return parseRepairs(grid);
    case 'attendance':
      return parseAttendance(grid);
    case 'reports':
      return parseReports(grid);
  }
}
