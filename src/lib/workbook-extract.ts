/**
 * Reads the hours workbook down to what the import uses — the WORKBOOK_PARTS
 * sheets, columns A–J — as plain grids. Runs in the BROWSER (a Web Worker, so
 * the 34 MB upload becomes ~2 MB) and on the SERVER (when a raw workbook is
 * uploaded): one implementation, so both paths parse identically.
 *
 * The SheetJS calls are exactly the ones the server made before this existed:
 * two reads, because the padded master sheets need a low row cap and the history
 * a high one — one cap for both would either truncate the history or parse the
 * master sheets' million empty rows.
 */
import * as XLSX from 'xlsx';
import {
  EXTRACT_COLS,
  HISTORY_ROW_CAP,
  MASTER_ROW_CAP,
  WORKBOOK_PARTS,
  WORKBOOK_PART_KEYS,
  findSheet,
  type Cell,
  type ExtractGrid,
  type WorkbookExtract,
  type WorkbookPart,
} from './workbook-shape.ts';

const MASTER_PARTS = WORKBOOK_PART_KEYS.filter((p) => p !== 'history');

function read(data: Uint8Array, sheets: readonly string[], rowCap: number): XLSX.WorkBook {
  return XLSX.read(data, { type: 'array', dense: true, sheets: [...sheets], sheetRows: rowCap });
}

/**
 * A sheet as rows of cells, trimmed for transport: only columns A–J, trailing
 * empty cells and trailing empty rows dropped. Blank rows in the middle stay
 * (as []) — row numbers in error messages are positions in this grid.
 */
function gridOf(wb: XLSX.WorkBook, part: WorkbookPart): ExtractGrid | null {
  const name = findSheet(wb.SheetNames, WORKBOOK_PARTS[part]);
  const ws = name ? wb.Sheets[name] : undefined;
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
  const out: ExtractGrid = [];
  for (const row of rows) {
    const cells: Cell[] = [];
    const n = Math.min(row?.length ?? 0, EXTRACT_COLS);
    for (let c = 0; c < n; c++) cells.push(cell(row[c]));
    while (cells.length > 0 && cells[cells.length - 1] == null) cells.pop();
    out.push(cells);
  }
  while (out.length > 0 && out[out.length - 1]!.length === 0) out.pop();
  return out;
}

/**
 * JSON-safe cell. With `raw: true` dates arrive as Excel serial numbers; a Date
 * object (a cell stored as an ISO date) becomes yyyy-mm-dd — what the parsers'
 * cellDate() would have made of it.
 */
function cell(v: unknown): Cell {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  return String(v);
}

export function extractWorkbook(data: Uint8Array): WorkbookExtract {
  const masterSheets = MASTER_PARTS.flatMap((p) => [...WORKBOOK_PARTS[p]]);
  const masters = read(data, masterSheets, MASTER_ROW_CAP);
  const history = read(data, WORKBOOK_PARTS.history, HISTORY_ROW_CAP);
  const parts = {} as Record<WorkbookPart, ExtractGrid | null>;
  for (const p of MASTER_PARTS) parts[p] = gridOf(masters, p);
  parts.history = gridOf(history, 'history');
  return { v: 1, parts };
}

/**
 * Checks an extract received over the wire — it is user-supplied input. The
 * same role could upload a crafted workbook, so this guards shape and size
 * (the parsers' assumptions), not intent.
 */
export function isWorkbookExtract(x: unknown): x is WorkbookExtract {
  if (typeof x !== 'object' || x == null) return false;
  const e = x as { v?: unknown; parts?: unknown };
  if (e.v !== 1 || typeof e.parts !== 'object' || e.parts == null) return false;
  const parts = e.parts as Record<string, unknown>;
  for (const p of WORKBOOK_PART_KEYS) {
    const g = parts[p];
    if (g === null) continue;
    if (!Array.isArray(g) || g.length > (p === 'history' ? HISTORY_ROW_CAP : MASTER_ROW_CAP)) return false;
    for (const row of g) {
      if (!Array.isArray(row) || row.length > EXTRACT_COLS) return false;
      for (const c of row) {
        const t = typeof c;
        if (c !== null && t !== 'string' && t !== 'number' && t !== 'boolean') return false;
      }
    }
  }
  return true;
}
