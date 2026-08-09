// App entry point: load styles, initialize state, wire top-level UI, and boot.

import './styles.css';
import { registerSW } from 'virtual:pwa-register';

import { state } from './state.js';
import { initState } from './storage.js';
import { initialCat, initialPay } from './format.js';
import { $ } from './dom.js';

import { render, showHome, initHome } from './views/home.js';
import { renderCategoryView, initCategory } from './views/category.js';
import { renderAnalytics, initAnalytics } from './views/analytics.js';
import { initAddEdit, renderGroupChips } from './views/addEdit.js';
import { initHeader, renderHomeActions } from './views/header.js';
import { initCategories } from './features/categories.js';
import { initPayments } from './features/payments.js';
import { initDefaults } from './features/defaults.js';
import { initBackup } from './features/backup.js';
import { initFilter } from './features/filter.js';
import { initProfile, loadMyProfile, refreshUpiButton } from './features/profile.js';
import { autoEnablePush, enablePush, disablePush, isSubscribed, pushStatus, pushSupported } from './features/push.js';
import { initAuth, onAuthChange } from './features/auth.js';
import { initGroupsFeature, loadCloudData, onGroupData, subscribeRealtime, unsubscribeRealtime, joinGroupByCode } from './features/groups.js';
import { initGroupsView, refreshGroupsView, showGroupDetail } from './views/groups.js';
import { renderSyncUI, onLoginSync, onSynced } from './features/sync.js';
import { showCoachmark } from './coachmark.js';
import { persistPrefs } from './storage.js';

// Deep-link join: capture ?join=CODE from the invite link, then strip it from the
// URL so a refresh/re-login doesn't re-trigger. Handled after login + cloud load.
let pendingJoinCode = null;
try {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('join');
  if (code) {
    pendingJoinCode = code.trim().toUpperCase();
    params.delete('join');
    const qs = params.toString();
    const clean = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    window.history.replaceState({}, '', clean);
  }
} catch {
  /* no-op: malformed URL */
}

// Month nav (dispatched from the header) refreshes the active list views.
document.addEventListener('month-change', () => {
  render();
  if (state.filterCat) renderCategoryView();
  if ($('analytics').classList.contains('active')) renderAnalytics();
});

// Load data, then seed the current selections from user defaults.
initState();
state.selCat = initialCat();
state.selPay = initialPay();

// Wire all screens and features.
initHeader();
initHome();
initCategory();
initAnalytics();
initAddEdit();
initCategories();
initPayments();
initDefaults();
initBackup();
initFilter();
initProfile();
initAuth();
initGroupsFeature();
initGroupsView();

// React to sign in / out: load or clear cloud data, (un)subscribe to realtime,
// update the header actions, and run personal-expense sync.
onAuthChange((user) => {
  renderHomeActions();
  renderSyncUI();
  refreshUpiButton();
  updateNotifyButton();
  if (user) {
    loadCloudData().then(() => maybeJoinFromLink());
    subscribeRealtime();
    // Load the user's own UPI id, then refresh the menu button + maybe prompt once.
    loadMyProfile().then(() => refreshUpiButton());
    // On-by-default group notifications: ask permission once + subscribe on grant.
    autoEnablePush(user).then(updateNotifyButton);
    // Run the first-login sync prompt, then introduce Groups with a one-time tip.
    onLoginSync().then(maybeShowGroupsTip);
  } else {
    unsubscribeRealtime();
    loadCloudData(); // clears cloud state when logged out
  }
});

// If the app was opened via an invite link (?join=CODE), join that group now that
// we're signed in and cloud data is loaded, then open it. Runs at most once.
async function maybeJoinFromLink() {
  if (!pendingJoinCode || !state.user) return;
  const code = pendingJoinCode;
  pendingJoinCode = null; // consume it (only attempt once)
  const grp = await joinGroupByCode(code); // shows its own toast (joined / already in / not found)
  if (grp) showGroupDetail(grp.id);
}

// "Group notifications" menu toggle: shown when signed in + push supported.
// Label reflects the real subscription state; tapping toggles on/off.
async function updateNotifyButton() {
  const btn = $('notifyBtn');
  if (!btn) return;
  const show = !!state.user && pushSupported();
  btn.style.display = show ? '' : 'none';
  if (!show) return;
  const label = $('notifyBtnLabel');
  const status = pushStatus();
  if (status === 'denied') {
    if (label) label.textContent = 'Notifications blocked (browser settings)';
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  const on = await isSubscribed();
  if (label) label.textContent = on ? 'Group notifications: on · tap to turn off' : 'Enable group notifications';
}
const notifyBtn = $('notifyBtn');
if (notifyBtn) {
  notifyBtn.onclick = async () => {
    if (notifyBtn.disabled) return;
    notifyBtn.disabled = true;
    try {
      if (await isSubscribed()) await disablePush();
      else await enablePush(state.user);
    } finally {
      $('overlay').classList.remove('open'); // close the menu sheet
      await updateNotifyButton();
    }
  };
}

// One-time coach-mark pointing at the Groups icon, shown after the first login.
function maybeShowGroupsTip() {
  if (!state.user || state.PREFS.groupsTipSeen) return;
  if (!$('groupsHdrBtn')) return; // header not showing the Groups button
  state.PREFS.groupsTipSeen = true;
  persistPrefs();
  // Small delay so it appears after the header/sync-modal settle.
  setTimeout(() => {
    showCoachmark('groupsHdrBtn', {
      title: '👥 Split expenses with friends',
      body: 'Tap here to create or join a group. Tag a shared expense to a group and it’s split automatically — everyone sees what they owe.',
      cta: 'Got it',
    });
  }, 400);
}

// After a personal-expense sync, refresh the list views.
onSynced(() => {
  render();
  if (state.filterCat) renderCategoryView();
  if ($('analytics').classList.contains('active')) renderAnalytics();
});

// Whenever cloud data (re)loads, refresh the home list and the groups view, and
// keep the add-form group picker current.
onGroupData(() => {
  render();
  if (state.filterCat) renderCategoryView();
  if ($('analytics').classList.contains('active')) renderAnalytics();
  refreshGroupsView();
  if ($('add').classList.contains('active')) renderGroupChips();
});

render();

// vite-plugin-pwa: keep the app up to date automatically.
registerSW({ immediate: true });
