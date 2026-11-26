/**
 * CSV helpers (F-905, SCR-A13) — pure and unit-tested.
 *
 * Formula-injection safety (specs §3.5 SCR-A13): any cell whose first
 * character is one of `= + - @` (or a tab/CR, which some spreadsheet
 * apps treat the same way) is prefixed with a single quote so a
 * spreadsheet opens it as text, never as a formula.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * Minimal RFC-4180 parser for the donor-import paste box: handles
 * quoted cells, embedded commas/newlines and CRLF. Returns rows of
 * string cells; the header row is rows[0].
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}
