/**
 * Minimal RFC 4180 CSV parser — quoted fields, embedded commas, escaped
 * quotes, CRLF. Seeds are data-as-code; this keeps them dependency-free.
 */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
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
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n') {
      pushRow();
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();

  const header = rows.shift() ?? [];
  // tolerate a trailing newline producing an empty record
  const data = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
  return { header, rows: data };
}
