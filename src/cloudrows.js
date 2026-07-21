// Build "shared" list rows from cloud group data for the signed-in user, shaped so
// the existing date-grouped renderer can display them and their signed amounts sum
// to the user's effective group spend (matching netForUser in split.js).
//
// Row rules for the current user U:
//  - Expense U paid: one positive row for U's own share, plus, for each unsettled
//    other member's share, a positive row (U is still fronting that money). When
//    everyone settles, only U's own share remains — the ₹300→₹100 rebalance.
//  - Expense U did NOT pay, U's split pending: a negative "-share" borrowed row,
//    excluded from the total until settled.
//  - Expense U did NOT pay, U's split done: a positive row (U's real, settled cost).
//
// Each row carries { shared:true, pending, amt, cat, desc, meta, date, settleId }.

import { state } from './state.js';

const splitsByExpense = () => {
  const m = new Map();
  for (const s of state.mySplits) {
    if (!m.has(s.expense_id)) m.set(s.expense_id, []);
    m.get(s.expense_id).push(s);
  }
  return m;
};

const groupName = (gid) => state.groups.find((g) => g.id === gid)?.name || 'Group';

// All shared rows for the user, unfiltered by month.
export function sharedRows() {
  if (!state.user) return [];
  const uid = state.user.id;
  const byExp = splitsByExpense();
  const rows = [];

  for (const exp of state.groupExpenses) {
    const rowsFor = byExp.get(exp.id) || [];
    const iPaid = exp.payer_id === uid;
    const base = {
      shared: true,
      cat: exp.category || 'Other',
      desc: exp.description || 'Group expense',
      date: exp.spent_on,
      id: exp.id,
    };
    if (iPaid) {
      // Own share (always counts) + any not-yet-settled others' shares (still fronted).
      const myShare = rowsFor.find((s) => s.debtor_id === uid);
      const othersPending = rowsFor.filter((s) => s.debtor_id !== uid && s.status !== 'done');
      const fronted = othersPending.reduce((sum, s) => sum + Number(s.share_amount), 0);
      const amt = (myShare ? Number(myShare.share_amount) : 0) + fronted;
      rows.push({ ...base, amt, pending: false, meta: `${groupName(exp.group_id)} · you paid` });
    } else {
      const mine = rowsFor.find((s) => s.debtor_id === uid);
      if (!mine) continue; // not involved
      if (mine.status === 'pending') {
        rows.push({ ...base, amt: -Number(mine.share_amount), pending: true, settleId: mine.id, meta: `${groupName(exp.group_id)} · you owe` });
      } else {
        rows.push({ ...base, amt: Number(mine.share_amount), pending: false, meta: `${groupName(exp.group_id)} · your share` });
      }
    }
  }
  return rows;
}

// Shared rows for a given month (matches how filtered() scopes personal records).
export function sharedRowsForMonth(cur) {
  return sharedRows().filter((r) => {
    const d = new Date(r.date);
    return d.getMonth() === cur.getMonth() && d.getFullYear() === cur.getFullYear();
  });
}

// The signed total contribution of shared rows toward the month's spent figure:
// pending (negative, owed) rows are EXCLUDED until settled.
export function sharedMonthTotal(cur) {
  return sharedRowsForMonth(cur)
    .filter((r) => !r.pending)
    .reduce((s, r) => s + r.amt, 0);
}
