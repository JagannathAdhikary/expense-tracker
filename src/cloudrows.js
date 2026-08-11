// Build "shared" list rows from cloud group data for the signed-in user, shaped so
// the existing date-grouped renderer can display them and their signed amounts sum
// to the user's effective group spend (matching netForUser in split.js).
//
// Row rules for the current user U:
//  - Expense U paid: one positive row for U's own share only (not the money U
//    fronted for others — that lives in the group's "Owed to you" view).
//  - Expense U did NOT pay, U's split pending: a negative "-share" borrowed row,
//    excluded from the total until settled.
//  - Expense U did NOT pay, U's split done: a positive row (U's real, settled cost).
//
// Each row carries { shared:true, pending, amt, cat, desc, meta, date, settleId }.

import { state } from './state.js';
import { netBetween, simplifiedForUser } from './split.js';

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

// Net balances between the current user and each other group member, after
// pairwise netting (debts in both directions cancel) and applied settlements.
// Returns per-other-member signed nets; callers split them into owe / owed-to.
function netsForGroup(groupId) {
  if (!state.user) return [];
  const uid = state.user.id;
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return [];
  const exps = state.groupExpenses.filter((e) => e.group_id === groupId);
  const others = (group.members || []).filter((m) => m.id !== uid);
  return others.map((m) => ({
    otherId: m.id,
    // > 0 => I owe them; < 0 => they owe me.
    net: netBetween(exps, state.mySplits, uid, m.id),
  }));
}

// The current user's simplified view for a group (when simplify is on): re-routes
// balances group-wide, then keeps only transfers touching the user.
function simplifiedView(groupId) {
  const uid = state.user.id;
  const group = state.groups.find((g) => g.id === groupId);
  const exps = state.groupExpenses.filter((e) => e.group_id === groupId);
  const memberIds = (group.members || []).map((m) => m.id);
  return simplifiedForUser(exps, state.mySplits, memberIds, uid);
}

// What the current user owes within a group, netted per creditor.
// Returns { byPayer: [{payerId, amount}], total } — only pairs where I owe (net > 0).
export function owedByUserInGroup(groupId) {
  if (!state.user) return { byPayer: [], total: 0 };
  const group = state.groups.find((g) => g.id === groupId);
  if (group?.simplifyDebts) {
    const byPayer = simplifiedView(groupId).owe.map((t) => ({ payerId: t.toId, amount: t.amount }));
    return { byPayer, total: byPayer.reduce((s, x) => s + x.amount, 0) };
  }
  const nets = netsForGroup(groupId).filter((n) => n.net > 0);
  const byPayer = nets.map((n) => ({ payerId: n.otherId, amount: n.net }));
  const total = byPayer.reduce((s, x) => s + x.amount, 0);
  return { byPayer, total };
}

// What others owe the current user within a group, netted per debtor.
// Returns { byDebtor: [{debtorId, amount}], total } — only pairs where I'm owed (net < 0).
export function owedToUserInGroup(groupId) {
  if (!state.user) return { byDebtor: [], total: 0 };
  const group = state.groups.find((g) => g.id === groupId);
  if (group?.simplifyDebts) {
    const byDebtor = simplifiedView(groupId).owed.map((t) => ({ debtorId: t.fromId, amount: t.amount }));
    return { byDebtor, total: byDebtor.reduce((s, x) => s + x.amount, 0) };
  }
  const nets = netsForGroup(groupId).filter((n) => n.net < 0);
  const byDebtor = nets.map((n) => ({ debtorId: n.otherId, amount: -n.net }));
  const total = byDebtor.reduce((s, x) => s + x.amount, 0);
  return { byDebtor, total };
}

// Signed net between the current user and one other member (rupees):
// > 0 => you owe them; < 0 => they owe you; 0 => settled. Used by the detail view
// to decide whether to show per-expense settle chips.
export function netWithMember(groupId, otherId) {
  if (!state.user) return 0;
  const exps = state.groupExpenses.filter((e) => e.group_id === groupId);
  return netBetween(exps, state.mySplits, state.user.id, otherId);
}

// The current user's total share of a group: the sum of every split of theirs
// across the group's expenses, regardless of settle status — their part of what
// they spent (shares on expenses they paid) plus everything they owe/have settled
// on others' expenses. This is the true cost of participating in the group.
export function totalShareInGroup(groupId) {
  if (!state.user) return 0;
  const uid = state.user.id;
  const expIds = new Set(state.groupExpenses.filter((e) => e.group_id === groupId).map((e) => e.id));
  return state.mySplits
    .filter((s) => s.debtor_id === uid && expIds.has(s.expense_id))
    .reduce((sum, s) => sum + Number(s.share_amount), 0);
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
    // Deletable only by the payer, and only while no one has settled a share yet.
    const anySettled = rowsFor.some((s) => s.debtor_id !== exp.payer_id && s.status === 'done');
    const base = {
      shared: true,
      cat: exp.category || 'Other',
      desc: exp.description || 'Group expense',
      pay: exp.pay || null,
      date: exp.spent_on,
      // Sortable timestamp: when the expense was recorded (falls back to the date).
      ts: exp.created_at ? new Date(exp.created_at).getTime() : new Date(exp.spent_on).getTime(),
      id: exp.id,
      groupId: exp.group_id, // group this expense belongs to (for navigation)
      groupExpId: exp.id, // stable id of the group_expenses row (for edit)
      canEdit: iPaid, // only the payer may edit
      canDelete: iPaid && !anySettled, // payer, and only before anyone settles
    };
    if (iPaid) {
      // The payer sees only THEIR own share from the start — not the money they
      // fronted for others. Others' shares surface separately in the group's
      // "Owed to you" view and settle back to the payer directly.
      const myShare = rowsFor.find((s) => s.debtor_id === uid);
      const others = rowsFor.filter((s) => s.debtor_id !== uid);
      const othersPending = others.filter((s) => s.status !== 'done');
      const amt = myShare ? Number(myShare.share_amount) : 0;
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
