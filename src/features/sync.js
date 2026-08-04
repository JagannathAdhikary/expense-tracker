// Personal-expense cloud sync (optional, per-user, two-way, last-write-wins).
//
// Local records remain the working copy in localStorage. When PREFS.cloudSync is
// on and the user is signed in:
//   - every local write (add/edit/delete) is pushed to personal_expenses
//   - on login we pull the cloud copy and merge by id, newest updated_at wins
//   - deletes are tombstones (deleted=true) so they propagate across devices
//
// Records carry an `updated` (ms) field; older records without it are treated as
// timestamp 0 so any cloud/edited copy wins. Deleted locals become {deleted:true}.

import { supabase, cloudEnabled } from '../supabase.js';
import { state } from '../state.js';
import { persist, persistPrefs } from '../storage.js';
import { $ } from '../dom.js';
import { toastError } from '../toast.js';
import { confirmModal } from '../confirm.js';

export const syncOn = () => cloudEnabled() && !!state.user && !!state.PREFS.cloudSync;

// --- Server-authoritative sync flag (profiles.sync_enabled) ---------------
// The sync preference lives on the user's profile row so every device honors the
// same choice: turning it off on one device turns it off everywhere. Local
// PREFS.cloudSync is a per-device cache of this, refreshed on login.

// Read the user's server-side sync flag. Defaults to false on error/missing.
async function fetchSyncFlag() {
  if (!cloudEnabled() || !state.user) return false;
  const { data, error } = await supabase.from('profiles').select('sync_enabled').eq('id', state.user.id).maybeSingle();
  if (error) {
    console.error('read sync flag failed', error);
    return false;
  }
  return !!data?.sync_enabled;
}

// Write the user's server-side sync flag. Returns true on success.
async function setSyncFlag(enabled) {
  if (!cloudEnabled() || !state.user) return false;
  const { error } = await supabase.from('profiles').update({ sync_enabled: enabled }).eq('id', state.user.id);
  if (error) {
    console.error('write sync flag failed', error);
    return false;
  }
  return true;
}

// Map a local record to a cloud row.
const toRow = (r) => ({
  user_id: state.user.id,
  id: r.id,
  amt: r.amt,
  cat: r.cat,
  pay: r.pay || null,
  descr: r.desc || null,
  spent_on: r.date,
  deleted: !!r.deleted,
  updated_at: r.updated || Date.now(),
});

// Map a cloud row back to a local record.
const toRec = (row) => ({
  id: Number(row.id),
  amt: Number(row.amt),
  cat: row.cat,
  pay: row.pay || undefined,
  desc: row.descr || '',
  date: row.spent_on,
  updated: Number(row.updated_at),
  deleted: row.deleted || undefined,
});

// Push a single record (upsert) when sync is on. Fire-and-forget; failures are
// non-fatal (local remains the source of truth).
export async function pushRecord(rec) {
  if (!syncOn()) return;
  const { error } = await supabase.from('personal_expenses').upsert(toRow(rec), { onConflict: 'user_id,id' });
  if (error) console.error('sync push failed', error);
}

// Upload ALL current local records (used by the first-login prompt / enabling sync).
export async function uploadAll() {
  if (!cloudEnabled() || !state.user) return false;
  const rows = state.recs.map(toRow);
  if (!rows.length) return true;
  const { error } = await supabase.from('personal_expenses').upsert(rows, { onConflict: 'user_id,id' });
  if (error) {
    console.error('sync upload failed', error);
    // The personal_expenses table missing means the latest schema.sql hasn't been run.
    if (error.message && /personal_expenses/.test(error.message) && /schema cache|does not exist|find the table/i.test(error.message)) {
      toastError('Cloud sync needs a database update. Run the latest supabase/schema.sql in your Supabase SQL editor, then try again.');
    } else {
      toastError('Could not upload expenses: ' + error.message);
    }
    return false;
  }
  return true;
}

// Pull cloud rows and merge into local by id (last-write-wins on updated_at).
// Applies tombstones (removes locally-deleted-in-cloud), then persists locally
// and pushes back any local rows that were newer/missing in the cloud.
export async function pullAndMerge() {
  if (!syncOn()) return;
  const { data, error } = await supabase.from('personal_expenses').select('*').eq('user_id', state.user.id);
  if (error) {
    console.error('sync pull failed', error);
    return;
  }

  const localById = new Map(state.recs.map((r) => [r.id, r]));
  const toPushBack = [];

  for (const row of data) {
    const remote = toRec(row);
    const local = localById.get(remote.id);
    if (!local) {
      // New from cloud (skip if it's a tombstone we never had).
      if (!remote.deleted) localById.set(remote.id, remote);
    } else {
      const lt = local.updated || 0;
      const rt = remote.updated || 0;
      if (rt >= lt) {
        localById.set(remote.id, remote); // cloud wins (incl. tombstone)
      } else {
        toPushBack.push(local); // local newer -> push back later
      }
    }
  }

  // Local rows the cloud has never seen -> push them up.
  const remoteIds = new Set(data.map((r) => Number(r.id)));
  for (const r of state.recs) if (!remoteIds.has(r.id)) toPushBack.push(r);

  // Materialize merged local state, dropping tombstones from the working list.
  state.recs = [...localById.values()].filter((r) => !r.deleted);
  persist();

  if (toPushBack.length) {
    const { error: upErr } = await supabase.from('personal_expenses').upsert(toPushBack.map(toRow), { onConflict: 'user_id,id' });
    if (upErr) console.error('sync push-back failed', upErr);
  }
}

// ---------------------------------------------------------------------------
// UI: sync toggle in the menu + one-time first-login upload prompt.
// ---------------------------------------------------------------------------

// Callbacks fired after a sync completes (so views can re-render).
const syncListeners = [];
export const onSynced = (fn) => syncListeners.push(fn);
const notifySynced = () => syncListeners.forEach((fn) => fn());

// Render the sync toggle row (only when signed in).
export function renderSyncUI() {
  const box = $('syncBox');
  if (!box) return;
  if (!cloudEnabled() || !state.user) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `
    <label class="sync-toggle">
      <div class="sync-text">
        <div class="sync-title">Sync personal expenses</div>
      </div>
      <input type="checkbox" id="syncToggle" ${state.PREFS.cloudSync ? 'checked' : ''}/>
      <span class="switch"></span>
    </label>`;
  $('syncToggle').onchange = async (e) => {
    const turningOn = e.target.checked;
    const ok = await confirmModal(
      turningOn
        ? 'Back up your personal expenses to the cloud and sync them across your devices? Groups always sync while you’re signed in — this only affects your personal expenses.'
        : 'Turn off sync and remove your personal expenses from the cloud? They’ll stay on this device only, and sync turns off on all your devices. Your groups keep syncing.',
      {
        title: turningOn ? 'Turn on personal sync' : 'Turn off personal sync',
        confirmLabel: turningOn ? 'Turn on' : 'Turn off & remove',
        danger: !turningOn,
      }
    );
    if (!ok) {
      // Cancelled — snap the checkbox back to its actual state.
      e.target.checked = state.PREFS.cloudSync;
      return;
    }
    if (turningOn) {
      await enableSync();
    } else {
      // Wipe the cloud copy; if that fails, sync stays ON (disableSyncAndWipe
      // leaves the flag untouched), and renderSyncUI restores the checkbox.
      await disableSyncAndWipe();
    }
    renderSyncUI();
  };
}

// Turn sync on: flip the server flag first (source of truth), then upload
// current local records and pull+merge. Aborts (returns false) if the server
// flag can't be set, so we never sync while the shared preference says off.
async function enableSync() {
  if (!(await setSyncFlag(true))) {
    toastError('Could not turn on sync. Please try again.');
    return false;
  }
  const ok = await uploadAll();
  if (!ok) return false;
  state.PREFS.cloudSync = true;
  persistPrefs();
  await pullAndMerge();
  renderSyncUI();
  notifySynced();
  return true;
}

// Turn sync off everywhere AND remove the user's personal expenses from the
// cloud, leaving only the local copy. Flips the server flag off first (so other
// devices stop syncing on their next login), then hard-deletes the cloud rows.
// Returns false (leaving sync ON) if either the flag write or the delete fails,
// so we never report "off" while the server still says on or data remains.
// Local state.recs is never touched.
async function disableSyncAndWipe() {
  if (!cloudEnabled() || !state.user) {
    // No cloud/user: nothing server-side to change, just flip the local flag.
    state.PREFS.cloudSync = false;
    persistPrefs();
    return true;
  }
  if (!(await setSyncFlag(false))) {
    toastError('Could not turn off sync, so it is still on. Please try again.');
    return false; // abort — keep sync ON
  }
  const { error } = await supabase.from('personal_expenses').delete().eq('user_id', state.user.id);
  if (error) {
    console.error('sync wipe failed', error);
    // Roll the flag back on so the state stays consistent (still syncing).
    await setSyncFlag(true);
    toastError('Could not remove your expenses from the cloud, so sync is still on. Please try again.');
    return false; // abort — keep sync ON
  }
  state.PREFS.cloudSync = false;
  persistPrefs();
  return true;
}

// Show the styled first-login upload modal; resolves true if the user accepts.
function askUploadModal(count) {
  return new Promise((resolve) => {
    const modal = $('syncPromptModal');
    $('syncPromptText').textContent = `You have ${count} expense${count === 1 ? '' : 's'} saved on this device. Upload them to the cloud and keep everything synced across your devices?`;
    const done = (val) => {
      modal.classList.remove('open');
      $('syncPromptYes').onclick = null;
      $('syncPromptNo').onclick = null;
      modal.onclick = null;
      resolve(val);
    };
    $('syncPromptYes').onclick = () => done(true);
    $('syncPromptNo').onclick = () => done(false);
    modal.onclick = (e) => {
      if (e.target === modal) done(false);
    };
    modal.classList.add('open');
  });
}

// Called once after login. The user's server-side flag is the source of truth:
//   - flag ON  -> mirror locally + pull/merge (sync stays on across devices).
//   - flag OFF -> mirror locally; do NOT upload. If the user has never decided,
//     offer the one-time upload prompt; a deliberate prior "off" is respected
//     silently (no prompt), which is what makes "off everywhere" stick.
export async function onLoginSync() {
  if (!cloudEnabled() || !state.user) return;
  const remote = await fetchSyncFlag();

  if (remote) {
    // Sync is on (possibly enabled on another device) — adopt it and merge.
    state.PREFS.cloudSync = true;
    persistPrefs();
    await pullAndMerge();
    notifySynced();
    renderSyncUI();
    return;
  }

  // Server says off. Ensure the local cache agrees (e.g. another device turned
  // it off) — this device must not push.
  if (state.PREFS.cloudSync) {
    state.PREFS.cloudSync = false;
    persistPrefs();
    renderSyncUI();
  }

  // First-ever decision: offer to upload local records. If the user was already
  // prompted before (or explicitly turned sync off), respect that and stay off.
  if (state.recs.length && !state.PREFS.syncPrompted) {
    state.PREFS.syncPrompted = true;
    persistPrefs();
    if (await askUploadModal(state.recs.length)) {
      await enableSync();
    }
  }
}
