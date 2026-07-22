// Home screen: month summary, category bars, and the recent transaction list.

import { state } from '../state.js';
import { MN } from '../constants.js';
import { fmt, filtered, catByName } from '../format.js';
import { $ } from '../dom.js';
import { renderDateGroups, attachListHandler } from './list.js';
import { showCategoryView, renderCategoryView } from './category.js';
import { showEdit, openEditGroup, openEditMySplit } from './addEdit.js';
import { sharedRowsForMonth, sharedMonthTotal, expenseHasPayment } from '../cloudrows.js';
import { markShareDone, deleteGroupExpense } from '../features/groups.js';
import { toastError } from '../toast.js';
import { confirmModal, pickSettlePayment } from '../confirm.js';

export function render() {
  $('mlbl').textContent = MN[state.cur.getMonth()] + ' ' + state.cur.getFullYear();
  const personal = filtered();
  const shared = sharedRowsForMonth(state.cur);
  // Sort by day (newest first), then by actual timestamp within the day so group
  // and personal txns interleave by when they happened — not group-always-on-top.
  const rowTs = (r) => (r.shared ? r.ts : r.updated || r.id || new Date(r.date).getTime());
  const rows = [...personal, ...shared].sort((a, b) => new Date(b.date) - new Date(a.date) || rowTs(b) - rowTs(a));

  // Spent total: personal + settled/paid shared (pending owed rows excluded).
  const total = personal.reduce((s, r) => s + r.amt, 0) + sharedMonthTotal(state.cur);
  $('tot').textContent = fmt(total);

  // Transactions box: when group expenses are in view, show a Settled | Pending
  // split (color-coded) instead of a plain total count.
  // Unsettled = a share you still owe, or one you paid that others haven't settled.
  const unsettled = shared.filter((r) => r.pending || r.badge?.cls === 'shared-pending').length;
  if (shared.length) {
    $('cnt').style.display = 'none';
    $('splitCounts').style.display = 'flex';
    $('scSettled').textContent = rows.length - unsettled;
    $('scPending').textContent = unsettled;
  } else {
    $('cnt').style.display = '';
    $('cnt').textContent = rows.length;
    $('splitCounts').style.display = 'none';
  }

  // Category bars — from personal + non-pending shared rows (owed rows don't count yet).
  const byc = {};
  personal.forEach((r) => {
    byc[r.cat] = (byc[r.cat] || 0) + r.amt;
  });
  shared.forEach((r) => {
    if (!r.pending) byc[r.cat] = (byc[r.cat] || 0) + r.amt;
  });
  const catSec = $('cat-section');
  const catNames = Object.keys(byc);
  catSec.style.display = catNames.length ? 'block' : 'none';
  const mx = Math.max(...Object.values(byc), 1);
  const cbars = $('cbars');
  cbars.innerHTML = '';
  // Ordered: CATS list first (as configured), then any leftover names from records.
  const ordered = state.CATS.map((c) => c.n).filter((n) => byc[n] != null);
  catNames.forEach((n) => {
    if (!ordered.includes(n)) ordered.push(n);
  });
  ordered.forEach((name) => {
    const c = catByName(name);
    const pct = Math.round((byc[name] / mx) * 100);
    const d = document.createElement('div');
    d.className = 'cat-row';
    d.dataset.cat = name;
    d.innerHTML = `<div class="cname">${c.e} ${c.n}</div><div class="bar-wrap"><div class="bar-fill" style="width:${pct}%;background:${c.c}"></div></div><div class="camt">${fmt(byc[name])}</div>`;
    cbars.appendChild(d);
  });

  const tlist = $('tlist');
  if (!rows.length) {
    tlist.innerHTML = '<div class="empty"><span>🧾</span>No expenses this month.<br>Tap + to add one.</div>';
    return;
  }
  renderDateGroups(rows, tlist);
}

export function showHome() {
  $('add').classList.remove('active');
  $('catview').classList.remove('active');
  state.filterCat = null;
  $('home').classList.add('active');
  render();
}

// Re-render whichever list view is currently active (home, plus category if filtered).
function rerender() {
  render();
  if (state.filterCat) renderCategoryView();
}

export function initHome() {
  // Home category-bar clicks -> filtered category view.
  $('cbars').addEventListener('click', (e) => {
    const row = e.target.closest('.cat-row');
    if (row) showCategoryView(row.dataset.cat);
  });
  attachListHandler($('tlist'), {
    onEdit: showEdit,
    rerender,
    onSettle: async (splitId) => {
      const { confirmed, pay } = await pickSettlePayment();
      if (!confirmed) return;
      await markShareDone(splitId, pay);
      rerender();
    },
    onEditGroup: (gid) => openEditGroup(gid),
    onEditMySplit: (sid) => openEditMySplit(sid),
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
