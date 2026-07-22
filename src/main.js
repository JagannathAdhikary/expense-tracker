// App entry point: load styles, initialize state, wire top-level UI, and boot.

import './styles.css';
import { registerSW } from 'virtual:pwa-register';

import { state } from './state.js';
import { initState } from './storage.js';
import { initialCat, initialPay } from './format.js';
import { $ } from './dom.js';

import { render, showHome, initHome } from './views/home.js';
import { renderCategoryView, initCategory } from './views/category.js';
import { initAddEdit, renderGroupChips } from './views/addEdit.js';
import { initHeader, renderHomeActions } from './views/header.js';
import { initCategories } from './features/categories.js';
import { initPayments } from './features/payments.js';
import { initDefaults } from './features/defaults.js';
import { initBackup } from './features/backup.js';
import { initAuth, onAuthChange } from './features/auth.js';
import { initGroupsFeature, loadCloudData, onGroupData, subscribeRealtime, unsubscribeRealtime } from './features/groups.js';
import { initGroupsView, refreshGroupsView } from './views/groups.js';
import { renderSyncUI, onLoginSync, onSynced } from './features/sync.js';
import { showCoachmark } from './coachmark.js';
import { persistPrefs } from './storage.js';

// Month nav (dispatched from the header) refreshes the active list views.
document.addEventListener('month-change', () => {
  render();
  if (state.filterCat) renderCategoryView();
});

// Load data, then seed the current selections from user defaults.
initState();
state.selCat = initialCat();
state.selPay = initialPay();

// Wire all screens and features.
initHeader();
initHome();
initCategory();
initAddEdit();
initCategories();
initPayments();
initDefaults();
initBackup();
initAuth();
initGroupsFeature();
initGroupsView();

// React to sign in / out: load or clear cloud data, (un)subscribe to realtime,
// update the header actions, and run personal-expense sync.
onAuthChange((user) => {
  renderHomeActions();
  renderSyncUI();
  if (user) {
    loadCloudData();
    subscribeRealtime();
    // Run the first-login sync prompt, then introduce Groups with a one-time tip.
    onLoginSync().then(maybeShowGroupsTip);
  } else {
    unsubscribeRealtime();
    loadCloudData(); // clears cloud state when logged out
  }
});

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
});

// Whenever cloud data (re)loads, refresh the home list and the groups view, and
// keep the add-form group picker current.
onGroupData(() => {
  render();
  if (state.filterCat) renderCategoryView();
  refreshGroupsView();
  if ($('add').classList.contains('active')) renderGroupChips();
});

render();

// vite-plugin-pwa: keep the app up to date automatically.
registerSW({ immediate: true });
