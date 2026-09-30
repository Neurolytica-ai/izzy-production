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

/**
 * reports.hours is numeric(5,2). Excel floats carry noise (8.78 is stored as
 * 8.780000000000001), and an unrounded value would never match the stored row
 * on the next upload — so the duplicate check would re-import it every time.
 */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Whitespace-insensitive name key — department names carry double spaces (OPEN-QUESTIONS #2). */
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

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
      // ProjectNum is the office's list of CURRENT projects: one the history
      // import archived comes back into the grid's suggestions (migration 006).
      archived: false,
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
    // Listed on the sheet = open: re-opens a ticket an earlier import closed (007).
    items.push({ fix, client: text(r[L.client]), closed: false, __row: rowNo });
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

    const hours = round2(Number(r[cm.hours!] ?? 0));
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      errors.push({ row: rowNo, reason: tf('import.missingHours', {}) });
      continue;
    }

    items.push({ date, emp_num, proj_num, fix, dept, hours });
  }
  return { items, errors };
}

/* ------------------------------------ report history (hours workbook) */

/**
 * The hours workbook's report history (Arad 2026-09-29: reports come from
 * "דיווחי שעות", and the office re-uploads the same file with updates). Fixed
 * columns, like the master lists — the sheet's header row:
 *
 *   A תאריך דיווח · B עובד · C שם הפרויקט + מס' · D דיווח שעות · E מחלקה ·
 *   F מס' תיקון · G מס פרוייקט · H שם הפרוייקט · I מס עובד · J מס' מחלקה
 *
 * Rows resolve by NUMBER (I, G, F), not by typed name: the history spans 2012
 * onward and names drift. The sheet is not padded like the master sheets, but
 * it is ~200k rows, hence its own row cap.
 */
export const WORKBOOK_HISTORY = {
  sheets: ['דיווחי שעות'],
  date: col('A'),
  emp: col('B'),
  projText: col('C'),
  hours: col('D'),
  dept: col('E'),
  fix: col('F'),
  projNum: col('G'),
  projName: col('H'),
  empNum: col('I'),
  deptNum: col('J'),
} as const;

export const HISTORY_ROW_CAP = 1_000_000;

type Item = Record<string, unknown>;

/** Master data a history row may reference: the database plus this upload's own lists. */
export interface HistoryLookups {
  empNums: Set<number>;
  empByName: Map<string, number>;
  projNums: Set<number>;
  fixes: Set<number>;
  deptByName: Map<string, string>;
  deptByNum: Map<number, string>;
}

export async function historyLookups(file: Record<MasterType, Item[]>): Promise<HistoryLookups> {
  const [emps, projs, depts, fixes] = await Promise.all([
    query<{ num: number; nick: string; name: string }>('SELECT num, nick, name FROM employees'),
    query<{ num: number }>('SELECT num FROM projects'),
    query<{ name: string; num: number | null }>('SELECT name, num FROM departments'),
    query<{ fix: number }>('SELECT fix FROM repairs'),
  ]);
  const L: HistoryLookups = {
    empNums: new Set(),
    empByName: new Map(),
    projNums: new Set(projs.map((p) => p.num)),
    fixes: new Set(fixes.map((f) => f.fix)),
    deptByName: new Map(),
    deptByNum: new Map(),
  };
  const addEmp = (num: number, name: string, nick: string) => {
    L.empNums.add(num);
    if (nick && !L.empByName.has(nick)) L.empByName.set(nick, num);
    if (name && !L.empByName.has(name)) L.empByName.set(name, num);
  };
  for (const e of emps) addEmp(e.num, e.name, e.nick);
  for (const e of file.employees) addEmp(e.num as number, e.name as string, e.nick as string);
  for (const p of file.projects) L.projNums.add(p.num as number);
  for (const r of file.repairs) L.fixes.add(r.fix as number);
  // The file's departments are applied first in the same commit, so they count.
  for (const d of [...depts, ...(file.departments as { name: string; num: number | null }[])]) {
    L.deptByName.set(squash(d.name), d.name);
    if (d.num != null && !L.deptByNum.has(d.num)) L.deptByNum.set(d.num, d.name);
  }
  return L;
}

export interface HistoryResult extends ParseResult {
  /**
   * Records the history references but master data lacks — created by the
   * commit so the report rows' FKs hold: former employees (inactive), old
   * projects (archived), and repair tickets (no customer on the sheet).
   */
  creates: { employees: Item[]; projects: Item[]; repairs: Item[] };
}

export function parseHistory(grid: Grid, known: HistoryLookups): HistoryResult {
  const L = WORKBOOK_HISTORY;
  const creates: HistoryResult['creates'] = { employees: [], projects: [], repairs: [] };
  const h = grid.findIndex((r, i) => i < 8 && text((r ?? [])[L.date]).includes('תאריך'));
  if (h < 0 || !text((grid[h] ?? [])[L.hours]).includes('שעות')) {
    return { items: [], errors: [], headerMissing: true, creates };
  }

  // Keyed so a record is created once however many rows reference it; the
  // sheet is chronological, so the last row seen carries the latest name.
  const newEmps = new Map<number, Item>();
  const newProjs = new Map<number, Item>();
  const newFixes = new Map<number, Item>();
  const items: Item[] = [];
  const errors: RowError[] = [];

  for (let i = h + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const empText = text(r[L.emp]);
    const rawEmpNum = r[L.empNum];
    if (!empText && text(rawEmpNum) === '') continue; // blank row
    const rowNo = i + 1;

    const date = cellDate(r[L.date]);
    if (!date) {
      errors.push({ row: rowNo, reason: tf('import.missingDate', {}) });
      continue;
    }
    const hours = round2(Number(r[L.hours] ?? 0));
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      errors.push({ row: rowNo, reason: tf('import.missingHours', {}) });
      continue;
    }

    // Employee: by number; a row without one falls back to the name.
    let emp_num = asInt(rawEmpNum);
    let newEmp: Item | null = null;
    if (emp_num == null) {
      emp_num = known.empByName.get(empText) ?? null;
      if (emp_num == null) {
        errors.push({ row: rowNo, reason: tf('import.empNotFound', { name: empText || '—' }) });
        continue;
      }
    } else if (!known.empNums.has(emp_num)) {
      const name = empText || String(emp_num);
      newEmp = { num: emp_num, name, nick: name.split(' ')[0]!, active: false, contractor: contractorOf(name) };
    }

    // A repair row: the sheet books it to the "repairs by ticket" project (900)
    // AND the ticket; the app stores ticket-only rows (exactly one of the two).
    const rawFix = r[L.fix];
    let fix: number | null = null;
    let proj_num: number | null = null;
    let newProj: Item | null = null;
    let newFix: Item | null = null;
    if (text(rawFix) !== '') {
      fix = asInt(rawFix);
      if (fix == null) {
        errors.push({ row: rowNo, reason: tf('import.fixNotFound', { n: text(rawFix) }) });
        continue;
      }
      if (!known.fixes.has(fix)) newFix = { fix, client: '' };
    } else {
      proj_num = asInt(r[L.projNum]);
      if (proj_num == null) {
        errors.push({ row: rowNo, reason: tf('import.projNotFound', { name: text(r[L.projText]) || '—' }) });
        continue;
      }
      if (!known.projNums.has(proj_num)) {
        const name = text(r[L.projName]) || text(r[L.projText]) || String(proj_num);
        const overhead = proj_num < 1000;
        newProj = {
          num: proj_num,
          name,
          nick: String(proj_num),
          client: overhead ? 'תקורה' : clientOf(name) || '—',
          overhead,
          archived: true,
        };
      }
    }

    // Department: the name (E); old rows leave it blank and carry only the number (J).
    const deptText = text(r[L.dept]);
    let dept: string | null = null;
    if (deptText) {
      dept = known.deptByName.get(squash(deptText)) ?? null;
      if (!dept) {
        errors.push({ row: rowNo, reason: tf('import.deptNotFound', { name: deptText }) });
        continue;
      }
    } else {
      const dn = asInt(r[L.deptNum]);
      dept = dn != null ? known.deptByNum.get(dn) ?? null : null;
    }

    if (newEmp) {
      newEmps.set(emp_num, newEmp);
      // A later row of the same person may lack the number (column I blank).
      if (!known.empByName.has(newEmp.name as string)) known.empByName.set(newEmp.name as string, emp_num);
    }
    if (newProj) newProjs.set(proj_num!, newProj);
    if (newFix) newFixes.set(fix!, newFix);
    items.push({ date, emp_num, proj_num, fix, dept, hours, __row: rowNo });
  }

  creates.employees = [...newEmps.values()];
  creates.projects = [...newProjs.values()];
  creates.repairs = [...newFixes.values()];
  return { items, errors, creates };
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
