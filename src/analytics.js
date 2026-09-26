// Analytics aggregations — pure functions over the app's rows for a given month.
// A "row" is the same shape home uses: personal recs ({amt,cat,pay,date,desc}) and
// shared group rows from sharedRows() ({shared:true, groupId, pending, amt, ...}).
// Pending (unsettled "you owe") rows are excluded from spend totals everywhere, to
// match the home/month total.

import { state } from './state.js';
import { sharedRows, sharedRowsForMonth } from './cloudrows.js';
import { catByName } from './format.js';
import { PALETTE, MN, DAYS } from './constants.js';

const inMonth = (dateStr, cur) => {
  const d = new Date(dateStr);
  return d.getMonth() === cur.getMonth() && d.getFullYear() === cur.getFullYear();
};

// Personal recs for a month (any Date), mirroring format.filtered() but parameterized.
export function personalForMonth(cur) {
  return state.recs.filter((r) => inMonth(r.date, cur));
}

// The merged, spend-counting rows for a month: personal + non-pending shared.
// (Pending owed rows don't count toward spend.)
export function spendRows(cur) {
  const personal = personalForMonth(cur);
  const shared = sharedRowsForMonth(cur).filter((r) => !r.pending);
  return [...personal, ...shared];
}

// Total spend for a month.
export function monthTotal(cur) {
  return spendRows(cur).reduce((s, r) => s + r.amt, 0);
}

// Per-day totals across the month: array length = days in month, index 0 = day 1.
export function dailyBuckets(cur) {
  const days = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
  const buckets = new Array(days).fill(0);
  for (const r of spendRows(cur)) {
    const d = new Date(r.date);
    const idx = d.getDate() - 1;
    if (idx >= 0 && idx < days) buckets[idx] += r.amt;
  }
  return buckets;
}

// Headline stats for a month. `prev` total drives the month-over-month delta.
export function monthStats(cur) {
  const rows = spendRows(cur);
  const total = rows.reduce((s, r) => s + r.amt, 0);
  const count = rows.length;
  const days = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
  const avgPerDay = total / days;
  const biggest = rows.reduce((m, r) => (r.amt > m ? r.amt : m), 0);

  // Top category by spend.
  const byCat = {};
  for (const r of rows) byCat[r.cat] = (byCat[r.cat] || 0) + r.amt;
  let topCat = null;
  let topCatAmt = 0;
  for (const [cat, amt] of Object.entries(byCat)) {
    if (amt > topCatAmt) {
      topCat = cat;
      topCatAmt = amt;
    }
  }

  // Month-over-month: total vs the previous month's total.
  const prevCur = new Date(cur.getFullYear(), cur.getMonth() - 1, 1);
  const prevTotal = monthTotal(prevCur);
  const deltaPct = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null; // null = no baseline

  return { total, count, avgPerDay, biggest, topCat, topCatAmt, prevTotal, deltaPct };
}

// Fold a category-share list to a top-N plus an "Other" bucket, preserving order.
// Input: [{name, amt, color}], sorted desc by amount. Returns same shape, <= n+1 items.
export function foldToOther(items, n = 8, otherColor = '#9aa3ad') {
  if (items.length <= n) return items;
  const head = items.slice(0, n);
  const tailAmt = items.slice(n).reduce((s, x) => s + x.amt, 0);
  if (tailAmt > 0) head.push({ name: 'Other', amt: tailAmt, color: otherColor });
  return head;
}

// ---------------------------------------------------------------------------
// Period-aware aggregations. A "period" is a set of month Dates (each day 1),
// oldest-first, ending at the anchor month (state.cur by default). All history
// is already in memory (state.recs + sharedRows()), so these are pure loops with
// no fetching — every chart on the analytics page draws from the same slice.
// ---------------------------------------------------------------------------

// Day-1 Date for a given year/month, and a normalized "year*12+month" key.
const monthStart = (y, m) => new Date(y, m, 1);
const ymKey = (d) => d.getFullYear() * 12 + d.getMonth();

// The earliest month (day-1 Date) with any spend, scanning personal + shared rows.
// Falls back to the anchor month when there's no data at all.
export function earliestMonth(anchor = state.cur) {
  let min = null;
  const consider = (dateStr) => {
    const d = new Date(dateStr);
    if (!Number.isNaN(d.getTime()) && (min == null || d < min)) min = d;
  };
  for (const r of state.recs) consider(r.date);
  for (const r of sharedRows()) if (!r.pending) consider(r.date);
  if (!min) return monthStart(anchor.getFullYear(), anchor.getMonth());
  return monthStart(min.getFullYear(), min.getMonth());
}

// The list of month Dates for a period selection, oldest-first, ending at `anchor`.
// `n` = number of trailing months (1 = anchor only); 'all' spans from earliestMonth.
export function monthsBack(n, anchor = state.cur) {
  const end = monthStart(anchor.getFullYear(), anchor.getMonth());
  let count;
  if (n === 'all') {
    count = ymKey(end) - ymKey(earliestMonth(anchor)) + 1;
  } else {
    count = Math.max(1, n);
  }
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(monthStart(end.getFullYear(), end.getMonth() - i));
  return out;
}

// Merged non-pending spend rows across a set of months (built on spendRows).
export function rangeRows(months) {
  return months.flatMap((m) => spendRows(m));
}

// Number of calendar days covered by a set of months (for a true avg/day).
function daysInMonths(months) {
  return months.reduce((s, m) => s + new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate(), 0);
}

// Headline stats for a period. Generalizes monthStats: delta compares this window to
// the immediately-preceding equal-length window (for a 1-month range that's the prior
// month, matching monthStats). deltaPct is null when there's no prior baseline.
export function rangeStats(months) {
  const rows = rangeRows(months);
  const total = rows.reduce((s, r) => s + r.amt, 0);
  const count = rows.length;
  const days = daysInMonths(months) || 1;
  const avgPerDay = total / days;
  const biggest = rows.reduce((m, r) => (r.amt > m ? r.amt : m), 0);

  const byCat = {};
  for (const r of rows) byCat[r.cat] = (byCat[r.cat] || 0) + r.amt;
  let topCat = null;
  let topCatAmt = 0;
  for (const [cat, amt] of Object.entries(byCat)) {
    if (amt > topCatAmt) { topCat = cat; topCatAmt = amt; }
  }

  // Preceding equal-length window: the same number of months ending just before this one.
  const first = months[0];
  const len = months.length;
  const prevMonths = [];
  for (let i = len; i >= 1; i--) prevMonths.push(monthStart(first.getFullYear(), first.getMonth() - i));
  const prevTotal = prevMonths.reduce((s, m) => s + monthTotal(m), 0);
  const deltaPct = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;

  return { total, count, avgPerDay, biggest, topCat, topCatAmt, prevTotal, deltaPct, months: len };
}

// Per-month totals for the trend line: [{ label:'Sep', ym, total }], oldest-first.
export function monthlySeries(months) {
  return months.map((m) => ({ label: MN[m.getMonth()], year: m.getFullYear(), ym: ymKey(m), total: monthTotal(m) }));
}

// Category totals across a period: [{ name, amt, color }] desc. Colors from catByName.
export function categoryTotals(months) {
  const byc = {};
  for (const r of rangeRows(months)) byc[r.cat] = (byc[r.cat] || 0) + r.amt;
  return Object.entries(byc)
    .map(([name, amt]) => ({ name, amt, color: catByName(name).c }))
    .sort((a, b) => b.amt - a.amt);
}

// Payment-method totals across a period: [{ name, amt, color }] desc. state.PAYS has
// no color, so assign from PALETTE by stable name order (index into the pays list).
export function paymentTotals(months) {
  const byp = {};
  for (const r of rangeRows(months)) {
    const name = r.pay || 'Other';
    byp[name] = (byp[name] || 0) + r.amt;
  }
  const order = state.PAYS.map((p) => p.n);
  const colorFor = (name) => {
    const i = order.indexOf(name);
    return PALETTE[(i >= 0 ? i : order.length) % PALETTE.length];
  };
  return Object.entries(byp)
    .map(([name, amt]) => ({ name, amt, color: colorFor(name) }))
    .sort((a, b) => b.amt - a.amt);
}

// Weekday spend distribution across a period: 7 sums, index 0 = Sunday (matches DAYS).
export function weekdayBuckets(months) {
  const buckets = new Array(7).fill(0);
  for (const r of rangeRows(months)) {
    const d = new Date(r.date);
    if (!Number.isNaN(d.getTime())) buckets[d.getDay()] += r.amt;
  }
  return buckets;
}

// Day-of-month spend distribution across a period: 31 sums, index 0 = day 1.
// Generalizes dailyBuckets to span multiple months (days summed by calendar day).
export function dayOfMonthBuckets(months) {
  const buckets = new Array(31).fill(0);
  for (const r of rangeRows(months)) {
    const d = new Date(r.date);
    const idx = d.getDate() - 1;
    if (idx >= 0 && idx < 31) buckets[idx] += r.amt;
  }
  return buckets;
}

// Weekday labels in the bucket order above (Sun-first), re-exported for the view.
export const WEEKDAYS = DAYS;
