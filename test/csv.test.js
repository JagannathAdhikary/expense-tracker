import { describe, it, expect } from 'vitest';
import { parseCsv, toCsv, templateCsv, headerMap, buildRecordFromRow, CSV_HEADERS } from '../src/csv.js';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('handles quoted fields with embedded commas', () => {
    expect(parseCsv('desc\n"Lunch, dinner"')).toEqual([['desc'], ['Lunch, dinner']]);
  });

  it('handles escaped quotes', () => {
    expect(parseCsv('x\n"a ""quoted"" word"')).toEqual([['x'], ['a "quoted" word']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  it('ignores a trailing newline (no spurious empty row)', () => {
    expect(parseCsv('a\n1\n')).toEqual([['a'], ['1']]);
  });

  it('handles a newline inside a quoted field', () => {
    expect(parseCsv('note\n"line1\nline2"')).toEqual([['note'], ['line1\nline2']]);
  });
});

describe('toCsv / templateCsv', () => {
  it('serializes records with the id column and quotes commas', () => {
    const csv = toCsv([{ id: 5, date: '2026-09-25', amt: 250, cat: 'Food', pay: 'UPI', desc: 'Lunch, tea' }]);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(CSV_HEADERS);
    expect(rows[1]).toEqual(['5', '2026-09-25', '250', 'Food', 'UPI', 'Lunch, tea']);
  });

  it('template omits the id column and has example rows', () => {
    const rows = parseCsv(templateCsv());
    expect(rows[0]).toEqual(['date', 'amount', 'category', 'payment', 'description']);
    expect(rows.length).toBe(3);
    // Second example fills only the required columns, optionals blank.
    expect(rows[2]).toEqual(['2026-09-25', '80', '', '', '']);
  });

  it('round-trips through parse', () => {
    const csv = toCsv([{ id: 1, date: '2026-01-02', amt: 10, cat: 'A', pay: null, desc: '' }]);
    const rows = parseCsv(csv);
    const hmap = headerMap(rows[0]);
    const res = buildRecordFromRow(rows[1], hmap);
    expect(res.ok).toBe(true);
    expect(res.record).toMatchObject({ id: 1, date: '2026-01-02', amt: 10, cat: 'A', pay: null });
  });
});

describe('buildRecordFromRow', () => {
  const hmap = headerMap(['id', 'date', 'amount', 'category', 'payment', 'description']);
  const row = (id, date, amount, cat = '', pay = '', desc = '') => [id, date, amount, cat, pay, desc];

  it('builds a valid record and keeps blank optional fields', () => {
    const res = buildRecordFromRow(row('', '2026-09-25', '99.5'), hmap);
    expect(res.ok).toBe(true);
    expect(res.record).toEqual({ amt: 99.5, cat: '', pay: null, desc: '', date: '2026-09-25' });
    expect('id' in res.record).toBe(false);
  });

  it('carries a numeric id when supplied', () => {
    const res = buildRecordFromRow(row('42', '2026-09-25', '10'), hmap);
    expect(res.record.id).toBe(42);
  });

  it('fails on a missing date', () => {
    expect(buildRecordFromRow(row('', '', '10'), hmap)).toMatchObject({ ok: false });
  });

  it('fails on a bad date format', () => {
    expect(buildRecordFromRow(row('', '25/09/2026', '10'), hmap)).toMatchObject({ ok: false });
  });

  it('fails on a nonexistent calendar date (Sep 31, Feb 30)', () => {
    expect(buildRecordFromRow(row('', '2026-09-31', '10'), hmap)).toMatchObject({ ok: false });
    expect(buildRecordFromRow(row('', '2026-02-30', '10'), hmap)).toMatchObject({ ok: false });
    expect(buildRecordFromRow(row('', '2026-13-01', '10'), hmap)).toMatchObject({ ok: false });
  });

  it('fails on a missing amount', () => {
    expect(buildRecordFromRow(row('', '2026-09-25', ''), hmap)).toMatchObject({ ok: false });
  });

  it('fails on a non-numeric amount', () => {
    expect(buildRecordFromRow(row('', '2026-09-25', 'abc'), hmap)).toMatchObject({ ok: false });
  });

  it('fails on a zero or negative amount', () => {
    expect(buildRecordFromRow(row('', '2026-09-25', '0'), hmap)).toMatchObject({ ok: false });
    expect(buildRecordFromRow(row('', '2026-09-25', '-5'), hmap)).toMatchObject({ ok: false });
  });

  it('is tolerant of header case and column order', () => {
    const hm = headerMap(['Amount', 'DATE', 'Description']);
    const res = buildRecordFromRow(['12.50', '2026-09-25', 'Coffee'], hm);
    expect(res.ok).toBe(true);
    expect(res.record).toMatchObject({ amt: 12.5, date: '2026-09-25', desc: 'Coffee' });
  });

  describe('category / payment matching against app context', () => {
    const opts = { cats: ['Food', 'Travel'], pays: ['UPI', 'Cash'], defaultCat: 'Food', defaultPay: 'UPI' };

    it('matches case-insensitively and stores the canonical app name', () => {
      const res = buildRecordFromRow(row('', '2026-09-25', '10', 'food', 'cash'), hmap, opts);
      expect(res.ok).toBe(true);
      expect(res.record).toMatchObject({ cat: 'Food', pay: 'Cash' });
    });

    it('assigns the default when category / payment are blank', () => {
      const res = buildRecordFromRow(row('', '2026-09-25', '10', '', ''), hmap, opts);
      expect(res.ok).toBe(true);
      expect(res.record).toMatchObject({ cat: 'Food', pay: 'UPI' });
    });

    it('fails on an unknown category', () => {
      const res = buildRecordFromRow(row('', '2026-09-25', '10', 'Groceries', 'UPI'), hmap, opts);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/Groceries/);
    });

    it('fails on an unknown payment', () => {
      const res = buildRecordFromRow(row('', '2026-09-25', '10', 'Food', 'Bitcoin'), hmap, opts);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/Bitcoin/);
    });
  });
});
