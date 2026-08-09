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
import { pendingProfileActions } from '../features/profile.js';

// The menu button's inner content: the user's avatar when logged in (photo or a
// colored initial), else the gear. A pending-action dot rides on top when set.
function menuButtonInner() {
  const pendingDot = pendingProfileActions() > 0 ? '<span class="pending-dot"></span>' : '';
  if (cloudEnabled() && state.user) {
    const u = state.user;
    const inner = u.avatar
      ? `<img src="${u.avatar}" alt="" referrerpolicy="no-referrer"/>`
      : `<span class="hdr-avatar-initial">${(u.name || '?').charAt(0).toUpperCase()}</span>`;
    return `<span class="hdr-avatar">${inner}</span>${pendingDot}`;
  }
  return icon.gear() + pendingDot;
}

export function renderHomeActions() {
  const box = $('homeActions');
  if (!box) return;

  // The right-most button opens the menu. It shows the profile avatar when logged
  // in (gear otherwise), with a pending-action dot when something needs attention.
  const menuBtn = `<button class="hdr-btn icon-only hdr-menu-btn" id="gearBtn" aria-label="Menu">${menuButtonInner()}</button>`;

  if (cloudEnabled() && state.user) {
    box.innerHTML = `<button class="hdr-btn icon-only" id="groupsHdrBtn" aria-label="Groups">${icon.users({ size: 19 })}</button>${menuBtn}`;
    $('groupsHdrBtn').onclick = showGroups;
  } else if (cloudEnabled()) {
    box.innerHTML = `<button class="hdr-btn primary" id="loginHdrBtn">${icon.login({ size: 18 })}<span>Login</span></button>${menuBtn}`;
    $('loginHdrBtn').onclick = signInWithGoogle;
  } else {
    box.innerHTML = menuBtn; // local-only mode: just the menu (gear)
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
  ['catbackbtn', 'groupsBackBtn', 'backbtn', 'anBackBtn'].forEach((id) => {
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
