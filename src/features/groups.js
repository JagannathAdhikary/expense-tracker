// Groups data layer + management sheet: create a group, join by invite code,
// list the user's groups and members, and load group expenses + splits.
// All functions are safe no-ops when cloud is not configured / user is logged out.

import { supabase, cloudEnabled } from '../supabase.js';
import { state } from '../state.js';
import { $ } from '../dom.js';
import { toastError, toastSuccess, toastInfo } from '../toast.js';
import { netBetween } from '../split.js';

// Callbacks fired after cloud data (groups/expenses/splits) is (re)loaded.
const dataListeners = [];
export const onGroupData = (fn) => dataListeners.push(fn);
const notifyData = () => dataListeners.forEach((fn) => fn());

// Short, human-friendly invite code (no ambiguous chars). Not security-sensitive
// beyond acting as a shared secret handle.
function makeInviteCode(len = 6) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  const rnd = new Uint32Array(len);
  crypto.getRandomValues(rnd);
  for (let i = 0; i < len; i++) out += alphabet[rnd[i] % alphabet.length];
  return out;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

// Load everything the signed-in user can see: their groups (+ members), the
// expenses in those groups, and all splits for those expenses. Populates state.
export async function loadCloudData() {
  if (!cloudEnabled() || !state.user) {
    state.groups = [];
    state.groupExpenses = [];
    state.mySplits = [];
    state.settlements = [];
    notifyData();
    return;
  }

  // Groups I'm a member of. Filter to MY membership rows: RLS lets co-members see
  // each other, so an unfiltered select returns one row per member of each group
  // (which would make a group appear multiple times in the list).
  const { data: memberships, error: mErr } = await supabase.from('group_members').select('group_id, role, groups(id, name, invite_code, icon, color, retired_at)').eq('user_id', state.user.id);
  if (mErr) {
    console.error('load groups failed', mErr);
    return;
  }
  const groupIds = memberships.map((m) => m.group_id);

  // Members of those groups, joined to profiles for display.
  let membersByGroup = {};
  if (groupIds.length) {
    const { data: mem } = await supabase.from('group_members').select('group_id, user_id, profiles(id, display_name, avatar_url)').in('group_id', groupIds);
    (mem || []).forEach((row) => {
      (membersByGroup[row.group_id] ||= []).push({
        id: row.user_id,
        name: row.profiles?.display_name || 'Member',
        avatar: row.profiles?.avatar_url || null,
      });
    });
  }

  state.groups = memberships.map((m) => ({
    id: m.groups.id,
    name: m.groups.name,
    invite_code: m.groups.invite_code,
    icon: m.groups.icon || null,
    color: m.groups.color || null,
    retired: !!m.groups.retired_at, // read-only when retired (no add / no settle)
    role: m.role,
    members: membersByGroup[m.group_id] || [],
  }));

  // Expenses in those groups + their splits.
  if (groupIds.length) {
    const { data: exps } = await supabase.from('group_expenses').select('*').in('group_id', groupIds).order('spent_on', { ascending: false });
    state.groupExpenses = exps || [];
    const expIds = state.groupExpenses.map((e) => e.id);
    if (expIds.length) {
      const { data: splits } = await supabase.from('expense_splits').select('*').in('expense_id', expIds);
      state.mySplits = splits || [];
    } else {
      state.mySplits = [];
    }
    const { data: setts } = await supabase.from('settlements').select('*').in('group_id', groupIds);
    state.settlements = setts || [];
  } else {
    state.groupExpenses = [];
    state.mySplits = [];
    state.settlements = [];
  }

  notifyData();
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createGroup(name) {
  if (!cloudEnabled() || !state.user) return null;
  const invite_code = makeInviteCode();
  const { data: grp, error } = await supabase.from('groups').insert({ name, invite_code, created_by: state.user.id }).select().single();
  if (error) {
    toastError('Could not create group: ' + error.message);
    return null;
  }
  // Add the creator as owner.
  await supabase.from('group_members').insert({ group_id: grp.id, user_id: state.user.id, role: 'owner' });
  await loadCloudData();
  return grp;
}

export async function joinGroupByCode(code) {
  if (!cloudEnabled() || !state.user) return null;
  const { data: grp, error } = await supabase.from('groups').select('id, name').eq('invite_code', code.trim().toUpperCase()).maybeSingle();
  if (error || !grp) {
    toastError('No group found with that code.');
    return null;
  }
  // Already a member? Tell them, don't silently "join" again.
  if (state.groups.some((g) => g.id === grp.id)) {
    toastInfo(`You're already in "${grp.name}".`);
    return null;
  }
  const { error: jErr } = await supabase.from('group_members').insert({ group_id: grp.id, user_id: state.user.id, role: 'member' });
  if (jErr) {
    // Unique-violation = already a member (race / stale state).
    if (jErr.code === '23505') {
      toastInfo(`You're already in "${grp.name}".`);
      await loadCloudData();
      return null;
    }
    toastError('Could not join: ' + jErr.message);
    return null;
  }
  toastSuccess(`Joined "${grp.name}".`);
  await loadCloudData();
  return grp;
}

// Create a group expense plus one split row per member. The payer's own share is
// recorded as 'done' immediately; everyone else's is 'pending' (the borrowed row).
// `shares` is [{userId, share}] from computeSplits and sums exactly to `amount`.
export async function saveGroupExpense({ groupId, amount, description, category, pay, spentOn, splitMode, shares }) {
  if (!cloudEnabled() || !state.user) return false;
  if (groupIsRetired(groupId)) {
    toastError('This group is retired — reactivate it to make changes.');
    return false;
  }
  const { data: exp, error } = await supabase
    .from('group_expenses')
    .insert({ group_id: groupId, payer_id: state.user.id, amount, description, category, pay, spent_on: spentOn, split_mode: splitMode })
    .select()
    .single();
  if (error) {
    toastError('Could not save group expense: ' + error.message);
    return false;
  }
  const rows = shares.map((s) => ({
    expense_id: exp.id,
    debtor_id: s.userId,
    share_amount: s.share,
    status: s.userId === state.user.id ? 'done' : 'pending',
    settled_at: s.userId === state.user.id ? new Date().toISOString() : null,
  }));
  const { error: sErr } = await supabase.from('expense_splits').insert(rows);
  if (sErr) {
    toastError('Expense saved but splits failed: ' + sErr.message);
    return false;
  }
  // Refresh in the background so the form can close immediately; onGroupData
  // re-renders the list once the reload lands. Opposing debts net automatically
  // at read time (see netBetween in split.js) — no auto-settlement row needed.
  loadCloudData();
  return true;
}

// Edit a group expense (payer only). Updates the expense row and rebuilds its
// split rows from the new shares. Any share that changes resets to 'pending'
// (except the payer's own, which stays 'done'), so re-splitting re-collects.
export async function editGroupExpense({ expenseId, amount, description, category, pay, spentOn, splitMode, shares }) {
  if (!cloudEnabled() || !state.user) return false;
  const existing = state.groupExpenses.find((e) => e.id === expenseId);
  if (existing && groupIsRetired(existing.group_id)) {
    toastError('This group is retired — reactivate it to make changes.');
    return false;
  }
  const { error: uErr } = await supabase
    .from('group_expenses')
    .update({ amount, description, category, pay, spent_on: spentOn, split_mode: splitMode })
    .eq('id', expenseId)
    .eq('payer_id', state.user.id);
  if (uErr) {
    toastError('Could not update group expense: ' + uErr.message);
    return false;
  }
  // Rebuild splits: delete existing, insert fresh (payer's share auto-done).
  // Requires the splits_delete RLS policy (payer may delete their expense's splits).
  const { error: dErr } = await supabase.from('expense_splits').delete().eq('expense_id', expenseId);
  if (dErr) {
    toastError('Could not update splits: ' + dErr.message);
    return false;
  }
  const rows = shares.map((s) => ({
    expense_id: expenseId,
    debtor_id: s.userId,
    share_amount: s.share,
    status: s.userId === state.user.id ? 'done' : 'pending',
    settled_at: s.userId === state.user.id ? new Date().toISOString() : null,
  }));
  const { error: sErr } = await supabase.from('expense_splits').insert(rows);
  if (sErr) {
    toastError('Expense updated but splits failed: ' + sErr.message);
    return false;
  }
  loadCloudData(); // background refresh; form closes immediately
  return true;
}

// Label-only edit of a group expense (payer): updates category / payment / note
// (description) WITHOUT touching amount or splits. Used when the group is retired
// (read-only balances) but the payer still wants to re-categorize their expense.
export async function updateGroupExpenseMeta({ expenseId, description, category, pay }) {
  if (!cloudEnabled() || !state.user) return false;
  const { error } = await supabase
    .from('group_expenses')
    .update({ description, category, pay })
    .eq('id', expenseId)
    .eq('payer_id', state.user.id);
  if (error) {
    toastError('Could not save your changes: ' + error.message);
    return false;
  }
  await loadCloudData();
  return true;
}

// Delete a group expense (payer only). Cascade removes its splits. Netting is
// computed live from pending shares, so removing the expense reverts the net
// automatically — no settlement rows to unwind. Manual settle-up rows are
// independent of any expense and are left intact.
export async function deleteGroupExpense(expenseId) {
  if (!cloudEnabled() || !state.user) return false;
  const existing = state.groupExpenses.find((e) => e.id === expenseId);
  if (existing && groupIsRetired(existing.group_id)) {
    toastError('This group is retired — reactivate it to make changes.');
    return false;
  }
  const { error } = await supabase.from('group_expenses').delete().eq('id', expenseId).eq('payer_id', state.user.id);
  if (error) {
    toastError('Could not delete: ' + error.message);
    return false;
  }
  await loadCloudData();
  return true;
}

// Set a group's icon (emoji) and color tile. Any member may change these.
export async function setGroupIcon(groupId, { icon, color }) {
  if (!cloudEnabled() || !state.user) return false;
  const { error } = await supabase.from('groups').update({ icon, color }).eq('id', groupId);
  if (error) {
    toastError('Could not update group icon: ' + error.message);
    return false;
  }
  await loadCloudData();
  return true;
}

// Rename a group (any member — RLS groups_update allows members). Trims + caps
// length; no-ops on an empty name.
export async function renameGroup(groupId, name) {
  if (!cloudEnabled() || !state.user) return false;
  const clean = (name || '').trim().slice(0, 40);
  if (!clean) {
    toastError('Group name can’t be empty.');
    return false;
  }
  const { error } = await supabase.from('groups').update({ name: clean }).eq('id', groupId);
  if (error) {
    toastError('Could not rename group: ' + error.message);
    return false;
  }
  await loadCloudData();
  return true;
}

// Delete an entire group (creator/owner only). Cascades to members, expenses,
// and splits via ON DELETE CASCADE.
export async function deleteGroup(groupId) {
  if (!cloudEnabled() || !state.user) return false;
  const { error } = await supabase.from('groups').delete().eq('id', groupId).eq('created_by', state.user.id);
  if (error) {
    toastError('Could not delete group: ' + error.message);
    return false;
  }
  await loadCloudData();
  return true;
}

// Retire (archive) or reactivate a group — owner only. A retired group is
// read-only: no new expenses and no settling until it's reactivated. Sets
// retired_at to now() / null. Scoped to the creator to enforce owner-only.
export async function setGroupRetired(groupId, retired) {
  if (!cloudEnabled() || !state.user) return false;
  const retired_at = retired ? new Date().toISOString() : null;
  const { error } = await supabase.from('groups').update({ retired_at }).eq('id', groupId).eq('created_by', state.user.id);
  if (error) {
    toastError(`Could not ${retired ? 'retire' : 'reactivate'} group: ` + error.message);
    return false;
  }
  await loadCloudData();
  return true;
}

// True when the given group is retired (read-only). Used to block mutations.
const groupIsRetired = (groupId) => state.groups.some((g) => g.id === groupId && g.retired);

// Public predicate for views (e.g. to route to a label-only edit when retired).
export const isGroupRetired = (groupId) => groupIsRetired(groupId);

// Update the current user's personal labels (category / payment / note) on their
// own split of a group expense. Does not affect other members or the shared row.
export async function updateMySplitMeta(splitId, { cat, pay, note }) {
  if (!cloudEnabled() || !state.user) return false;
  const { error } = await supabase.from('expense_splits').update({ cat, pay, note }).eq('id', splitId).eq('debtor_id', state.user.id);
  if (error) {
    toastError('Could not save your changes: ' + error.message);
    return false;
  }
  await loadCloudData();
  return true;
}

// Mark the current user's own split as settled ('done'), optionally recording the
// payment method they used to pay it back (their own, private to them).
export async function markShareDone(splitId, pay = null) {
  if (!cloudEnabled() || !state.user) return;
  // Block settling in a retired (read-only) group. Resolve the group via the
  // split's expense: split → group_expenses.group_id.
  const split = state.mySplits.find((s) => s.id === splitId);
  const exp = split && state.groupExpenses.find((e) => e.id === split.expense_id);
  if (exp && groupIsRetired(exp.group_id)) {
    toastError('This group is retired — reactivate it to make changes.');
    return;
  }
  const patch = { status: 'done', settled_at: new Date().toISOString() };
  if (pay) patch.pay = pay;
  const { error } = await supabase.from('expense_splits').update(patch).eq('id', splitId).eq('debtor_id', state.user.id);
  if (error) {
    toastError('Could not update: ' + error.message);
    return;
  }
  await loadCloudData();
}

// Settle up with another member across BOTH directions in one action: flip every
// pending share between the two of us (mine owed to them, and theirs owed to me on
// expenses I paid) to 'done', and record a manual settlement row for history.
// The net between us becomes 0. Idempotent (only touches 'pending' rows).
export async function settleUpWithMember(groupId, otherId, pay = null) {
  if (!cloudEnabled() || !state.user) return;
  if (groupIsRetired(groupId)) {
    toastError('This group is retired — reactivate it to make changes.');
    return;
  }
  const uid = state.user.id;
  const expInGroup = state.groupExpenses.filter((e) => e.group_id === groupId);
  const theyPaid = new Set(expInGroup.filter((e) => e.payer_id === otherId).map((e) => e.id));
  const iPaid = new Set(expInGroup.filter((e) => e.payer_id === uid).map((e) => e.id));

  // My pending shares owed to them (their expenses) + their pending shares owed
  // to me (my expenses). I'm allowed to update both: mine as debtor, theirs as payer.
  const myShares = state.mySplits.filter((s) => s.debtor_id === uid && s.status === 'pending' && theyPaid.has(s.expense_id));
  const theirShares = state.mySplits.filter((s) => s.debtor_id === otherId && s.status === 'pending' && iPaid.has(s.expense_id));

  const now = new Date().toISOString();
  // My own shares may carry my payment method; their shares must not (private).
  if (myShares.length) {
    const patch = { status: 'done', settled_at: now };
    if (pay) patch.pay = pay;
    const { error } = await supabase.from('expense_splits').update(patch).in('id', myShares.map((s) => s.id)).eq('debtor_id', uid);
    if (error) {
      toastError('Could not settle: ' + error.message);
      return;
    }
  }
  if (theirShares.length) {
    const { error } = await supabase.from('expense_splits').update({ status: 'done', settled_at: now }).in('id', theirShares.map((s) => s.id));
    if (error) {
      toastError('Could not settle: ' + error.message);
      return;
    }
  }

  // Record a manual settlement for history in whichever direction had a net debt.
  const net = netBetween(expInGroup, state.mySplits, uid, otherId); // >0 I owe them
  const absAmt = Math.abs(net);
  if (absAmt > 0) {
    const from_user = net > 0 ? uid : otherId;
    const to_user = net > 0 ? otherId : uid;
    await supabase.from('settlements').insert({ group_id: groupId, from_user, to_user, amount: absAmt, kind: 'manual', created_by: uid });
  }
  await loadCloudData();
}

// ---------------------------------------------------------------------------
// Realtime: reload cloud data when group expenses / splits change (e.g. another
// member marks their share done). Debounced so a burst of row changes = one reload.
// ---------------------------------------------------------------------------
let rtChannel = null;
let reloadTimer = null;

export function subscribeRealtime() {
  if (!cloudEnabled() || !state.user || rtChannel) return;
  const scheduleReload = () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => loadCloudData(), 300);
  };
  rtChannel = supabase
    .channel('group-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_expenses' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_splits' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, scheduleReload)
    .subscribe();
}

export function unsubscribeRealtime() {
  if (rtChannel) {
    supabase.removeChannel(rtChannel);
    rtChannel = null;
  }
}

// ---------------------------------------------------------------------------
// Manage sheet (create / join). Mirrors the category/payment manage sheets.
// ---------------------------------------------------------------------------

export function initGroupsFeature() {
  const createBtn = $('grpCreateBtn');
  if (!createBtn) return; // markup not present

  // Run an async button action with a busy state (disabled + label) to prevent
  // accidental double-submits during the network round-trip.
  const withBusy = async (btn, busyLabel, fn) => {
    if (btn.disabled) return;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = busyLabel;
    try {
      await fn();
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  };

  $('grpCreateBtn').onclick = () =>
    withBusy($('grpCreateBtn'), 'Creating…', async () => {
      const name = $('grpNameInput').value.trim();
      if (!name) {
        $('grpNameInput').focus();
        return;
      }
      const grp = await createGroup(name);
      if (grp) $('grpNameInput').value = '';
    });

  $('grpJoinBtn').onclick = () =>
    withBusy($('grpJoinBtn'), 'Joining…', async () => {
      const code = $('grpCodeInput').value.trim();
      if (!code) {
        $('grpCodeInput').focus();
        return;
      }
      const grp = await joinGroupByCode(code);
      if (grp) $('grpCodeInput').value = '';
    });
}
