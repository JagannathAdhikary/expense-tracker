// User profile bits beyond auth: the UPI ID used for pay-on-settle. Fetches the
// signed-in user's own upi_id (auth gives name/email/avatar only, not profile
// columns), and saves an edited one back. Co-members' UPI IDs arrive via
// loadCloudData (state.groups[].members[].upi).

import { supabase, cloudEnabled } from '../supabase.js';
import { state } from '../state.js';
import { $ } from '../dom.js';
import { toastError, toastSuccess } from '../toast.js';
import { isValidUpi, normalizeUpi, dedupeUpis, withPrimary } from '../upi.js';
import { isValidPhone, formatPhone } from '../phone.js';

// Load the current user's own profile fields (upi_id, upi_ids, phone) into state.user.
export async function loadMyProfile() {
  if (!cloudEnabled() || !state.user) return;
  const { data, error } = await supabase.from('profiles').select('upi_id, upi_ids, phone, display_name').eq('id', state.user.id).maybeSingle();
  if (!error && data) {
    state.user.upi = data.upi_id || null; // primary VPA (what co-members pay to)
    // All VPAs. Back-compat: an old single upi_id with no list becomes a one-item list.
    state.user.upiIds = data.upi_ids && data.upi_ids.length ? dedupeUpis(data.upi_ids) : data.upi_id ? [normalizeUpi(data.upi_id)] : [];
    state.user.phone = data.phone || null;
    // Prefer the stored display_name (may have been edited) over the OAuth name.
    if (data.display_name) state.user.name = data.display_name;
  }
}

// True when the required profile fields (name + phone) are set.
export function profileComplete() {
  return !!(state.user && state.user.name && state.user.phone);
}

// Persist the user's VPA list + primary to the DB and mirror into state. Internal
// helper for the add/remove/set-primary actions (each persists immediately).
async function persistUpis(list, primary) {
  if (!cloudEnabled() || !state.user) return false;
  const { list: clean, primary: prim } = withPrimary(list, primary);
  const { error } = await supabase.from('profiles').update({ upi_id: prim, upi_ids: clean }).eq('id', state.user.id);
  if (error) {
    toastError('Could not save UPI IDs: ' + error.message);
    return false;
  }
  state.user.upiIds = clean;
  state.user.upi = prim;
  return true;
}

// Add a VPA to the user's list (becomes primary if it's the first one). Rejects
// malformed handles and duplicates. Returns { ok, error } for inline messaging.
export async function addMyUpi(raw) {
  const id = normalizeUpi(raw);
  if (!isValidUpi(id)) return { ok: false, error: 'Use the form name@bank (e.g. rahul@okaxis).' };
  const cur = state.user?.upiIds || [];
  if (cur.includes(id)) return { ok: false, error: 'That UPI ID is already added.' };
  const ok = await persistUpis([...cur, id], state.user?.upi || id);
  if (ok) toastSuccess('UPI ID added');
  return { ok, error: ok ? '' : 'Could not save. Try again.' };
}

// Remove a VPA. If it was primary, the new primary falls back to the first remaining.
export async function removeMyUpi(vpa) {
  const id = normalizeUpi(vpa);
  const cur = state.user?.upiIds || [];
  const next = cur.filter((v) => v !== id);
  const primary = state.user?.upi === id ? null : state.user?.upi; // withPrimary picks a new first
  const ok = await persistUpis(next, primary);
  if (ok) toastSuccess(next.length ? 'UPI ID removed' : 'UPI ID removed');
  return ok;
}

// Make a VPA the primary (the one co-members pay to).
export async function setPrimaryUpi(vpa) {
  const id = normalizeUpi(vpa);
  const cur = state.user?.upiIds || [];
  if (!cur.includes(id)) return false;
  const ok = await persistUpis(cur, id);
  if (ok) toastSuccess('Primary UPI updated');
  return ok;
}

// Save the full profile from the completion/edit step. name + phone are required
// (format-validated); upi is optional but validated when present. Returns
// { ok, errors } — errors keyed by field so the modal can show inline messages.
export async function saveMyProfile({ name, phone, upi }) {
  const errors = {};
  const cleanName = (name || '').trim();
  if (!cleanName) errors.name = 'Please enter your name.';
  if (!phone || !isValidPhone(phone)) errors.phone = 'Enter a valid mobile number.';
  const cleanUpi = normalizeUpi(upi);
  if (cleanUpi && !isValidUpi(cleanUpi)) errors.upi = 'Use the form name@bank (e.g. rahul@okaxis).';
  if (Object.keys(errors).length) return { ok: false, errors };
  if (!cloudEnabled() || !state.user) return { ok: false, errors: {} };

  // Seed / merge the VPA list from the single onboarding field: keep any existing
  // VPAs, add this one, and make it primary. withPrimary de-dupes + validates.
  const merged = withPrimary(cleanUpi ? [cleanUpi, ...(state.user.upiIds || [])] : state.user.upiIds || [], cleanUpi || state.user.upi);
  const patch = { display_name: cleanName, phone: formatPhone(phone), upi_id: merged.primary, upi_ids: merged.list };
  const { error } = await supabase.from('profiles').update(patch).eq('id', state.user.id);
  if (error) {
    toastError('Could not save profile: ' + error.message);
    return { ok: false, errors: {} };
  }
  state.user.name = cleanName;
  state.user.phone = patch.phone;
  state.user.upi = patch.upi_id;
  state.user.upiIds = patch.upi_ids;
  return { ok: true, errors: {} };
}

// ---- Profile modal (completion gate + edit) --------------------------------

let gateMode = false; // true = required completion (no cancel, backdrop won't close)

function showFieldErr(id, msg) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? '' : 'none';
}

// Render the user's VPA rows: each shows the VPA, a make-primary star, and remove ×.
// The primary row is marked. Empty state shows a hint.
function renderUpiList() {
  const wrap = $('profUpiList');
  if (!wrap) return;
  const list = state.user?.upiIds || [];
  const primary = state.user?.upi || null;
  if (!list.length) {
    wrap.innerHTML = '<p class="upi-empty">No UPI IDs yet. Add one so group members can pay you back.</p>';
    return;
  }
  wrap.innerHTML = list
    .map((v) => {
      const isPrimary = v === primary;
      return `<div class="upi-row${isPrimary ? ' is-primary' : ''}">
        <button type="button" class="upi-radio${isPrimary ? ' on' : ''}" data-primary="${v}" title="${isPrimary ? 'Primary UPI' : 'Make primary'}" aria-label="${isPrimary ? 'Primary UPI' : 'Make primary'}" aria-pressed="${isPrimary}"></button>
        <span class="upi-vpa">${v}</span>
        ${isPrimary ? '<span class="upi-badge">Primary</span>' : ''}
        <button type="button" class="upi-remove" data-remove="${v}" aria-label="Remove">×</button>
      </div>`;
    })
    .join('');
}

function openProfileModal({ gate = false } = {}) {
  gateMode = gate;
  $('profName').value = state.user?.name || '';
  $('profPhone').value = state.user?.phone || '';
  $('profUpi').value = '';
  renderUpiList();
  ['profNameErr', 'profPhoneErr', 'profUpiErr'].forEach((id) => showFieldErr(id, ''));
  $('profileModalTitle').textContent = gate ? 'Complete your profile' : 'Edit profile';
  $('profileModalNote').style.display = gate ? '' : 'none';
  // In edit mode, surface a pending-action banner when something's still needed
  // (currently: no UPI ID so friends can pay you back).
  const banner = $('profilePendingBanner');
  if (banner) {
    const pending = !gate && pendingProfileActions() > 0;
    banner.style.display = pending ? '' : 'none';
    if (pending) banner.textContent = '1 pending action — add a UPI ID so group members can pay you.';
  }
  // In gate mode there's no escape: hide Cancel, ignore backdrop clicks.
  $('profCancel').style.display = gate ? 'none' : '';
  $('profileModal').classList.add('open');
  setTimeout(() => $('profName').focus(), 60);
}

function closeProfileModal() {
  $('profileModal').classList.remove('open');
}

// Show/hide the Account group (Edit profile) + reflect any pending action (a
// missing UPI ID) with the "1 pending" pill.
export function refreshUpiButton() {
  const grp = $('accountGroup');
  const show = cloudEnabled() && !!state.user;
  if (grp) grp.style.display = show ? '' : 'none';
  const pill = $('profilePending');
  if (pill) pill.style.display = show && pendingProfileActions() > 0 ? '' : 'none';
}

// Count of pending profile actions. Right now: a missing UPI ID (once logged in,
// ready for group features). Returns 0 when nothing's pending.
export function pendingProfileActions() {
  if (!cloudEnabled() || !state.user) return 0;
  return state.user.upi ? 0 : 1;
}

// Open the profile editor (edit mode) from anywhere — e.g. the group pending nudge.
export function openProfileEdit() {
  openProfileModal({ gate: false });
}

// Open the required profile gate if name/phone are missing. Returns true if it
// opened the gate (caller can treat the app as "blocked" until saved).
export function openProfileGateIfNeeded() {
  if (!cloudEnabled() || !state.user) return false;
  if (profileComplete()) return false;
  openProfileModal({ gate: true });
  return true;
}

export function initProfile() {
  const btn = $('upiBtn');
  if (btn) {
    btn.onclick = () => {
      // Leave the menu open underneath; the modal stacks on top and returns to it.
      openProfileModal({ gate: false });
    };
  }
  $('profCancel').onclick = () => {
    if (!gateMode) closeProfileModal();
  };
  $('profileModal').onclick = (e) => {
    if (e.target === $('profileModal') && !gateMode) closeProfileModal(); // backdrop closes only in edit mode
  };
  ['profName', 'profPhone', 'profUpi'].forEach((id) => {
    $(id).addEventListener('input', () => showFieldErr(id + 'Err', ''));
  });
  // Add a VPA from the add-row (button or Enter). Persists immediately, re-renders.
  const doAddUpi = async () => {
    const val = $('profUpi').value.trim();
    if (!val) return;
    const res = await addMyUpi(val);
    if (!res.ok) {
      showFieldErr('profUpiErr', res.error);
      return;
    }
    $('profUpi').value = '';
    showFieldErr('profUpiErr', '');
    renderUpiList();
    refreshUpiButton();
    document.dispatchEvent(new CustomEvent('profile-updated'));
  };
  $('profUpiAdd').onclick = doAddUpi;
  $('profUpi').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doAddUpi();
    }
  });
  // Set-primary / remove, delegated on the list.
  $('profUpiList').addEventListener('click', async (e) => {
    const star = e.target.closest('[data-primary]');
    const rm = e.target.closest('[data-remove]');
    if (star) {
      await setPrimaryUpi(star.dataset.primary);
    } else if (rm) {
      await removeMyUpi(rm.dataset.remove);
    } else {
      return;
    }
    renderUpiList();
    refreshUpiButton();
    document.dispatchEvent(new CustomEvent('profile-updated'));
  });
  $('profSave').onclick = async () => {
    // VPAs are already persisted per-action; Save only writes name + phone. Pass the
    // current primary so saveMyProfile keeps the list intact.
    const res = await saveMyProfile({ name: $('profName').value, phone: $('profPhone').value, upi: state.user?.upi || '' });
    if (!res.ok) {
      showFieldErr('profNameErr', res.errors.name);
      showFieldErr('profPhoneErr', res.errors.phone);
      showFieldErr('profUpiErr', res.errors.upi);
      return;
    }
    closeProfileModal();
    refreshUpiButton();
    // Let the header re-render (avatar + pending dot) without a circular import.
    document.dispatchEvent(new CustomEvent('profile-updated'));
    toastSuccess('Profile saved');
  };
}
