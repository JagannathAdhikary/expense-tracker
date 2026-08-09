// Home screen: month summary, the recent transaction list, and the filter bar.
// (Category breakdown lives on the Analytics page now.)

import { state } from '../state.js';
import { MN } from '../constants.js';
import { fmt, filtered, applyFilter, filterActive } from '../format.js';
import { $ } from '../dom.js';
import { renderDateGroups, attachListHandler } from './list.js';
import { renderCategoryView } from './category.js';
import { showAnalytics } from './analytics.js';
import { openFilterSheet, filterSummary, clearFilter } from '../features/filter.js';
import { showEdit, openEditGroup, openEditMySplit } from './addEdit.js';
import { showGroupDetail, confirmAndSettleShare } from './groups.js';
import { navReset } from '../nav.js';
import { sharedRowsForMonth, expenseHasPayment } from '../cloudrows.js';
import { deleteGroupExpense } from '../features/groups.js';
import { icon } from '../icons.js';
import { toastError } from '../toast.js';
import { confirmModal } from '../confirm.js';

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
    tlist.innerHTML = filterActive()
      ? '<div class="empty"><span>🔍</span>No transactions match this filter.</div>'
      : '<div class="empty"><span>🧾</span>No expenses this month.<br>Tap + to add one.</div>';
    return;
  }
  renderDateGroups(rows, tlist);
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
  // Clear-filter chip (delegated — the bar is re-rendered each time).
  $('filterBar').addEventListener('click', (e) => {
    if (e.target.closest('#clearFilterBtn')) {
      clearFilter();
      render();
    }
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
}
