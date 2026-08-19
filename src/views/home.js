// Home screen: month summary, the recent transaction list, and the filter bar.
// (Category breakdown lives on the Analytics page now.)

import { state, collapsed } from '../state.js';
import { MN } from '../constants.js';
import { fmt, filtered, applyFilter, filterActive } from '../format.js';
import { $ } from '../dom.js';
import { renderDateGroups, attachListHandler } from './list.js';
import { renderCategoryView } from './category.js';
import { showAnalytics } from './analytics.js';
import { openFilterSheet, filterSummary, clearFilter } from '../features/filter.js';
import { showEdit, openEditGroup, openEditMySplit } from './addEdit.js';
import { showGroupDetail, confirmAndSettleShare, thumbMarkup } from './groups.js';
import { navReset } from '../nav.js';
import { sharedRowsForMonth, expenseHasPayment } from '../cloudrows.js';
import { deleteGroupExpense, groupDisplayName } from '../features/groups.js';
import { icon } from '../icons.js';
import { toastError } from '../toast.js';
import { confirmModal } from '../confirm.js';

// Distinct group ids behind the current "pending" count — set each render(), consumed
// by the pending-stat tap (open the group directly, or a dropdown when there are several).
let pendingGroupIds = [];

export function render() {
  $('mlbl').textContent = MN[state.cur.getMonth()] + ' ' + state.cur.getFullYear();
  const personal = filtered();
  const shared = sharedRowsForMonth(state.cur);
  // Sort by day (newest first), then by actual timestamp within the day so group
  // and personal txns interleave by when they happened — not group-always-on-top.
  const rowTs = (r) => (r.shared ? r.ts : r.updated || r.id || new Date(r.date).getTime());
  const allRows = [...personal, ...shared].sort((a, b) => new Date(b.date) - new Date(a.date) || rowTs(b) - rowTs(a));
  // Apply the active filter (category / group / scope / payment) to what's shown.
  const rows = applyFilter(allRows);

  // Spent total + transaction counts, computed from the FILTERED rows so they match
  // what's on screen. Pending "you owe" rows (negative) are excluded from the total.
  const total = rows.filter((r) => !r.pending).reduce((s, r) => s + r.amt, 0);
  $('tot').textContent = fmt(total);

  // Transactions box: when group rows are in view, show Settled | Pending instead
  // of a plain count. Unsettled = a share you owe, or one you paid others haven't.
  const sharedShown = rows.filter((r) => r.shared);
  const unsettled = sharedShown.filter((r) => r.pending || r.badge?.cls === 'shared-pending').length;
  // Distinct groups behind the pending count, so tapping it can jump to them.
  pendingGroupIds = [...new Set(
    sharedShown
      .filter((r) => r.pending || r.badge?.cls === 'shared-pending')
      .map((r) => r.groupId)
      .filter(Boolean),
  )];
  if (sharedShown.length) {
    $('cnt').style.display = 'none';
    $('splitCounts').style.display = 'flex';
    $('scSettled').textContent = rows.length - unsettled;
    $('scPending').textContent = unsettled;
  } else {
    $('cnt').style.display = '';
    $('cnt').textContent = rows.length;
    $('splitCounts').style.display = 'none';
  }

  // Filter bar: shown only when a filter is active, with a summary + clear button.
  const bar = $('filterBar');
  if (filterActive()) {
    bar.style.display = 'flex';
    bar.innerHTML = `<span class="fb-summary">${filterSummary()}</span><button class="fb-clear" id="clearFilterBtn">Clear</button>`;
  } else {
    bar.style.display = 'none';
    bar.innerHTML = '';
  }
  // Reflect active state on the filter button.
  $('filterBtn').classList.toggle('has-filter', filterActive());

  const tlist = $('tlist');
  if (!rows.length) {
    const q = (state.filter.q || '').trim();
    tlist.innerHTML = q
      ? `<div class="empty"><span>🔍</span>No matches for “${q}” this month.</div>`
      : filterActive()
        ? '<div class="empty"><span>🔍</span>No transactions match this filter.</div>'
        : '<div class="empty"><span>🧾</span>No expenses this month.<br>Tap + to add one.</div>';
    return;
  }
  renderDateGroups(rows, tlist);
  consumeHomeFocus();
}

// After a save, scroll to + flash the just-saved entry (personal or shared). Mirrors
// the group-detail focus path (groups.js). The focus fields are set by addEdit's
// focusHomeOnRecord; they're cleared here only once the target row is actually found,
// so a shared row that arrives via a later background reload still gets consumed.
function consumeHomeFocus() {
  const tlist = $('tlist');
  let target = null;
  if (state.focusRecId != null) {
    target = tlist.querySelector(`.txn[data-id="${state.focusRecId}"]`);
    if (target) state.focusRecId = null;
  } else if (state.focusHomeExpId != null) {
    target = tlist.querySelector(`.txn[data-exp-id="${state.focusHomeExpId}"]`);
    if (target) state.focusHomeExpId = null;
  }
  if (!target) return;
  // Expand its date group if collapsed, else it can't scroll into view.
  const grp = target.closest('.date-group');
  if (grp && collapsed.has(grp.dataset.date)) {
    collapsed.delete(grp.dataset.date);
    grp.querySelector('.date-entries').classList.remove('collapsed');
    grp.querySelector('.chevron').classList.add('open');
  }
  // rAF so this runs AFTER the render settles. nav restored the scroll position, so
  // if the row is already visible we leave it be (just flash); otherwise scroll it up
  // near the top of the viewport — offset below the sticky header so it isn't tucked
  // behind it — rather than barely into view at the bottom.
  requestAnimationFrame(() => {
    if (!isRowFullyVisible(target)) {
      const header = document.querySelector('#home header');
      const offset = (header?.offsetHeight || 0) + 12;
      const y = window.scrollY + target.getBoundingClientRect().top - offset;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
    target.classList.add('ge-flash');
    setTimeout(() => target.classList.remove('ge-flash'), 1600);
  });
}

// True when the row is already wholly within the viewport (so we shouldn't scroll —
// leaving a comfortably-visible entry put, per "otherwise simply just be there").
function isRowFullyVisible(el) {
  const r = el.getBoundingClientRect();
  return r.top >= 0 && r.bottom <= window.innerHeight;
}

export function showHome() {
  state.filterCat = null;
  navReset('home'); // home is the root of the nav stack
  render();
}

// Re-render whichever list view is currently active (home, plus category if filtered).
function rerender() {
  render();
  if (state.filterCat) renderCategoryView();
}

export function initHome() {
  // Tappable Total card -> Analytics page (chart icon in the corner as the cue).
  $('analyticsIco').innerHTML = icon.chart({ size: 18 });
  $('analyticsCard').onclick = showAnalytics;
  // Filter button opens the filter sheet; onApply re-renders the list.
  $('filterBtn').innerHTML = icon.filter({ size: 18 });
  $('filterBtn').onclick = () => openFilterSheet(render);
  // Free-text search over the current month's list. Live-filters as you type;
  // scope is the month already on screen (the list is month-scoped).
  $('searchInput').addEventListener('input', (e) => {
    state.filter.q = e.target.value;
    render();
  });
  // Clear-filter chip (delegated — the bar is re-rendered each time).
  $('filterBar').addEventListener('click', (e) => {
    if (e.target.closest('#clearFilterBtn')) {
      clearFilter();
      render();
    }
  });
  // Pending count is a shortcut to the group(s) with an unsettled share this month:
  // one group -> open it directly; several -> a small dropdown to pick from.
  $('pendingStat').addEventListener('click', () => {
    const ids = pendingGroupIds;
    if (!ids.length) return;
    if (ids.length === 1) {
      showGroupDetail(ids[0]);
      return;
    }
    openPendingMenu(ids);
  });
  attachListHandler($('tlist'), {
    onEdit: showEdit,
    rerender,
    onSettle: async (splitId) => {
      // Same rich flow as the group view: UPI pay offer + confirm + mark done.
      if (await confirmAndSettleShare(splitId)) rerender();
    },
    onEditGroup: (gid) => openEditGroup(gid),
    onEditMySplit: (sid) => openEditMySplit(sid),
    onOpenGroup: (gid, expId) => showGroupDetail(gid, expId),
    onDeleteGroup: async (gid) => {
      if (expenseHasPayment(gid)) {
        toastError('This expense already has a settled share, so it can no longer be deleted.');
        return;
      }
      if (!(await confirmModal('Delete this group expense for everyone? This cannot be undone.', { title: 'Delete expense', confirmLabel: 'Delete', danger: true }))) return;
      await deleteGroupExpense(gid);
      rerender();
    },
  });

  initBackToTop();
}

// Small dropdown anchored under the Transactions card listing the groups with a pending
// share this month. Tapping a row opens that group; tapping outside (or a row) dismisses.
function openPendingMenu(ids) {
  closePendingMenu();
  const card = $('txnCard');
  if (!card) return;
  const groups = ids
    .map((id) => state.groups.find((g) => g.id === id))
    .filter(Boolean);
  if (groups.length < 2) {
    if (groups[0]) showGroupDetail(groups[0].id);
    return;
  }
  const menu = document.createElement('div');
  menu.className = 'pending-menu';
  menu.id = 'pendingMenu';
  menu.innerHTML = groups
    .map((g) => `<button type="button" class="pending-menu-row" data-group="${g.id}">${thumbMarkup(g)}<span class="pm-name">${groupDisplayName(g)}</span></button>`)
    .join('');
  card.appendChild(menu);
  menu.addEventListener('click', (e) => {
    const row = e.target.closest('.pending-menu-row');
    if (!row) return;
    closePendingMenu();
    showGroupDetail(row.dataset.group);
  });
  // Dismiss on the next outside tap. Deferred so the opening click doesn't close it.
  requestAnimationFrame(() => document.addEventListener('click', onPendingOutside));
}

function onPendingOutside(e) {
  if (e.target.closest('#pendingMenu') || e.target.closest('#pendingStat')) return;
  closePendingMenu();
}

function closePendingMenu() {
  document.removeEventListener('click', onPendingOutside);
  $('pendingMenu')?.remove();
}

// Floating "back to top" button that appears once the home list is scrolled down.
// The window is the scroll container (see nav.js), so we watch window.scrollY.
function initBackToTop() {
  const btn = $('toTopBtn');
  if (!btn) return;
  btn.innerHTML = icon.chevronUp({ size: 22 });
  btn.hidden = false; // let it participate in layout; visibility is driven by .show
  btn.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  let ticking = false;
  const update = () => {
    ticking = false;
    // Only on home, and only once scrolled a screenful or so down.
    const show = $('home').classList.contains('active') && window.scrollY > 600;
    btn.classList.toggle('show', show);
  };
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }, { passive: true });
}
