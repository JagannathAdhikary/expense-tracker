// Home header actions (right side). Renders based on auth state:
//   - cloud off / logged out: a "Login" button (opens sign-in)
//   - logged in: a "Groups" button + a gear menu button
// The gear opens the Options sheet (categories/payments/defaults/backup/sign-out).

import { state } from '../state.js';
import { cloudEnabled } from '../supabase.js';
import { $ } from '../dom.js';
import { icon } from '../icons.js';
import { signInWithGoogle } from '../features/auth.js';
import { showGroups } from './groups.js';

export function renderHomeActions() {
  const box = $('homeActions');
  if (!box) return;

  const gear = `<button class="hdr-btn icon-only" id="gearBtn" aria-label="Menu">${icon.gear()}</button>`;

  if (cloudEnabled() && state.user) {
    box.innerHTML = `<button class="hdr-btn icon-only" id="groupsHdrBtn" aria-label="Groups">${icon.users({ size: 19 })}</button>${gear}`;
    $('groupsHdrBtn').onclick = showGroups;
  } else if (cloudEnabled()) {
    box.innerHTML = `<button class="hdr-btn primary" id="loginHdrBtn">${icon.login({ size: 18 })}<span>Login</span></button>${gear}`;
    $('loginHdrBtn').onclick = signInWithGoogle;
  } else {
    // No backend configured: just the gear (local-only mode).
    box.innerHTML = gear;
  }
  $('gearBtn').onclick = () => $('overlay').classList.add('open');
}

export function initHeader() {
  // Populate static SVG icons in the menu sheet + close button.
  document.querySelectorAll('.sb-ico[data-icon]').forEach((el) => {
    const fn = icon[el.dataset.icon];
    if (fn) el.innerHTML = fn({ size: 19 });
  });
  const closeBtn = $('closeSheet');
  if (closeBtn) closeBtn.innerHTML = icon.close({ size: 20 });
  const addBtn = $('addbtn');
  if (addBtn) addBtn.innerHTML = icon.plus({ size: 28 });
  // Circular icon back buttons across screens.
  ['catbackbtn', 'groupsBackBtn', 'backbtn'].forEach((id) => {
    const el = $(id);
    if (el) el.innerHTML = icon.back({ size: 20 });
  });

  $('mprev').onclick = () => {
    state.cur = new Date(state.cur.getFullYear(), state.cur.getMonth() - 1, 1);
    document.dispatchEvent(new CustomEvent('month-change'));
  };
  $('mnext').onclick = () => {
    state.cur = new Date(state.cur.getFullYear(), state.cur.getMonth() + 1, 1);
    document.dispatchEvent(new CustomEvent('month-change'));
  };
  $('closeSheet').onclick = () => $('overlay').classList.remove('open');
  $('overlay').onclick = (e) => {
    if (e.target === $('overlay')) $('overlay').classList.remove('open');
  };
  renderHomeActions();
}
