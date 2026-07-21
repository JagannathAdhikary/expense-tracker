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

export const syncOn = () => cloudEnabled() && !!state.user && !!state.PREFS.cloudSync;

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
        <div class="sync-title">Cloud sync</div>
        <div class="sync-sub">Back up personal expenses & sync across devices</div>
      </div>
      <input type="checkbox" id="syncToggle" ${state.PREFS.cloudSync ? 'checked' : ''}/>
      <span class="switch"></span>
    </label>`;
  $('syncToggle').onchange = async (e) => {
    if (e.target.checked) {
      await enableSync();
    } else {
      state.PREFS.cloudSync = false;
      persistPrefs();
    }
    renderSyncUI();
  };
}

// Turn sync on: upload current local records, then pull+merge.
async function enableSync() {
  const ok = await uploadAll();
  if (!ok) return;
  state.PREFS.cloudSync = true;
  persistPrefs();
  await pullAndMerge();
  notifySynced();
}

// Called once after login. If sync isn't already on and there are local records,
// offer a one-time upload. If sync is already on, just pull+merge.
export async function onLoginSync() {
  if (!cloudEnabled() || !state.user) return;
  if (state.PREFS.cloudSync) {
    await pullAndMerge();
    notifySynced();
    return;
  }
  if (state.recs.length && !state.PREFS.syncPrompted) {
    state.PREFS.syncPrompted = true;
    persistPrefs();
    if (confirm(`Upload your ${state.recs.length} local expense${state.recs.length === 1 ? '' : 's'} to the cloud and keep them synced across devices?`)) {
      await enableSync();
    }
  }
}
