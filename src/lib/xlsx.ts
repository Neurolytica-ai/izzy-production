/**
 * Excel parsing primitives (WP §9), ported line-for-line from the prototype's
 * import section (sheetGrid/findHeader/colMap/contractorOf/clientOf, :828-840).
 *
 * The prototype's parsers — NOT WP §9.1's column table — are the authoritative
 * spec: they are what runs against the customer's real files in daily use, and
 * §9.1 provably disagrees with them (OPEN-QUESTIONS #5: `client` is derived from
 * the project name, `contractor` from a hardcoded regex list, the injection
 * header is `פוליאוריתן` not `הזרקה`). Where behavior here differs from the
 * prototype it is called out inline.
 */
import * as XLSX from 'xlsx';

/** One worksheet as a row-major grid, nulls preserved — the prototype's sheetGrid(). */
export type Grid = (string | number | boolean | Date | null)[][];

export function gridFromBuffer(buf: Buffer): Grid {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const ws = wb.Sheets[first]!;
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as Grid;
}

/**
 * Locates the header row: the first of the top 8 rows containing any of the
 * given key fragments (prototype findHeader, :832 — headers are "not always the
 * first row", WP §9).
 */
export function findHeader(grid: Grid, keys: string[]): { idx: number; row: string[] } {
  for (let i = 0; i < Math.min(grid.length, 8); i++) {
    const row = (grid[i] ?? []).map((c) => (c == null ? '' : String(c).trim()));
    if (keys.some((k) => row.some((cell) => cell.includes(k)))) return { idx: i, row };
  }
  return { idx: -1, row: [] };
}

/**
 * Maps field names to column indexes. Two passes, exactly like the prototype
 * (colMap, :834): exact header match first, then substring — so "שם עובד" wins
 * over a later column that merely contains "שם". A column is used at most once.
 */
export function colMap(headRow: string[], defs: Record<string, string[]>): Record<string, number> {
  const map: Record<string, number> = {};
  const used = new Set<number>();
  const cells = headRow.map((c) => (c == null ? '' : String(c).trim()));

  for (const [key, pats] of Object.entries(defs)) {
    for (let i = 0; i < cells.length; i++) {
      if (used.has(i)) continue;
      if (pats.some((p) => cells[i] === p)) {
        map[key] = i;
        used.add(i);
        break;
      }
    }
  }
  for (const [key, pats] of Object.entries(defs)) {
    if (map[key] != null) continue;
    for (let i = 0; i < cells.length; i++) {
      if (used.has(i)) continue;
      if (pats.some((p) => cells[i]!.includes(p))) {
        map[key] = i;
        used.add(i);
        break;
      }
    }
  }
  return map;
}

/**
 * Subcontractor from the employee's full name (prototype contractorOf, :838).
 * The names in the real files carry the contractor as a suffix; there is no
 * dedicated column, whatever WP §9.1 says.
 */
export function contractorOf(full: unknown): string | null {
  const n = String(full);
  if (n.includes('עו"ז')) return 'עו"ז';
  if (n.includes('א.ב')) return 'א.ב.הנדסה';
  const m = n.match(/-\s*(סלים|ראיד|בישר)\s*$/);
  return m ? m[1]! : null;
}

/** Customer from the project name (prototype clientOf, :840): the text before the first dash/paren/digit. */
export function clientOf(name: unknown): string {
  let n = String(name).split(/\s*[-–(]/)[0]!;
  n = n.replace(/\d.*/, '');
  return n.trim().replace(/"/g, '').trim();
}

/**
 * A cell that should be a date → ISO yyyy-mm-dd. Handles the three shapes real
 * files produce: a Date object, an Excel serial number, or text. Returns null
 * when the cell holds nothing usable (the prototype fell back to '' or today,
 * which silently mis-dates rows — a bulk-history import must refuse instead).
 */
export function cellDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // dd/mm/yyyy or dd.mm.yyyy — the format the office types by hand.
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return null;
}

/** Build an .xlsx download from JSON rows (keys become the header row). */
export function workbookBuffer(rows: Record<string, unknown>[], sheetName: string): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
