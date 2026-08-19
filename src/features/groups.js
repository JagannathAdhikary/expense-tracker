// Groups data layer + management sheet: create a group, join by invite code,
// list the user's groups and members, and load group expenses + splits.
// All functions are safe no-ops when cloud is not configured / user is logged out.

import { supabase, cloudEnabled } from '../supabase.js';
import { state } from '../state.js';
import { $ } from '../dom.js';
import { toastError, toastSuccess, toastInfo } from '../toast.js';
import { netBetween } from '../split.js';
import { fmt } from '../format.js';

// Callbacks fired after cloud data (groups/expenses/splits) is (re)loaded.
const dataListeners = [];
export const onGroupData = (fn) => dataListeners.push(fn);
const notifyData = () => dataListeners.forEach((fn) => fn());

// Fire-and-forget Web Push to a group's other members via the notify-group Edge
// Function. Best-effort: a failure (offline, push not configured, function down)
// must never block or fail the mutation that triggered it — hence the .catch().
// `opts` may carry { expId, title, recipientIds } (see the function's header).
//
// Direct-split containers (g.direct) are hidden plumbing, not real groups, so their
// lifecycle events (create/rename/delete) would be meaningless noise — those are
// suppressed by the callers. Expense/settle events on a direct split DO notify (the
// other person genuinely needs to know about the money).
function notifyGroup(type, groupId, body, opts = {}) {
  if (!cloudEnabled() || !state.user || !groupId || !body) return;
  const payload = { type, groupId, body };
  if (opts.expId) payload.expId = opts.expId;
  if (opts.title) payload.title = opts.title;
  if (opts.recipientIds) payload.recipientIds = opts.recipientIds;
  supabase.functions.invoke('notify-group', { body: payload }).catch((e) => console.warn('notify-group invoke failed', e));
}

// The current user's display name for notification bodies ("You" is never right for
// the OTHER members reading it).
const meName = () => state.user?.name || 'Someone';
// A group's stored name for a body string (falls back gracefully).
const grpName = (groupId) => state.groups.find((g) => g.id === groupId)?.name || 'a group';
// Whether a group is a hidden direct-split container (suppress lifecycle pushes).
const isDirectGroup = (groupId) => !!state.groups.find((g) => g.id === groupId)?.direct;

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
  const { data: memberships, error: mErr } = await supabase.from('group_members').select('group_id, role, groups(id, name, invite_code, icon, color, retired_at, photo_url, simplify_debts, is_direct)').eq('user_id', state.user.id);
  if (mErr) {
    console.error('load groups failed', mErr);
    return;
  }
  const groupIds = memberships.map((m) => m.group_id);

  // Members of those groups, joined to profiles for display.
  let membersByGroup = {};
  if (groupIds.length) {
    const { data: mem } = await supabase.from('group_members').select('group_id, user_id, profiles(id, display_name, avatar_url, upi_id, phone)').in('group_id', groupIds);
    (mem || []).forEach((row) => {
      (membersByGroup[row.group_id] ||= []).push({
        id: row.user_id,
        name: row.profiles?.display_name || 'Member',
        avatar: row.profiles?.avatar_url || null,
        upi: row.profiles?.upi_id || null,
        phone: row.profiles?.phone || null,
      });
    });
  }

  state.groups = memberships.map((m) => ({
    id: m.groups.id,
    name: m.groups.name,
    invite_code: m.groups.invite_code,
    icon: m.groups.icon || null,
    color: m.groups.color || null,
    photo: m.groups.photo_url || null,
    retired: !!m.groups.retired_at, // read-only when retired (no add / no settle)
    simplifyDebts: !!m.groups.simplify_debts, // group-wide: minimize number of repayments
    direct: !!m.groups.is_direct, // hidden direct-split container (not a real group)
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

export async function createGroup(name, memberIds = [], opts = {}) {
  if (!cloudEnabled() || !state.user) return null;
  const invite_code = makeInviteCode();
  const row = { name, invite_code, created_by: state.user.id };
  if (opts.icon) row.icon = opts.icon;
  if (opts.color) row.color = opts.color;
  if (opts.photoUrl) row.photo_url = opts.photoUrl;
  if (opts.isDirect) row.is_direct = true;
  const { data: grp, error } = await supabase.from('groups').insert(row).select().single();
  if (error) {
    toastError('Could not create group: ' + error.message);
    return null;
  }
  // Add the creator as owner FIRST (satisfies members_insert's `user_id = auth.uid()`),
  // then add friends in a second insert — by then is_group_member(group_id) is true for
  // the creator, so the "member may add others" branch of the policy passes. Doing both
  // in one multi-row insert fails the friend rows (the creator row isn't visible to the
  // policy check within the same statement).
  const { error: ownErr } = await supabase.from('group_members').insert({ group_id: grp.id, user_id: state.user.id, role: 'owner' });
  if (ownErr) {
    toastError('Could not create group: ' + ownErr.message);
    return null;
  }
  const friendRows = [];
  for (const uid of memberIds) {
    if (uid && uid !== state.user.id) friendRows.push({ group_id: grp.id, user_id: uid, role: 'member' });
  }
  if (friendRows.length) {
    const { error: mErr } = await supabase.from('group_members').insert(friendRows);
    if (mErr) toastError('Group created, but adding some members failed: ' + mErr.message);
  }
  await loadCloudData();
  // Tell the added members about the new group (real groups only — direct-split
  // containers are hidden plumbing). Server resolves recipients from group_members.
  if (!opts.isDirect) notifyGroup('group_create', grp.id, `${meName()} added you to “${name}”`, { title: name });
  return grp;
}

// Find (or create) the hidden "direct split" container for the current user + the
// given friends. Reuses an existing direct container whose member set is EXACTLY those
// users, so repeat splits with the same people don't spawn duplicates. Returns the
// container's group id, or null on failure. `friendIds` excludes the current user.
export async function findOrCreateDirectSplit(friendIds) {
  if (!cloudEnabled() || !state.user) return null;
  const uid = state.user.id;
  const wanted = new Set([uid, ...friendIds.filter((id) => id && id !== uid)]);
  // Reuse an existing direct container with the same exact membership.
  const existing = state.groups.find((g) => {
    if (!g.direct) return false;
    const ids = new Set((g.members || []).map((m) => m.id));
    return ids.size === wanted.size && [...wanted].every((id) => ids.has(id));
  });
  if (existing) return existing.id;
  // Store a neutral placeholder — a direct split's shown name is derived per-viewer
  // (each person sees the OTHER members) via groupDisplayName(), never this string.
  const grp = await createGroup('Direct split', friendIds, { isDirect: true });
  return grp ? grp.id : null;
}

// The name to SHOW for a group/direct split, from the current user's perspective.
// Real groups use their stored name. A direct split has no shared name (that would
// bake in one person's viewpoint), so we build it from the OTHER members: the first
// member's full name, plus "+N" for any beyond it. Plain-string form (for titles /
// aria); use directNameParts() where the "+N" must survive truncation.
export function groupDisplayName(g) {
  const p = directNameParts(g);
  return p.extra ? `${p.name} +${p.extra}` : p.name;
}

// Structured form: { name, extra } so callers can render a truncatable name span
// plus a fixed "+N" span (e.g. "Jagannath Ad… +2"). N is the TOTAL count of other
// members (so a 2-person split shows "B +1"; 3-person shows "B +2"). extra is 0 only
// for a non-direct group.
export function directNameParts(g) {
  if (!g) return { name: 'Group', extra: 0 };
  if (!g.direct) return { name: g.name, extra: 0 };
  const uid = state.user?.id;
  const others = (g.members || []).filter((m) => m.id !== uid).map((m) => m.name || 'Member');
  if (!others.length) return { name: 'Direct split', extra: 0 };
  return { name: others[0], extra: others.length };
}

// Look up a registered user by exact mobile number (via the SECURITY DEFINER RPC).
// Returns { id, name, avatar } or null. Used to add non-friends by number.
export async function findUserByPhone(phone) {
  if (!cloudEnabled() || !state.user) return null;
  const { data, error } = await supabase.rpc('find_user_by_phone', { p_phone: phone });
  if (error) {
    console.warn('find_user_by_phone failed', error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { id: row.id, name: row.display_name || 'Member', avatar: row.avatar_url || null } : null;
}

// Save a group's photo URL (any member). Clears icon so the photo takes over.
export async function setGroupPhoto(groupId, photoUrl) {
  if (!cloudEnabled() || !state.user) return false;
  const { error } = await supabase.from('groups').update({ photo_url: photoUrl }).eq('id', groupId);
  if (error) {
    toastError('Could not save group photo: ' + error.message);
    return false;
  }
  await loadCloudData();
  return true;
}

// Upload an image File to the group-icons storage bucket; returns its public URL
// (or null on failure). `key` is a stable-ish path (group id or a temp uuid).
export async function uploadGroupImage(file, key) {
  if (!cloudEnabled() || !state.user || !file) return null;
  const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const path = `${key}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('group-icons').upload(path, file, { upsert: true, contentType: file.type });
  if (error) {
    toastError('Could not upload image: ' + error.message);
    return null;
  }
  const { data } = supabase.storage.from('group-icons').getPublicUrl(path);
  return data?.publicUrl || null;
}

// Friends = people you already share any (non-retired or retired) group with.
// Deduped by id, excluding yourself and anyone already in `excludeGroupId`.
export function myFriends(excludeGroupId = null) {
  if (!state.user) return [];
  const inExcluded = new Set(
    excludeGroupId ? (state.groups.find((g) => g.id === excludeGroupId)?.members || []).map((m) => m.id) : [],
  );
  const byId = new Map();
  for (const g of state.groups) {
    for (const m of g.members || []) {
      if (m.id === state.user.id || inExcluded.has(m.id)) continue;
      if (!byId.has(m.id)) byId.set(m.id, { id: m.id, name: m.name, phone: m.phone || null, avatar: m.avatar || null });
    }
  }
  return [...byId.values()];
}

// Add an existing user (a friend) to a group. Allowed by RLS for any member.
export async function addMemberToGroup(groupId, userId) {
  if (!cloudEnabled() || !state.user) return false;
  const { error } = await supabase.from('group_members').insert({ group_id: groupId, user_id: userId, role: 'member' });
  if (error) {
    if (error.code === '23505') {
      toastInfo('Already in the group.');
    } else {
      toastError('Could not add member: ' + error.message);
      return false;
    }
  }
  await loadCloudData();
  // Notify the group that a member was added (skip hidden direct-split containers).
  if (!isDirectGroup(groupId)) {
    const added = state.groups.find((g) => g.id === groupId)?.members.find((m) => m.id === userId);
    const who = added?.name || 'a new member';
    notifyGroup('member_add', groupId, `${meName()} added ${who} to ${grpName(groupId)}`);
  }
  return true;
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
  notifyGroup('member_add', grp.id, `${meName()} joined ${grp.name}`, { title: grp.name });
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
  // Notify the group's other members (best-effort push; never blocks the save).
  notifyGroup('expense_add', groupId, `${meName()} added ${fmt(amount)} in ${grpName(groupId)}` + (description ? ` — ${description}` : ''), { expId: exp.id });
  // Refresh in the background so the form can close immediately; onGroupData
  // re-renders the list once the reload lands. Opposing debts net automatically
  // at read time (see netBetween in split.js) — no auto-settlement row needed.
  loadCloudData();
  // Return the new expense id so the caller can scroll/flash it in the list.
  return exp.id;
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
  const gid = existing?.group_id;
  if (gid) notifyGroup('expense_edit', gid, `${meName()} updated ${fmt(amount)} in ${grpName(gid)}` + (description ? ` — ${description}` : ''), { expId: expenseId });
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
  if (existing?.group_id) {
    const label = existing.description ? ` — ${existing.description}` : '';
    notifyGroup('expense_delete', existing.group_id, `${meName()} deleted ${fmt(existing.amount)} in ${grpName(existing.group_id)}${label}`);
  }
  await loadCloudData();
  return true;
}

// Set a group's cover (color scene) and optional icon. Any member may change these.
export async function setGroupIcon(groupId, { icon, color } = {}) {
  if (!cloudEnabled() || !state.user) return false;
  const patch = {};
  if (icon !== undefined) patch.icon = icon;
  if (color !== undefined) patch.color = color;
  const { error } = await supabase.from('groups').update(patch).eq('id', groupId);
  if (error) {
    toastError('Could not update group cover: ' + error.message);
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
  const wasDirect = isDirectGroup(groupId);
  await loadCloudData();
  if (!wasDirect) notifyGroup('group_rename', groupId, `${meName()} renamed the group to “${clean}”`, { title: clean });
  return true;
}

// Delete an entire group (creator/owner only). Cascades to members, expenses,
// and splits via ON DELETE CASCADE.
export async function deleteGroup(groupId) {
  if (!cloudEnabled() || !state.user) return false;
  // Capture members + name BEFORE deleting — group_members cascades away, so the
  // notify-group function can't re-read recipients for this event (see its header).
  const g = state.groups.find((x) => x.id === groupId);
  const wasDirect = !!g?.direct;
  const groupName = g?.name || 'a group';
  const recipientIds = (g?.members || []).map((m) => m.id).filter((id) => id !== state.user.id);
  const { error } = await supabase.from('groups').delete().eq('id', groupId).eq('created_by', state.user.id);
  if (error) {
    toastError('Could not delete group: ' + error.message);
    return false;
  }
  if (!wasDirect && recipientIds.length) {
    notifyGroup('group_delete', groupId, `${meName()} deleted the group “${groupName}”`, { title: groupName, recipientIds });
  }
  await loadCloudData();
  return true;
}

// Leave a group: remove only your own membership (RLS members_delete_self allows
// this). Other members and the group stay. The owner should delete/transfer instead.
export async function leaveGroup(groupId) {
  if (!cloudEnabled() || !state.user) return false;
  // Notify BEFORE removing self: once we're out of group_members the notify-group
  // membership check would reject us (403). Skip hidden direct-split containers.
  if (!isDirectGroup(groupId)) notifyGroup('member_leave', groupId, `${meName()} left ${grpName(groupId)}`);
  const { error } = await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', state.user.id);
  if (error) {
    toastError('Could not leave group: ' + error.message);
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

// Group-wide "simplify debts" toggle: minimizes the number of repayments needed to
// settle the group, and everyone in the group sees the same simplified payments
// (view + settle routing; no split rewrite). Any member may toggle it (groups_update
// RLS allows members). Stored on the group so it's consistent for all.
export async function setGroupSimplify(groupId, on) {
  if (!cloudEnabled() || !state.user) return false;
  const { error } = await supabase.from('groups').update({ simplify_debts: !!on }).eq('id', groupId);
  if (error) {
    toastError('Could not update simplify setting: ' + error.message);
    return false;
  }
  await loadCloudData();
  return true;
}

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
  if (exp?.group_id) {
    // A settle concerns only the creditor (the expense payer), not the whole group.
    notifyGroup('settle', exp.group_id, `${meName()} settled ${fmt(split.share_amount)} in ${grpName(exp.group_id)}`, { recipientIds: [exp.payer_id] });
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
  if (myShares.length || theirShares.length || absAmt > 0) {
    const other = state.groups.find((g) => g.id === groupId)?.members.find((m) => m.id === otherId);
    const withWho = other?.name ? ` with ${other.name}` : '';
    // Only the person settled with needs to know.
    notifyGroup('settle', groupId, `${meName()} settled up${withWho} in ${grpName(groupId)}`, { recipientIds: [otherId] });
  }
  await loadCloudData();
}

// Settle my ENTIRE net-debtor position in a group (used by the simplified view,
// where the "You owe" card shows one consolidated re-routed payment). Flips ALL of
// my still-pending shares to 'done' so my net becomes 0 — reconciles regardless of
// which member the payment was re-routed to. Records a `simplified` settlement row
// to `payeeId` (the displayed re-routed creditor) for history + the UPI target.
export async function settleAllMyDebts(groupId, payeeId, amount, pay = null) {
  if (!cloudEnabled() || !state.user) return;
  if (groupIsRetired(groupId)) {
    toastError('This group is retired — reactivate it to make changes.');
    return;
  }
  const uid = state.user.id;
  const expInGroup = state.groupExpenses.filter((e) => e.group_id === groupId);
  // Every expense someone else paid that I still owe a pending share on.
  const notMine = new Set(expInGroup.filter((e) => e.payer_id !== uid).map((e) => e.id));
  const myPending = state.mySplits.filter((s) => s.debtor_id === uid && s.status === 'pending' && notMine.has(s.expense_id));
  if (myPending.length) {
    const patch = { status: 'done', settled_at: new Date().toISOString() };
    if (pay) patch.pay = pay;
    const { error } = await supabase.from('expense_splits').update(patch).in('id', myPending.map((s) => s.id)).eq('debtor_id', uid);
    if (error) {
      toastError('Could not settle: ' + error.message);
      return;
    }
  }
  if (amount > 0 && payeeId) {
    await supabase.from('settlements').insert({ group_id: groupId, from_user: uid, to_user: payeeId, amount, kind: 'simplified', created_by: uid });
  }
  if (myPending.length || (amount > 0 && payeeId)) {
    // Simplified settle re-routes to a single creditor — notify just them.
    notifyGroup('settle', groupId, `${meName()} settled ${fmt(amount)} in ${grpName(groupId)}`, payeeId ? { recipientIds: [payeeId] } : {});
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, scheduleReload)
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

  // "Create group" opens the full-screen New Group page (handled by the view).
  $('grpCreateBtn').onclick = () => {
    document.dispatchEvent(new CustomEvent('open-new-group'));
  };
}
