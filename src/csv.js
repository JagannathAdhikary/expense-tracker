// Pure CSV helpers for the expense import/export flow — no DOM, no app state, so they
// can be unit-tested directly. The DOM/side-effect layer lives in features/backup.js.
//
// CSV shape (fixed header; import is tolerant of column order + case + surrounding
// spaces): id,date,amount,category,payment,description
//   - id          optional. Present in an app export so re-importing is a clean RESTORE
//                 (rows whose id already exists are skipped). Blank/absent in a
//                 hand-made/template CSV, so those rows always add as new expenses.
//   - date        required, YYYY-MM-DD.
//   - amount      required, positive number (the app models expenses only).
//   - category    optional.
//   - payment     optional (blank -> stored as null).
//   - description optional.

// Canonical column order for export + template.
export const CSV_HEADERS = ['id', 'date', 'amount', 'category', 'payment', 'description'];

// Quote a field for CSV output when it contains a comma, quote, or newline; escape
// embedded quotes by doubling them (RFC 4180).
function csvQuote(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Serialize records to CSV text (with the id column, for round-trip restore).
// `records` are app records: { id, amt, cat, pay, desc, date }.
export function toCsv(records) {
  const lines = [CSV_HEADERS.join(',')];
  for (const r of records) {
    lines.push([
      csvQuote(r.id),
      csvQuote(r.date),
      csvQuote(r.amt),
      csvQuote(r.cat),
      csvQuote(r.pay),
      csvQuote(r.desc),
    ].join(','));
  }
  return lines.join('\r\n');
}

// The template CSV: header WITHOUT id (users shouldn't have to invent ids) plus one
// example row so the expected format is obvious.
export function templateCsv() {
  const headers = CSV_HEADERS.filter((h) => h !== 'id');
  const example = ['2026-09-25', '250.00', 'Food', 'UPI', 'Lunch with team'];
  return [headers.join(','), example.join(',')].join('\r\n');
}

// Parse CSV text into an array of string-arrays (one per row). Handles quoted fields
// with embedded commas/newlines/escaped quotes, and both LF and CRLF line endings.
// A trailing newline does not produce a spurious empty row.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let sawAny = false; // did the current row have any content/cell?

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
    sawAny = false;
  };

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
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      sawAny = true;
    } else if (ch === ',') {
      pushField();
      sawAny = true;
    } else if (ch === '\n' || ch === '\r') {
      // Consume a CRLF pair as a single line break.
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (sawAny || field.length) pushRow();
    } else {
      field += ch;
      sawAny = true;
    }
  }
  // Flush the last field/row if the file didn't end with a newline.
  if (sawAny || field.length) pushRow();
  return rows;
}

// Map a header row to { colName -> index }, tolerant of case + surrounding spaces.
// Unknown extra columns are ignored. Returns a plain object.
export function headerMap(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const key = String(h || '').trim().toLowerCase();
    if (key && !(key in map)) map[key] = i;
  });
  return map;
}

const cell = (cols, hmap, name) => {
  const i = hmap[name];
  return i == null ? '' : String(cols[i] ?? '').trim();
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Validate + build one record from a data row. Pure: does not mutate app state and does
// not assign an id (the caller owns id generation / dedupe). Returns:
//   { ok: true, record: { amt, cat, pay, desc, date, id? } }
//   { ok: false, error: 'reason' }
// `id` is included in the record only when the row carried a non-empty id column.
export function buildRecordFromRow(cols, hmap) {
  const rawDate = cell(cols, hmap, 'date');
  const rawAmt = cell(cols, hmap, 'amount');
  const cat = cell(cols, hmap, 'category');
  const pay = cell(cols, hmap, 'payment');
  const desc = cell(cols, hmap, 'description');
  const rawId = cell(cols, hmap, 'id');

  if (!rawDate) return { ok: false, error: 'Missing date' };
  if (!DATE_RE.test(rawDate)) return { ok: false, error: `Invalid date "${rawDate}" (expected YYYY-MM-DD)` };
  const d = new Date(rawDate + 'T00:00:00');
  if (isNaN(d.getTime())) return { ok: false, error: `Invalid date "${rawDate}"` };

  if (!rawAmt) return { ok: false, error: 'Missing amount' };
  const amt = Number(rawAmt);
  if (!Number.isFinite(amt)) return { ok: false, error: `Invalid amount "${rawAmt}"` };
  if (amt <= 0) return { ok: false, error: `Amount must be positive (got ${rawAmt})` };

  const record = {
    amt,
    cat: cat || '',
    pay: pay || null,
    desc: desc || '',
    date: rawDate,
  };
  if (rawId) {
    const idNum = Number(rawId);
    if (Number.isFinite(idNum)) record.id = idNum;
  }
  return { ok: true, record };
}

// Build the downloadable import-report CSV. `results` is an array of
// { row, cols, status: 'SUCCESS'|'SKIPPED'|'FAILED', error }, in input order.
// Columns: row,date,amount,category,payment,description,status,error.
export function reportCsv(results) {
  const lines = ['row,date,amount,category,payment,description,status,error'];
  for (const r of results) {
    const c = r.cols || [];
    const g = (name) => {
      const i = r.hmap?.[name];
      return i == null ? '' : c[i] ?? '';
    };
    lines.push([
      csvQuote(r.row),
      csvQuote(g('date')),
      csvQuote(g('amount')),
      csvQuote(g('category')),
      csvQuote(g('payment')),
      csvQuote(g('description')),
      csvQuote(r.status),
      csvQuote(r.error || ''),
    ].join(','));
  }
  return lines.join('\r\n');
}
