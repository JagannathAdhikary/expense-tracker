// User profile bits beyond auth: the UPI ID used for pay-on-settle. Fetches the
// signed-in user's own upi_id (auth gives name/email/avatar only, not profile
// columns), and saves an edited one back. Co-members' UPI IDs arrive via
// loadCloudData (state.groups[].members[].upi).

import { supabase, cloudEnabled } from '../supabase.js';
import { state } from '../state.js';
import { $ } from '../dom.js';
import { toastError, toastSuccess } from '../toast.js';
import { isValidUpi, normalizeUpi } from '../upi.js';
import { isValidPhone, formatPhone } from '../phone.js';

// Load the current user's own profile fields (upi_id, phone) into state.user.
export async function loadMyProfile() {
  if (!cloudEnabled() || !state.user) return;
  const { data, error } = await supabase.from('profiles').select('upi_id, phone, display_name').eq('id', state.user.id).maybeSingle();
  if (!error && data) {
    state.user.upi = data.upi_id || null;
    state.user.phone = data.phone || null;
    // Prefer the stored display_name (may have been edited) over the OAuth name.
    if (data.display_name) state.user.name = data.display_name;
  }
}

// True when the required profile fields (name + phone) are set.
export function profileComplete() {
  return !!(state.user && state.user.name && state.user.phone);
}

// Save (or clear) the current user's UPI ID. Empty clears it; otherwise it must be
// a well-formed VPA. Returns true on success.
export async function saveMyUpi(rawId) {
  if (!cloudEnabled() || !state.user) return false;
  const id = normalizeUpi(rawId);
  if (id && !isValidUpi(id)) {
    toastError('That doesn’t look like a UPI ID. Use the form name@bank (e.g. rahul@okaxis).');
    return false;
  }
  const value = id || null;
  const { error } = await supabase.from('profiles').update({ upi_id: value }).eq('id', state.user.id);
  if (error) {
    toastError('Could not save UPI ID: ' + error.message);
    return false;
  }
  state.user.upi = value;
  toastSuccess(value ? 'UPI ID saved' : 'UPI ID removed');
  return true;
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

  const patch = { display_name: cleanName, phone: formatPhone(phone), upi_id: cleanUpi || null };
  const { error } = await supabase.from('profiles').update(patch).eq('id', state.user.id);
  if (error) {
    toastError('Could not save profile: ' + error.message);
    return { ok: false, errors: {} };
  }
  state.user.name = cleanName;
  state.user.phone = patch.phone;
  state.user.upi = patch.upi_id;
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

function openProfileModal({ gate = false } = {}) {
  gateMode = gate;
  $('profName').value = state.user?.name || '';
  $('profPhone').value = state.user?.phone || '';
  $('profUpi').value = state.user?.upi || '';
  ['profNameErr', 'profPhoneErr', 'profUpiErr'].forEach((id) => showFieldErr(id, ''));
  $('profileModalTitle').textContent = gate ? 'Complete your profile' : 'Edit profile';
  $('profileModalNote').style.display = gate ? '' : 'none';
  // In edit mode, surface a pending-action banner when something's still needed
  // (currently: a missing UPI ID so friends can pay you back).
  const banner = $('profilePendingBanner');
  if (banner) {
    const pending = !gate && pendingProfileActions() > 0;
    banner.style.display = pending ? '' : 'none';
    if (pending) banner.textContent = '1 pending action — add your UPI ID so group members can pay you.';
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
  $('profSave').onclick = async () => {
    const res = await saveMyProfile({ name: $('profName').value, phone: $('profPhone').value, upi: $('profUpi').value });
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
