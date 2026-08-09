import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../src/state.js';
import { personalForMonth, spendRows, monthTotal, dailyBuckets, monthStats, foldToOther } from '../src/analytics.js';

// These helpers read state.recs (personal) and cloud group data. With no user /
// no group data, sharedRowsForMonth() returns [] — so tests here exercise the
// personal + aggregation math in isolation.
beforeEach(() => {
  state.user = null;
  state.groups = [];
  state.groupExpenses = [];
  state.mySplits = [];
  state.recs = [];
});

const rec = (amt, cat, date, pay = 'UPI') => ({ id: Math.round(amt), amt, cat, pay, desc: '', date });

describe('personalForMonth / spendRows', () => {
  it('scopes to the given month only', () => {
    state.recs = [rec(100, 'Food', '2026-08-05'), rec(200, 'Travel', '2026-08-20'), rec(999, 'Food', '2026-07-30')];
    const aug = new Date(2026, 7, 1);
    expect(personalForMonth(aug).length).toBe(2);
    expect(spendRows(aug).length).toBe(2);
  });
});

describe('monthTotal', () => {
  it('sums the month', () => {
    state.recs = [rec(100, 'Food', '2026-08-05'), rec(250, 'Travel', '2026-08-06')];
    expect(monthTotal(new Date(2026, 7, 1))).toBe(350);
  });
  it('is 0 for an empty month', () => {
    expect(monthTotal(new Date(2026, 0, 1))).toBe(0);
  });
});

describe('dailyBuckets', () => {
  it('buckets by day-of-month with correct length', () => {
    state.recs = [rec(100, 'Food', '2026-08-01'), rec(50, 'Food', '2026-08-01'), rec(300, 'Travel', '2026-08-31')];
    const b = dailyBuckets(new Date(2026, 7, 1));
    expect(b.length).toBe(31); // August
    expect(b[0]).toBe(150); // two on day 1
    expect(b[30]).toBe(300); // day 31
    expect(b[10]).toBe(0); // untouched day
  });
  it('February day count adapts (2026 = 28 days)', () => {
    expect(dailyBuckets(new Date(2026, 1, 1)).length).toBe(28);
  });
});

describe('monthStats', () => {
  it('computes total, count, avg/day, biggest, top category', () => {
    state.recs = [rec(100, 'Food', '2026-08-02'), rec(400, 'Travel', '2026-08-10'), rec(300, 'Food', '2026-08-15')];
    const s = monthStats(new Date(2026, 7, 1));
    expect(s.total).toBe(800);
    expect(s.count).toBe(3);
    expect(s.biggest).toBe(400);
    expect(s.topCat).toBe('Food'); // 100 + 300 = 400 > Travel 400? tie -> first seen wins
    expect(s.avgPerDay).toBeCloseTo(800 / 31, 5);
  });

  it('month-over-month delta vs previous month', () => {
    state.recs = [
      rec(1000, 'Food', '2026-07-10'), // prev month baseline
      rec(1200, 'Food', '2026-08-10'), // this month
    ];
    const s = monthStats(new Date(2026, 7, 1));
    expect(s.prevTotal).toBe(1000);
    expect(s.deltaPct).toBeCloseTo(20, 5); // +20%
  });

  it('delta is null with no prior-month baseline', () => {
    state.recs = [rec(500, 'Food', '2026-08-10')];
    expect(monthStats(new Date(2026, 7, 1)).deltaPct).toBeNull();
  });
});

describe('foldToOther', () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ name: 'C' + i, amt: n - i, color: '#000' }));
  it('leaves <= n items untouched', () => {
    const items = mk(5);
    expect(foldToOther(items, 8)).toEqual(items);
  });
  it('folds the tail into Other beyond n', () => {
    const items = mk(10); // amts 10..1
    const out = foldToOther(items, 8);
    expect(out.length).toBe(9); // 8 + Other
    expect(out[8].name).toBe('Other');
    expect(out[8].amt).toBe(2 + 1); // last two folded
  });
});
