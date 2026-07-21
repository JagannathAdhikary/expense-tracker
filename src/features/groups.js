// Groups data layer + management sheet: create a group, join by invite code,
// list the user's groups and members, and load group expenses + splits.
// All functions are safe no-ops when cloud is not configured / user is logged out.

import { supabase, cloudEnabled } from '../supabase.js';
import { state } from '../state.js';
import { $ } from '../dom.js';

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
    notifyData();
    return;
  }

  // Groups I'm a member of. Filter to MY membership rows: RLS lets co-members see
  // each other, so an unfiltered select returns one row per member of each group
  // (which would make a group appear multiple times in the list).
  const { data: memberships, error: mErr } = await supabase.from('group_members').select('group_id, role, groups(id, name, invite_code)').eq('user_id', state.user.id);
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
  } else {
    state.groupExpenses = [];
    state.mySplits = [];
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
    alert('Could not create group: ' + error.message);
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
    alert('No group found with that code.');
    return null;
  }
  const { error: jErr } = await supabase.from('group_members').insert({ group_id: grp.id, user_id: state.user.id, role: 'member' });
  // Unique-violation = already a member; treat as success.
  if (jErr && jErr.code !== '23505') {
    alert('Could not join: ' + jErr.message);
    return null;
  }
  await loadCloudData();
  return grp;
}

// Create a group expense plus one split row per member. The payer's own share is
// recorded as 'done' immediately; everyone else's is 'pending' (the borrowed row).
// `shares` is [{userId, share}] from computeSplits and sums exactly to `amount`.
export async function saveGroupExpense({ groupId, amount, description, category, spentOn, splitMode, shares }) {
  if (!cloudEnabled() || !state.user) return false;
  const { data: exp, error } = await supabase
    .from('group_expenses')
    .insert({ group_id: groupId, payer_id: state.user.id, amount, description, category, spent_on: spentOn, split_mode: splitMode })
    .select()
    .single();
  if (error) {
    alert('Could not save group expense: ' + error.message);
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
    alert('Expense saved but splits failed: ' + sErr.message);
    return false;
  }
  await loadCloudData();
  return true;
}

// Edit a group expense (payer only). Updates the expense row and rebuilds its
// split rows from the new shares. Any share that changes resets to 'pending'
// (except the payer's own, which stays 'done'), so re-splitting re-collects.
export async function editGroupExpense({ expenseId, amount, description, category, spentOn, splitMode, shares }) {
  if (!cloudEnabled() || !state.user) return false;
  const { error: uErr } = await supabase
    .from('group_expenses')
    .update({ amount, description, category, spent_on: spentOn, split_mode: splitMode })
    .eq('id', expenseId)
    .eq('payer_id', state.user.id);
  if (uErr) {
    alert('Could not update group expense: ' + uErr.message);
    return false;
  }
  // Rebuild splits: delete existing, insert fresh (payer's share auto-done).
  await supabase.from('expense_splits').delete().eq('expense_id', expenseId);
  const rows = shares.map((s) => ({
    expense_id: expenseId,
    debtor_id: s.userId,
    share_amount: s.share,
    status: s.userId === state.user.id ? 'done' : 'pending',
    settled_at: s.userId === state.user.id ? new Date().toISOString() : null,
  }));
  const { error: sErr } = await supabase.from('expense_splits').insert(rows);
  if (sErr) {
    alert('Expense updated but splits failed: ' + sErr.message);
    return false;
  }
  await loadCloudData();
  return true;
}

// Delete a group expense (payer only). Cascade removes its splits.
export async function deleteGroupExpense(expenseId) {
  if (!cloudEnabled() || !state.user) return false;
  const { error } = await supabase.from('group_expenses').delete().eq('id', expenseId).eq('payer_id', state.user.id);
  if (error) {
    alert('Could not delete: ' + error.message);
    return false;
  }
  await loadCloudData();
  return true;
}

// Mark the current user's own split as settled ('done').
export async function markShareDone(splitId) {
  if (!cloudEnabled() || !state.user) return;
  const { error } = await supabase.from('expense_splits').update({ status: 'done', settled_at: new Date().toISOString() }).eq('id', splitId).eq('debtor_id', state.user.id);
  if (error) {
    alert('Could not update: ' + error.message);
    return;
  }
  await loadCloudData();
}

// Settle ALL of the current user's pending shares owed to one payer within a group,
// in a single update (e.g. B clears the ₹20 + ₹30 owed to A at once).
export async function settleWithPayer(groupId, payerId) {
  if (!cloudEnabled() || !state.user) return;
  // Expenses in this group paid by that person.
  const expIds = state.groupExpenses.filter((e) => e.group_id === groupId && e.payer_id === payerId).map((e) => e.id);
  if (!expIds.length) return;
  // My pending split ids across those expenses.
  const splitIds = state.mySplits.filter((s) => s.debtor_id === state.user.id && s.status === 'pending' && expIds.includes(s.expense_id)).map((s) => s.id);
  if (!splitIds.length) return;
  const { error } = await supabase.from('expense_splits').update({ status: 'done', settled_at: new Date().toISOString() }).in('id', splitIds).eq('debtor_id', state.user.id);
  if (error) {
    alert('Could not settle: ' + error.message);
    return;
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

  $('grpCreateBtn').onclick = async () => {
    const name = $('grpNameInput').value.trim();
    if (!name) {
      $('grpNameInput').focus();
      return;
    }
    const grp = await createGroup(name);
    if (grp) {
      $('grpNameInput').value = '';
    }
  };

  $('grpJoinBtn').onclick = async () => {
    const code = $('grpCodeInput').value.trim();
    if (!code) {
      $('grpCodeInput').focus();
      return;
    }
    const grp = await joinGroupByCode(code);
    if (grp) $('grpCodeInput').value = '';
  };
}
