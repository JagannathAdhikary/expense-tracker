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

// True if any non-payer share of this expense has been settled. Used to lock
// edits (amount/group/split) and block deletion once money has changed hands.
export function expenseHasPayment(expenseId) {
  const exp = state.groupExpenses.find((e) => e.id === expenseId);
  if (!exp) return false;
  return state.mySplits.some((s) => s.expense_id === expenseId && s.debtor_id !== exp.payer_id && s.status === 'done');
}

// What the current user owes within a group, aggregated per creditor (payer).
// Returns { byPayer: [{payerId, amount}], total } over pending, non-self shares.
export function owedByUserInGroup(groupId) {
  if (!state.user) return { byPayer: [], total: 0 };
  const uid = state.user.id;
  const payerByExp = new Map(state.groupExpenses.filter((e) => e.group_id === groupId).map((e) => [e.id, e.payer_id]));
  const totals = {}; // payerId -> paise
  for (const s of state.mySplits) {
    if (s.debtor_id !== uid || s.status !== 'pending') continue;
    const payer = payerByExp.get(s.expense_id);
    if (!payer || payer === uid) continue; // not in this group, or self
    totals[payer] = (totals[payer] || 0) + Math.round(Number(s.share_amount) * 100);
  }
  const byPayer = Object.entries(totals).map(([payerId, paise]) => ({ payerId, amount: paise / 100 }));
  const total = byPayer.reduce((s, x) => s + x.amount, 0);
  return { byPayer, total };
}

// What others owe the current user within a group, aggregated per debtor.
// Returns { byDebtor: [{debtorId, amount}], total } over pending shares of
// expenses the current user paid.
export function owedToUserInGroup(groupId) {
  if (!state.user) return { byDebtor: [], total: 0 };
  const uid = state.user.id;
  // Expenses in this group that I paid.
  const myExpIds = new Set(state.groupExpenses.filter((e) => e.group_id === groupId && e.payer_id === uid).map((e) => e.id));
  const totals = {}; // debtorId -> paise
  for (const s of state.mySplits) {
    if (!myExpIds.has(s.expense_id) || s.status !== 'pending' || s.debtor_id === uid) continue;
    totals[s.debtor_id] = (totals[s.debtor_id] || 0) + Math.round(Number(s.share_amount) * 100);
  }
  const byDebtor = Object.entries(totals).map(([debtorId, paise]) => ({ debtorId, amount: paise / 100 }));
  const total = byDebtor.reduce((s, x) => s + x.amount, 0);
  return { byDebtor, total };
}

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
      pay: exp.pay || null,
      date: exp.spent_on,
      // Sortable timestamp: when the expense was recorded (falls back to the date).
      ts: exp.created_at ? new Date(exp.created_at).getTime() : new Date(exp.spent_on).getTime(),
      id: exp.id,
      groupExpId: exp.id, // stable id of the group_expenses row (for edit)
      canEdit: iPaid, // only the payer may edit
    };
    if (iPaid) {
      // Own share (always counts) + any not-yet-settled others' shares (still fronted).
      const myShare = rowsFor.find((s) => s.debtor_id === uid);
      const others = rowsFor.filter((s) => s.debtor_id !== uid);
      const othersPending = others.filter((s) => s.status !== 'done');
      const fronted = othersPending.reduce((sum, s) => sum + Number(s.share_amount), 0);
      const amt = (myShare ? Number(myShare.share_amount) : 0) + fronted;
      // Payer is owed money until everyone settles: show "awaiting N" then "settled".
      const badge =
        othersPending.length > 0
          ? { label: `awaiting ${othersPending.length}`, cls: 'shared-pending' }
          : others.length > 0
            ? { label: 'all settled', cls: 'shared-done' }
            : { label: 'you paid', cls: 'shared-neutral' };
      rows.push({ ...base, amt, pending: false, badge, meta: groupName(exp.group_id) });
    } else {
      const mine = rowsFor.find((s) => s.debtor_id === uid);
      if (!mine) continue; // not involved
      // Debtor's personal category/note; payment is ONLY their own settlement method
      // (never the payer's — that's private to the payer).
      const personal = { cat: mine.cat || base.cat, desc: mine.note || base.desc, pay: mine.pay || null };
      if (mine.status === 'pending') {
        rows.push({ ...base, ...personal, amt: -Number(mine.share_amount), pending: true, settleId: mine.id, badge: { label: 'you owe', cls: 'shared-pending' }, meta: groupName(exp.group_id) });
      } else {
        rows.push({ ...base, ...personal, amt: Number(mine.share_amount), pending: false, badge: { label: 'settled', cls: 'shared-done' }, meta: groupName(exp.group_id), editSplitId: mine.id });
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
