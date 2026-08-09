// Analytics aggregations — pure functions over the app's rows for a given month.
// A "row" is the same shape home uses: personal recs ({amt,cat,pay,date,desc}) and
// shared group rows from sharedRows() ({shared:true, groupId, pending, amt, ...}).
// Pending (unsettled "you owe") rows are excluded from spend totals everywhere, to
// match the home/month total.

import { state } from './state.js';
import { sharedRowsForMonth } from './cloudrows.js';

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
