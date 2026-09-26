import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../src/state.js';
import { personalForMonth, spendRows, monthTotal, dailyBuckets, monthStats, foldToOther,
  earliestMonth, monthsBack, rangeRows, rangeStats, monthlySeries, categoryTotals,
  paymentTotals, weekdayBuckets, dayOfMonthBuckets, WEEKDAYS } from '../src/analytics.js';

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

// ---- Period-aware aggregations -------------------------------------------
// All take an explicit `anchor` where relevant so they don't depend on state.cur.

describe('monthsBack / earliestMonth', () => {
  const anchor = new Date(2026, 7, 1); // Aug 2026

  it('n=1 returns just the anchor month', () => {
    const m = monthsBack(1, anchor);
    expect(m.length).toBe(1);
    expect(m[0].getMonth()).toBe(7);
    expect(m[0].getFullYear()).toBe(2026);
  });

  it('n=3 returns 3 trailing months oldest-first, ending at anchor', () => {
    const m = monthsBack(3, anchor);
    expect(m.map((d) => d.getMonth())).toEqual([5, 6, 7]); // Jun, Jul, Aug
    expect(m.every((d) => d.getDate() === 1)).toBe(true);
  });

  it('spans a year boundary', () => {
    const m = monthsBack(3, new Date(2026, 1, 1)); // Feb 2026
    expect(m.map((d) => `${d.getFullYear()}-${d.getMonth()}`)).toEqual(['2025-11', '2026-0', '2026-1']);
  });

  it("'all' spans earliest spend month to the anchor", () => {
    state.recs = [rec(10, 'Food', '2026-06-15'), rec(20, 'Food', '2026-08-02')];
    expect(earliestMonth(anchor).getMonth()).toBe(5); // June
    const m = monthsBack('all', anchor);
    expect(m.map((d) => d.getMonth())).toEqual([5, 6, 7]); // Jun..Aug
  });

  it("'all' falls back to the anchor month when there is no data", () => {
    const m = monthsBack('all', anchor);
    expect(m.length).toBe(1);
    expect(m[0].getMonth()).toBe(7);
  });
});

describe('rangeRows / rangeStats', () => {
  it('merges rows across the range and totals them', () => {
    state.recs = [rec(100, 'Food', '2026-06-10'), rec(200, 'Travel', '2026-07-10'), rec(300, 'Food', '2026-08-10')];
    const months = monthsBack(3, new Date(2026, 7, 1));
    expect(rangeRows(months).length).toBe(3);
    const s = rangeStats(months);
    expect(s.total).toBe(600);
    expect(s.count).toBe(3);
    expect(s.months).toBe(3);
    expect(s.topCat).toBe('Food'); // 100 + 300 = 400 > Travel 200
    expect(s.biggest).toBe(300);
  });

  it('avgPerDay divides by the true day count across months', () => {
    state.recs = [rec(620, 'Food', '2026-07-10')]; // Jun(30)+Jul(31) = 61 days
    const months = monthsBack(2, new Date(2026, 6, 1)); // Jun, Jul
    expect(rangeStats(months).avgPerDay).toBeCloseTo(620 / 61, 5);
  });

  it('delta compares to the preceding equal-length window', () => {
    state.recs = [
      rec(1000, 'Food', '2026-05-10'), // preceding window (May+Jun) baseline
      rec(1500, 'Food', '2026-07-10'), // current window (Jul+Aug)
    ];
    const months = monthsBack(2, new Date(2026, 7, 1)); // Jul, Aug
    const s = rangeStats(months);
    expect(s.prevTotal).toBe(1000); // May+Jun
    expect(s.deltaPct).toBeCloseTo(50, 5);
  });

  it('deltaPct is null with no prior baseline', () => {
    state.recs = [rec(500, 'Food', '2026-08-10')];
    expect(rangeStats(monthsBack(2, new Date(2026, 7, 1))).deltaPct).toBeNull();
  });
});

describe('monthlySeries', () => {
  it('yields one entry per month, oldest-first, with month labels + totals', () => {
    state.recs = [rec(100, 'Food', '2026-06-10'), rec(300, 'Food', '2026-08-10')];
    const series = monthlySeries(monthsBack(3, new Date(2026, 7, 1)));
    expect(series.map((p) => p.label)).toEqual(['Jun', 'Jul', 'Aug']);
    expect(series.map((p) => p.total)).toEqual([100, 0, 300]);
    expect(series[0].year).toBe(2026);
  });
});

describe('categoryTotals', () => {
  it('sums by category across the range, sorted desc', () => {
    state.recs = [rec(100, 'Food', '2026-07-05'), rec(400, 'Travel', '2026-08-05'), rec(250, 'Food', '2026-08-06')];
    const out = categoryTotals(monthsBack(2, new Date(2026, 7, 1)));
    expect(out.map((c) => c.name)).toEqual(['Travel', 'Food']); // Travel 400 > Food 350
    expect(out[0]).toMatchObject({ name: 'Travel', amt: 400 });
    expect(out[1]).toMatchObject({ name: 'Food', amt: 350 });
    expect(out.every((c) => typeof c.color === 'string')).toBe(true);
  });
});

describe('paymentTotals', () => {
  it('sums by payment method across the range, sorted desc, with a color each', () => {
    state.recs = [rec(100, 'Food', '2026-08-01', 'UPI'), rec(300, 'Food', '2026-08-02', 'Cash'), rec(50, 'Food', '2026-08-03', 'UPI')];
    const out = paymentTotals(monthsBack(1, new Date(2026, 7, 1)));
    expect(out[0]).toMatchObject({ name: 'Cash', amt: 300 });
    expect(out[1]).toMatchObject({ name: 'UPI', amt: 150 });
    expect(out.every((p) => typeof p.color === 'string')).toBe(true);
  });
});

describe('weekdayBuckets', () => {
  it('sums into 7 slots with index 0 = Sunday', () => {
    // 2026-08-02 is a Sunday, 2026-08-03 a Monday.
    state.recs = [rec(100, 'Food', '2026-08-02'), rec(40, 'Food', '2026-08-03'), rec(60, 'Food', '2026-08-03')];
    const b = weekdayBuckets(monthsBack(1, new Date(2026, 7, 1)));
    expect(b.length).toBe(7);
    expect(b[0]).toBe(100); // Sunday
    expect(b[1]).toBe(100); // Monday: 40 + 60
    expect(WEEKDAYS[0]).toBe('Sun');
  });
});

describe('dayOfMonthBuckets', () => {
  it('sums into 31 slots (index 0 = day 1) across months', () => {
    state.recs = [rec(100, 'Food', '2026-07-01'), rec(50, 'Food', '2026-08-01'), rec(300, 'Food', '2026-08-31')];
    const b = dayOfMonthBuckets(monthsBack(2, new Date(2026, 7, 1)));
    expect(b.length).toBe(31);
    expect(b[0]).toBe(150); // day 1 across Jul + Aug
    expect(b[30]).toBe(300); // day 31
  });
});
