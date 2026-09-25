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

// The template CSV: header WITHOUT id (users shouldn't have to invent ids). The header
// must stay the exact machine-readable names so import maps the columns; the required vs
// optional guidance lives in the example rows (and the import dialog's note). First example
// fills every column; second fills only the two required ones (date, amount) with the
// optionals left blank, so it's self-evident which columns may be empty.
export function templateCsv() {
  const headers = CSV_HEADERS.filter((h) => h !== 'id');
  const examples = [
    ['2026-09-25', '250.00', 'Food', 'UPI', 'Lunch with team'],
    ['2026-09-25', '80', '', '', ''],
  ];
  return [headers.join(','), ...examples.map((e) => e.join(','))].join('\r\n');
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

// Resolve a CSV category/payment cell against the app's known names:
//   - empty            -> { value: <fallback default> }  (every user has a default)
//   - matches a known  -> { value: <canonical app name> } (case-insensitive; "food" -> "Food")
//   - non-empty, no match -> { error }  (don't silently invent it)
// `known` is the list of app names; `fallback` is the default to use when the cell is blank.
// When `known` is null (e.g. unit tests calling without app context) matching is skipped:
// empty stays empty and any value passes through unchanged.
function resolveName(raw, known, fallback, label) {
  if (!raw) return { value: known ? fallback : '' };
  if (!known) return { value: raw };
  const hit = known.find((n) => n.toLowerCase() === raw.toLowerCase());
  if (hit) return { value: hit };
  return { error: `Unknown ${label} "${raw}"` };
}

// Validate + build one record from a data row. Pure: does not mutate app state and does
// not assign an id (the caller owns id generation / dedupe). Returns:
//   { ok: true, record: { amt, cat, pay, desc, date, id? } }
//   { ok: false, error: 'reason' }
// `id` is included in the record only when the row carried a non-empty id column.
//
// `opts` supplies the app context so category/payment are matched (not invented):
//   { cats: [names], pays: [names], defaultCat: name, defaultPay: name }
// Blank category/payment fall back to defaultCat/defaultPay; a non-empty value must match
// an existing name (case-insensitive) or the row fails. Omit `opts` to skip matching.
export function buildRecordFromRow(cols, hmap, opts = {}) {
  const { cats = null, pays = null, defaultCat = '', defaultPay = null } = opts;
  const rawDate = cell(cols, hmap, 'date');
  const rawAmt = cell(cols, hmap, 'amount');
  const cat = cell(cols, hmap, 'category');
  const pay = cell(cols, hmap, 'payment');
  const desc = cell(cols, hmap, 'description');
  const rawId = cell(cols, hmap, 'id');

  if (!rawDate) return { ok: false, error: 'Missing date' };
  if (!DATE_RE.test(rawDate)) return { ok: false, error: `Invalid date "${rawDate}" (expected YYYY-MM-DD)` };
  // new Date() silently rolls invalid days over (2026-09-31 -> Oct 1), so it can't be
  // trusted alone. Verify the parsed Y/M/D round-trips back to the input to reject days
  // that don't exist (Sep 31, Feb 30, month 13, ...).
  const [yy, mm, dd] = rawDate.split('-').map(Number);
  const d = new Date(rawDate + 'T00:00:00');
  if (isNaN(d.getTime()) || d.getFullYear() !== yy || d.getMonth() + 1 !== mm || d.getDate() !== dd) {
    return { ok: false, error: `Invalid date "${rawDate}" (not a real calendar date)` };
  }

  if (!rawAmt) return { ok: false, error: 'Missing amount' };
  const amt = Number(rawAmt);
  if (!Number.isFinite(amt)) return { ok: false, error: `Invalid amount "${rawAmt}"` };
  if (amt <= 0) return { ok: false, error: `Amount must be positive (got ${rawAmt})` };

  const catRes = resolveName(cat, cats, defaultCat, 'category');
  if (catRes.error) return { ok: false, error: catRes.error };
  const payRes = resolveName(pay, pays, defaultPay, 'payment');
  if (payRes.error) return { ok: false, error: payRes.error };

  const record = {
    amt,
    cat: catRes.value || '',
    pay: payRes.value || null,
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
