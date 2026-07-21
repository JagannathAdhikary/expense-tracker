// Category-detail view: a single category's transactions for the current month.

import { state } from '../state.js';
import { MN } from '../constants.js';
import { fmt, filtered, catByName } from '../format.js';
import { $ } from '../dom.js';
import { renderDateGroups, attachListHandler } from './list.js';
import { render } from './home.js';
import { showEdit, openEditGroup } from './addEdit.js';
import { sharedRowsForMonth, expenseHasPayment } from '../cloudrows.js';
import { markShareDone, deleteGroupExpense } from '../features/groups.js';
import { toastError } from '../toast.js';

export function renderCategoryView() {
  const cat = catByName(state.filterCat);
  $('catview-title').textContent = cat.e + ' ' + cat.n;
  $('cvperiod').textContent = MN[state.cur.getMonth()] + ' ' + state.cur.getFullYear();
  const personal = filtered().filter((r) => r.cat === state.filterCat);
  const shared = sharedRowsForMonth(state.cur).filter((r) => r.cat === state.filterCat);
  const rows = [...personal, ...shared].sort((a, b) => new Date(b.date) - new Date(a.date) || (b.id > a.id ? 1 : -1));
  // Total: personal + non-pending shared (owed rows excluded until settled), matching home.
  const total = personal.reduce((s, r) => s + r.amt, 0) + shared.filter((r) => !r.pending).reduce((s, r) => s + r.amt, 0);
  $('cvtot').textContent = fmt(total);
  $('cvcnt').textContent = rows.length;
  const list = $('cvlist');
  if (!rows.length) {
    list.innerHTML = '<div class="empty"><span>🧾</span>No ' + cat.n + ' expenses this month.</div>';
    return;
  }
  renderDateGroups(rows, list);
}

export function showCategoryView(name) {
  state.filterCat = name;
  $('home').classList.remove('active');
  $('catview').classList.add('active');
  renderCategoryView();
}

// Keep the home totals in sync too, matching the original shared handler.
function rerender() {
  render();
  if (state.filterCat) renderCategoryView();
}

export function initCategory() {
  attachListHandler($('cvlist'), {
    onEdit: showEdit,
    rerender,
    onSettle: async (splitId) => {
      if (!confirm('Mark your share as settled?')) return;
      await markShareDone(splitId);
      rerender();
    },
    onEditGroup: (gid) => openEditGroup(gid),
    onDeleteGroup: async (gid) => {
      if (expenseHasPayment(gid)) {
        toastError('This expense already has a settled share, so it can no longer be deleted.');
        return;
      }
      if (!confirm('Delete this group expense for everyone? This cannot be undone.')) return;
      await deleteGroupExpense(gid);
      rerender();
    },
  });
  $('catbackbtn').onclick = () => {
    // Back from category view returns home.
    $('add').classList.remove('active');
    $('catview').classList.remove('active');
    state.filterCat = null;
    $('home').classList.add('active');
    render();
  };
}
