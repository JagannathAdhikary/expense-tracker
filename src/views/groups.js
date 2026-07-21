// Groups screen: a list of the user's groups (with create/join controls), and a
// per-group detail view showing expenses, each member's effective balance, and
// the current user's pending shares with "Mark my share done" buttons.

import { state } from '../state.js';
import { cloudEnabled } from '../supabase.js';
import { fmt } from '../format.js';
import { $ } from '../dom.js';
import { loadCloudData, markShareDone, deleteGroupExpense, settleWithPayer } from '../features/groups.js';
import { netForUser } from '../split.js';
import { openEditGroup } from './addEdit.js';
import { expenseHasPayment, owedByUserInGroup } from '../cloudrows.js';

function memberName(group, userId) {
  const m = group.members.find((x) => x.id === userId);
  return m ? m.name : 'Member';
}

// Splits belonging to a given expense.
const splitsFor = (expId) => state.mySplits.filter((s) => s.expense_id === expId);

function renderGroupList() {
  const wrap = $('groupList');
  if (state.groups.length === 0) {
    wrap.innerHTML = '<div class="empty"><span>👥</span>No groups yet.<br>Create one or join with a code.</div>';
    return;
  }
  wrap.innerHTML = state.groups
    .map((g) => {
      const expCount = state.groupExpenses.filter((e) => e.group_id === g.id).length;
      return `<div class="txn group-row" data-group="${g.id}">
        <div class="txn-ico" style="background:#eef1f6">👥</div>
        <div class="txn-info">
          <div class="txn-desc">${g.name}</div>
          <div class="txn-meta">${g.members.length} member${g.members.length === 1 ? '' : 's'} · ${expCount} expense${expCount === 1 ? '' : 's'}</div>
        </div>
        <span class="chevron">›</span>
      </div>`;
    })
    .join('');
}

function renderGroupDetail() {
  const g = state.groups.find((x) => x.id === state.openGroupId);
  if (!g) {
    showGroupsList();
    return;
  }
  $('groupDetailTitle').textContent = g.name;
  $('groupInviteCode').textContent = g.invite_code;

  // "You owe" summary: per-creditor totals with a one-tap settle-all button.
  const owe = owedByUserInGroup(g.id);
  if (owe.total > 0) {
    const rows = owe.byPayer
      .map((o) => {
        const name = memberName(g, o.payerId);
        return `<div class="owe-row">
          <span class="owe-name">${name}</span>
          <span class="owe-amt">${fmt(o.amount)}</span>
          <button class="owe-settle" data-payer="${o.payerId}">Settle</button>
        </div>`;
      })
      .join('');
    $('groupOwe').innerHTML = `
      <div class="owe-card">
        <div class="owe-head"><span>You owe</span><span class="owe-total">${fmt(owe.total)}</span></div>
        ${rows}
      </div>`;
  } else {
    $('groupOwe').innerHTML = '';
  }

  const exps = state.groupExpenses.filter((e) => e.group_id === g.id);
  const expIds = new Set(exps.map((e) => e.id));
  const splits = state.mySplits.filter((s) => expIds.has(s.expense_id));

  // Per-member effective balances.
  const balances = g.members
    .map((m) => `<div class="cat-manage-row"><div class="cm-ico" style="background:#eef1f6">${m.avatar ? `<img src="${m.avatar}" style="width:34px;height:34px;border-radius:50%"/>` : '👤'}</div><div class="cm-name">${m.name}${m.id === state.user?.id ? ' (you)' : ''}</div><span class="cm-count">${fmt(netForUser(exps, splits, m.id))}</span></div>`)
    .join('');
  $('groupBalances').innerHTML = balances || '<div style="color:#888;font-size:13px">No members.</div>';

  // Expense list with the current user's split status / settle action.
  if (!exps.length) {
    $('groupExpenseList').innerHTML = '<div class="empty"><span>🧾</span>No group expenses yet.</div>';
  } else {
    $('groupExpenseList').innerHTML = exps
      .map((e) => {
        const mine = splitsFor(e.id).find((s) => s.debtor_id === state.user?.id);
        const iPaid = e.payer_id === state.user?.id;
        let action = '';
        if (mine && !iPaid) {
          action =
            mine.status === 'pending'
              ? `<button class="chip" data-settle="${mine.id}" style="border-color:#C0392B;color:#C0392B">Owe ${fmt(mine.share_amount)} · Mark done</button>`
              : `<span class="pay-badge" style="background:#e9f7ef;color:#1a6b3a">settled ${fmt(mine.share_amount)}</span>`;
        } else if (iPaid) {
          const pend = splitsFor(e.id).filter((s) => s.debtor_id !== state.user?.id && s.status === 'pending').length;
          action = `<span class="pay-badge pay-custom">you paid${pend ? ` · ${pend} pending` : ' · all settled'}</span>`;
        }
        const editBtn = iPaid ? `<button class="icon-btn gedit" data-gid="${e.id}" title="Edit">✏️</button>` : '';
        const delBtn = iPaid ? `<button class="icon-btn gdel" data-gid="${e.id}" title="Delete">×</button>` : '';
        return `<div class="txn">
          <div class="txn-ico" style="background:#eef1f620">🧾</div>
          <div class="txn-info">
            <div class="txn-desc">${e.description || 'Expense'}</div>
            <div class="txn-meta">${memberName(g, e.payer_id)} paid ${fmt(e.amount)} · ${e.spent_on}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">${action}${editBtn}${delBtn}</div>
        </div>`;
      })
      .join('');
  }
}

export function showGroups() {
  $('overlay').classList.remove('open');
  ['home', 'catview', 'add'].forEach((id) => $(id).classList.remove('active'));
  $('groups').classList.add('active');
  if (!cloudEnabled()) {
    $('groupsAuthGate').style.display = 'block';
    $('groupsContent').style.display = 'none';
    $('groupsAuthGate').textContent = 'Cloud sync is not configured, so group features are unavailable.';
    return;
  }
  if (!state.user) {
    $('groupsAuthGate').style.display = 'block';
    $('groupsContent').style.display = 'none';
    $('groupsAuthGate').textContent = 'Sign in with Google (Options → Sign in) to create and join groups.';
    return;
  }
  $('groupsAuthGate').style.display = 'none';
  $('groupsContent').style.display = 'block';
  showGroupsList();
  loadCloudData(); // refresh in background; onGroupData re-renders
}

function showGroupsList() {
  state.openGroupId = null;
  $('groupDetail').style.display = 'none';
  $('groupsMain').style.display = 'block';
  renderGroupList();
}

function showGroupDetail(id) {
  state.openGroupId = id;
  $('groupsMain').style.display = 'none';
  $('groupDetail').style.display = 'block';
  renderGroupDetail();
}

// Re-render whatever groups view is currently visible (called on cloud data reload).
export function refreshGroupsView() {
  if (!$('groups').classList.contains('active')) return;
  if (state.openGroupId) renderGroupDetail();
  else renderGroupList();
}

export function initGroupsView() {
  $('groupsBackBtn').onclick = () => {
    ['groups', 'catview', 'add'].forEach((id) => $(id).classList.remove('active'));
    $('home').classList.add('active');
  };
  $('groupDetailBackBtn').onclick = showGroupsList;

  $('groupList').addEventListener('click', (e) => {
    const row = e.target.closest('.group-row');
    if (row) showGroupDetail(row.dataset.group);
  });

  $('groupOwe').addEventListener('click', async (e) => {
    const btn = e.target.closest('.owe-settle');
    if (!btn) return;
    const g = state.groups.find((x) => x.id === state.openGroupId);
    const name = g ? memberName(g, btn.dataset.payer) : 'this person';
    if (!confirm(`Settle everything you owe ${name}? This marks all your pending shares to them as paid.`)) return;
    await settleWithPayer(state.openGroupId, btn.dataset.payer);
    renderGroupDetail();
  });

  $('groupExpenseList').addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.gedit');
    if (editBtn) {
      openEditGroup(editBtn.dataset.gid);
      return;
    }
    const delBtn = e.target.closest('.gdel');
    if (delBtn) {
      const gid = delBtn.dataset.gid;
      if (expenseHasPayment(gid)) {
        alert('This expense already has a settled share, so it can no longer be deleted.');
        return;
      }
      if (!confirm('Delete this group expense for everyone? This cannot be undone.')) return;
      await deleteGroupExpense(gid);
      renderGroupDetail();
      return;
    }
    const btn = e.target.closest('[data-settle]');
    if (!btn) return;
    if (!confirm('Mark your share as settled? This records that you have paid it back.')) return;
    await markShareDone(btn.dataset.settle);
    renderGroupDetail();
  });
}
