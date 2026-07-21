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
import { initCategories } from './features/categories.js';
import { initPayments } from './features/payments.js';
import { initDefaults } from './features/defaults.js';
import { initBackup } from './features/backup.js';
import { initAuth, onAuthChange } from './features/auth.js';
import { initGroupsFeature, loadCloudData, onGroupData, subscribeRealtime, unsubscribeRealtime } from './features/groups.js';
import { initGroupsView, refreshGroupsView } from './views/groups.js';

function initHeader() {
  $('mprev').onclick = () => {
    state.cur = new Date(state.cur.getFullYear(), state.cur.getMonth() - 1, 1);
    render();
    if (state.filterCat) renderCategoryView();
  };
  $('mnext').onclick = () => {
    state.cur = new Date(state.cur.getFullYear(), state.cur.getMonth() + 1, 1);
    render();
    if (state.filterCat) renderCategoryView();
  };
  $('menuBtn').onclick = () => $('overlay').classList.add('open');
  $('closeSheet').onclick = () => $('overlay').classList.remove('open');
  $('overlay').onclick = (e) => {
    if (e.target === $('overlay')) $('overlay').classList.remove('open');
  };
}

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

// React to sign in / out: load or clear cloud data and (un)subscribe to realtime.
onAuthChange((user) => {
  if (user) {
    loadCloudData();
    subscribeRealtime();
  } else {
    unsubscribeRealtime();
    loadCloudData(); // clears cloud state when logged out
  }
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
