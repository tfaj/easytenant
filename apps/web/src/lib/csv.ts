// Strip a UTF-8 BOM (Excel adds one) before parsing.
/**
 * Minimal CSV parser for the unit import.
 * Handles quoted fields with embedded commas/quotes/newlines — enough for
 * a file exported from Excel/Sheets — without pulling in a dependency for
 * what's a small, well-defined use case (a couple of columns, a few
 * thousand rows at most). Returns rows as objects keyed by the
 * lowercased, trimmed header.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = splitCsvRows(text.replace(/^\uFEFF/, ""));
  if (rows.length === 0) return [];

  const headers = rows[0]!.map((h) => h.trim().toLowerCase());
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = (row[i] ?? "").trim();
      });
      return obj;
    });
}

function splitCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}
