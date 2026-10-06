/**
 * Where the import finds its data in the office's hours workbook
 * (דיווח שעות.xlsm) — shared by the server and the browser, so both read the
 * same sheets the same way. Pure constants and types: no Node or DOM APIs.
 *
 * Client feedback round 4 #1 (upload in ≤60s): the workbook is 34 MB, and the
 * browser now extracts just these sheets' first EXTRACT_COLS columns and sends
 * them compressed (~2 MB) instead of uploading the whole file. The server keeps
 * accepting the raw file too, and extracts it with the very same code.
 */

/** Sheet-name aliases per part. Matched case- and whitespace-insensitively (the office has spelled `repairs` as `repaires`). */
export const WORKBOOK_PARTS = {
  departments: ['Departments'],
  employees: ['Employees'],
  projects: ['ProjectNum'],
  repairs: ['repairs', 'repaires'],
  history: ['דיווחי שעות'],
} as const;

export type WorkbookPart = keyof typeof WORKBOOK_PARTS;
export const WORKBOOK_PART_KEYS = Object.keys(WORKBOOK_PARTS) as WorkbookPart[];

/**
 * Columns kept per row: A–J. Every column the parsers read lies in this range
 * (history A–J, Employees A–D, ProjectNum G–I, repairs/Departments A–B) —
 * lib/importers asserts it at load time, so a layout change cannot silently
 * read a column the browser dropped.
 */
export const EXTRACT_COLS = 10;

/**
 * Rows parsed per master sheet. The `repairs` and `ProjectNum` sheets are padded
 * with ~1M formatted-but-empty rows (~100 MB of XML each); the real lists are a
 * few hundred rows.
 */
export const MASTER_ROW_CAP = 50_000;

/** Rows parsed of the report history (~200k today). */
export const HISTORY_ROW_CAP = 1_000_000;

/** One cell as SheetJS returns it with `raw: true` (dates are Excel serial numbers). */
export type Cell = string | number | boolean | null;
export type ExtractGrid = Cell[][];

/** What the browser sends: each part's grid, or null when the workbook has no such sheet. */
export interface WorkbookExtract {
  v: 1;
  parts: Record<WorkbookPart, ExtractGrid | null>;
}

/** The workbook sheet matching any alias, ignoring case and surrounding whitespace. */
export function findSheet(sheetNames: readonly string[], aliases: readonly string[]): string | undefined {
  const want = aliases.map((n) => n.trim().toLowerCase());
  return sheetNames.find((s) => want.includes(s.trim().toLowerCase()));
}
