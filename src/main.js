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
import { initOnboarding, onboardingIfNeeded } from './features/onboarding.js';
import { initNewGroup } from './views/newGroup.js';
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
// Deep-link open: capture ?group=ID(&exp=ID) from a tapped push notification (or an
// openWindow when the app was closed), then strip it. Opened after cloud load.
let pendingOpen = null;
try {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('join');
  if (code) {
    pendingJoinCode = code.trim().toUpperCase();
    params.delete('join');
  }
  const groupId = params.get('group');
  if (groupId) {
    pendingOpen = { groupId, expId: params.get('exp') || null };
    params.delete('group');
    params.delete('exp');
  }
  if (code || groupId) {
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

// Profile saved (name/upi/phone changed) -> refresh the header avatar + pending
// dot, and the groups view (its pending indicator).
document.addEventListener('profile-updated', () => {
  renderHomeActions();
  refreshGroupsView();
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
initOnboarding();
initAuth();
initGroupsFeature();
initGroupsView();
initNewGroup();

// React to sign in / out: load or clear cloud data, (un)subscribe to realtime,
// update the header actions, and run personal-expense sync.
onAuthChange((user) => {
  renderHomeActions();
  renderSyncUI();
  refreshUpiButton();
  updateNotifyButton();
  if (user) {
    loadCloudData().then(() => {
      maybeJoinFromLink();
      maybeOpenGroupFromLink();
    });
    subscribeRealtime();
    // Load the user's own profile, then: run the full-screen onboarding journey
    // if it's incomplete (name/phone missing), and refresh the menu button.
    loadMyProfile().then(() => {
      refreshUpiButton();
      renderHomeActions(); // avatar + pending dot now that profile (upi) is known
      onboardingIfNeeded(() => showHome());
    });
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

// If a push notification was tapped (?group=ID&exp=ID, or a runtime message from the
// service worker), open that group — scrolled to the expense when one was given.
// Only opens a group the user is actually a member of (cloud data must be loaded).
function maybeOpenGroupFromLink() {
  if (!pendingOpen || !state.user) return;
  const { groupId, expId } = pendingOpen;
  if (!state.groups.some((g) => g.id === groupId)) return; // not (yet) a member; leave pending
  pendingOpen = null; // consume it
  showGroupDetail(groupId, expId || null);
}

// Service worker relays a tapped notification while the app is already open. If cloud
// data is loaded, open immediately; otherwise stash it for maybeOpenGroupFromLink to
// pick up once loadCloudData() resolves.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'open-group') return;
    try {
      const u = new URL(event.data.url, window.location.origin);
      const groupId = u.searchParams.get('group');
      if (!groupId) return;
      pendingOpen = { groupId, expId: u.searchParams.get('exp') || null };
      maybeOpenGroupFromLink();
    } catch {
      /* malformed url from SW — ignore */
    }
  });
}

// "Group notifications" menu toggle: shown when signed in + push supported.
// Label reflects the real subscription state; tapping toggles on/off.
async function updateNotifyButton() {
  const btn = $('notifyBtn');
  if (!btn) return;
  const show = !!state.user && pushSupported();
  // Show/hide the whole Notifications section (heading + card), not just the button.
  btn.style.display = show ? '' : 'none';
  $('notifSection').style.display = show ? '' : 'none';
  $('notifSectionLabel').style.display = show ? '' : 'none';
  if (!show) return;
  const label = $('notifyBtnLabel');
  const sw = $('notifySwitch');
  const status = pushStatus();
  if (status === 'denied') {
    // Blocked at the browser level — show it off + disabled (only browser settings can undo).
    if (label) label.textContent = 'Notifications blocked';
    sw.classList.remove('on');
    btn.classList.add('is-disabled');
    btn.disabled = true;
    return;
  }
  btn.classList.remove('is-disabled');
  btn.disabled = false;
  if (label) label.textContent = 'Group notifications';
  const on = await isSubscribed();
  sw.classList.toggle('on', on);
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
      // Keep the menu open so the switch visibly flips in place.
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
