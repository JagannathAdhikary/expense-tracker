// User profile bits beyond auth: the UPI ID used for pay-on-settle. Fetches the
// signed-in user's own upi_id (auth gives name/email/avatar only, not profile
// columns), and saves an edited one back. Co-members' UPI IDs arrive via
// loadCloudData (state.groups[].members[].upi).

import { supabase, cloudEnabled } from '../supabase.js';
import { state } from '../state.js';
import { $ } from '../dom.js';
import { toastError, toastSuccess } from '../toast.js';
import { isValidUpi, normalizeUpi } from '../upi.js';

// Load the current user's own upi_id into state.user.upi (called after login).
export async function loadMyProfile() {
  if (!cloudEnabled() || !state.user) return;
  const { data, error } = await supabase.from('profiles').select('upi_id').eq('id', state.user.id).maybeSingle();
  if (!error && data) state.user.upi = data.upi_id || null;
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

// ---- Menu "My UPI ID" modal ------------------------------------------------

function openUpiModal() {
  $('upiInput').value = state.user?.upi || '';
  $('upiErr').style.display = 'none';
  $('upiModal').classList.add('open');
  setTimeout(() => $('upiInput').focus(), 60);
}

function closeUpiModal() {
  $('upiModal').classList.remove('open');
}

// Show/hide + label the menu button based on auth + whether an ID is set.
export function refreshUpiButton() {
  const btn = $('upiBtn');
  if (!btn) return;
  const show = cloudEnabled() && !!state.user;
  btn.style.display = show ? '' : 'none';
  const label = $('upiBtnLabel');
  if (show && label) label.textContent = state.user.upi ? `UPI ID: ${state.user.upi}` : 'Add your UPI ID';
}

export function initProfile() {
  const btn = $('upiBtn');
  if (btn) {
    btn.onclick = () => {
      $('overlay').classList.remove('open'); // close the menu sheet
      openUpiModal();
    };
  }
  $('upiCancel').onclick = closeUpiModal;
  $('upiModal').onclick = (e) => {
    if (e.target === $('upiModal')) closeUpiModal();
  };
  $('upiInput').addEventListener('input', () => {
    $('upiErr').style.display = 'none';
  });
  $('upiSave').onclick = async () => {
    const raw = $('upiInput').value;
    const id = normalizeUpi(raw);
    if (id && !isValidUpi(id)) {
      const err = $('upiErr');
      err.textContent = 'Use the form name@bank (e.g. rahul@okaxis).';
      err.style.display = '';
      return;
    }
    const ok = await saveMyUpi(raw);
    if (ok) {
      closeUpiModal();
      refreshUpiButton();
    }
  };
}

// One-time prompt after first login when no UPI ID is set. Returns a promise so the
// caller can chain (mirrors onLoginSync). Skippable; only nags once via PREFS flag.
export async function maybePromptUpi() {
  if (!cloudEnabled() || !state.user) return;
  if (state.user.upi) return; // already set
  if (state.PREFS.upiPromptSeen) return; // asked before
  state.PREFS.upiPromptSeen = true;
  const { persistPrefs } = await import('../storage.js');
  persistPrefs();
  // Reuse the modal as the prompt (prefilled empty). Non-blocking.
  openUpiModal();
}
