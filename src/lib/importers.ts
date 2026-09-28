/**
 * The seven import parsers (WP §6.5, §9.1).
 *
 * Two families:
 *
 *   - MASTER LISTS (employees, projects, departments, repairs) are read from the
 *     customer's own hours workbook (דיווח שעות.xlsm) — a fixed sheet and fixed
 *     column letters per list, as specified by Arad 2026-09-28:
 *
 *        Employees    sheet "Employees"   A nick · B number · C name  (+ D status)
 *        Repairs      sheet "repairs"     A ticket # · B customer
 *        Departments  sheet "Departments" A name · B number
 *        Projects     sheet "ProjectNum"  G nick · H name · I parent project #
 *
 *     Replaces the prototype's header-guessing parsers for these four, which
 *     did not match the file the office actually maintains.
 *
 *   - SINGLE-SHEET FILES (standard, attendance, reports) keep the prototype's
 *     parsers (:842-902) — header auto-detected in the first rows of the first
 *     sheet (OPEN-QUESTIONS #5: WP §9.1's column table is wrong; the prototype's
 *     patterns are what the real files match).
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
 *   - Department `bucket` is never touched by import (it is maintenance-screen
 *     data, and clobbering it would silently break the dashboard buckets).
 */
import { query } from './db.ts';
import { tf } from './messages.ts';
import {
  cellDate,
  clientOf,
  col,
  colMap,
  contractorOf,
  findHeader,
  firstSheetGrid,
  namedSheetGrid,
  type Grid,
  type Workbook,
} from './xlsx.ts';

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
  /** Set (to the expected sheet name) when a master-list sheet is absent. */
  sheetMissing?: string;
}

const asInt = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

const text = (v: unknown): string => (v == null ? '' : String(v).trim());

/* ---------------------------------------------- master lists (hours workbook) */

/** Where each master list lives in the hours workbook. Sheet aliases match case-insensitively. */
export const WORKBOOK_LAYOUT = {
  employees: { sheets: ['Employees'], nick: col('A'), num: col('B'), name: col('C'), status: col('D') },
  repairs: { sheets: ['repairs', 'repaires'], fix: col('A'), client: col('B') },
  departments: { sheets: ['Departments'], name: col('A'), num: col('B') },
  projects: { sheets: ['ProjectNum'], nick: col('G'), name: col('H'), num: col('I') },
} as const;

export type MasterType = keyof typeof WORKBOOK_LAYOUT;
/** Apply order for the whole-workbook import (no FKs between them; lookups first reads best). */
export const MASTER_TYPES: MasterType[] = ['departments', 'employees', 'projects', 'repairs'];
export const isMasterType = (t: string): t is MasterType => t in WORKBOOK_LAYOUT;

/** Every sheet name the master-list import may read — lets the upload skip the rest. */
export const WORKBOOK_SHEETS = MASTER_TYPES.flatMap((t) => [...WORKBOOK_LAYOUT[t].sheets]);

/**
 * Index of the first data row: the first row whose key column holds a number.
 * Everything above it is a title/header block (ProjectNum has a title row over
 * its header; the others a single header row) and is skipped silently. Below
 * it, a non-numeric key is a row error. -1 = no data at all.
 */
function firstDataRow(grid: Grid, keyCol: number): number {
  return grid.findIndex((r) => asInt((r ?? [])[keyCol]) != null);
}

/** Rows from the first data row on, with Excel row numbers; rows blank in `cols` dropped. */
function* dataRows(grid: Grid, keyCol: number, cols: number[]) {
  const start = firstDataRow(grid, keyCol);
  if (start < 0) return;
  for (let i = start; i < grid.length; i++) {
    const r = grid[i] ?? [];
    if (cols.every((c) => text(r[c]) === '')) continue;
    yield { r, rowNo: i + 1 };
  }
}

function parseEmployees(grid: Grid): ParseResult {
  const L = WORKBOOK_LAYOUT.employees;
  // Arad specified columns A–C. Column D is the office's own עובד / לא עובד
  // status; it is honored only when its header says so, so that a former
  // employee is not re-created as active. Without it, `active` is left out of
  // the row entirely — a new employee gets the DB default (active), an existing
  // one keeps whatever the Master Data screen set.
  const start = firstDataRow(grid, L.num);
  const hasStatus = grid
    .slice(0, Math.max(start, 0))
    .some((r) => text((r ?? [])[L.status]).includes('סטטוס'));

  const items: Record<string, unknown>[] = [];
  const errors: RowError[] = [];
  for (const { r, rowNo } of dataRows(grid, L.num, [L.nick, L.num, L.name])) {
    const rawNum = r[L.num];
    const name = text(r[L.name]);
    if (text(rawNum) === '' && !name) continue; // stray nickname cell, not an employee row
    const num = asInt(rawNum);
    if (num == null) {
      errors.push({ row: rowNo, reason: tf('import.badNumber', { v: text(rawNum) || '—' }) });
      continue;
    }
    if (!name) {
      errors.push({ row: rowNo, reason: tf('import.missingName', {}) });
      continue;
    }
    const item: Record<string, unknown> = {
      num,
      name,
      nick: text(r[L.nick]) || name.split(' ')[0]!,
      contractor: contractorOf(name),
      __row: rowNo,
    };
    const status = text(r[L.status]);
    if (hasStatus && status) item.active = status !== 'לא עובד';
    items.push(item);
  }
  return { items, errors };
}

function parseProjects(grid: Grid): ParseResult {
  const L = WORKBOOK_LAYOUT.projects;
  const items: Record<string, unknown>[] = [];
  const errors: RowError[] = [];
  for (const { r, rowNo } of dataRows(grid, L.num, [L.nick, L.name, L.num])) {
    const num = asInt(r[L.num]);
    if (num == null) {
      errors.push({ row: rowNo, reason: tf('import.badNumber', { v: text(r[L.num]) || '—' }) });
      continue;
    }
    const name = text(r[L.name]);
    if (!name) {
      errors.push({ row: rowNo, reason: tf('import.missingName', {}) });
      continue;
    }
    // Prototype rule (:852): overhead projects are the ones numbered below 1000.
    const overhead = num < 1000;
    items.push({
      num,
      name,
      // In the office's file column G is `=I<row>` — i.e. the number. It is used
      // only when the project is NEW; an existing project's typed nickname
      // (e.g. "נטו") is never overwritten (see the projects spec in routes/imports).
      nick: text(r[L.nick]) || String(num),
      client: overhead ? 'תקורה' : clientOf(name),
      overhead,
      __row: rowNo,
    });
  }
  return { items, errors };
}

function parseDepartments(grid: Grid): ParseResult {
  const L = WORKBOOK_LAYOUT.departments;
  const items: Record<string, unknown>[] = [];
  const errors: RowError[] = [];
  for (const { r, rowNo } of dataRows(grid, L.num, [L.name, L.num])) {
    const name = text(r[L.name]);
    if (!name) {
      errors.push({ row: rowNo, reason: tf('import.missingName', {}) });
      continue;
    }
    if (name.startsWith('omer')) continue; // stray test rows in the real file (prototype :859)
    const rawNum = r[L.num];
    const num = asInt(rawNum);
    if (text(rawNum) !== '' && num == null) {
      errors.push({ row: rowNo, reason: tf('import.badNumber', { v: text(rawNum) }) });
      continue;
    }
    items.push({ name, num, __row: rowNo });
  }
  return { items, errors };
}

function parseRepairs(grid: Grid): ParseResult {
  const L = WORKBOOK_LAYOUT.repairs;
  const items: Record<string, unknown>[] = [];
  const errors: RowError[] = [];
  for (const { r, rowNo } of dataRows(grid, L.fix, [L.fix, L.client])) {
    const fix = asInt(r[L.fix]);
    if (fix == null) {
      errors.push({ row: rowNo, reason: tf('import.badNumber', { v: text(r[L.fix]) || '—' }) });
      continue;
    }
    // The workbook carries only number + customer; date and model stay as the
    // app has them (the repairs spec updates `client` only).
    items.push({ fix, client: text(r[L.client]), __row: rowNo });
  }
  return { items, errors };
}

const MASTER_PARSERS: Record<MasterType, (g: Grid) => ParseResult> = {
  employees: parseEmployees,
  projects: parseProjects,
  departments: parseDepartments,
  repairs: parseRepairs,
};

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

export async function parseImport(type: ImportType, wb: Workbook): Promise<ParseResult> {
  if (isMasterType(type)) {
    const L = WORKBOOK_LAYOUT[type];
    const grid = namedSheetGrid(wb, [...L.sheets]);
    if (!grid) return { items: [], errors: [], sheetMissing: L.sheets[0] };
    return MASTER_PARSERS[type](grid);
  }
  const grid = firstSheetGrid(wb);
  switch (type) {
    case 'standard':
      return parseStandard(grid);
    case 'attendance':
      return parseAttendance(grid);
    case 'reports':
      return parseReports(grid);
  }
}
