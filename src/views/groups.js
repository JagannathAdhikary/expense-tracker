// Groups screen: a list of the user's groups (with create/join controls), and a
// per-group detail view showing expenses, each member's effective balance, and
// the current user's pending shares with "Mark my share done" buttons.

import { state } from '../state.js';
import { cloudEnabled } from '../supabase.js';
import { fmt } from '../format.js';
import { friendlyDate, payBadge } from '../format.js';
import { $ } from '../dom.js';
import { loadCloudData, markShareDone, deleteGroupExpense, settleWithPayer, deleteGroup } from '../features/groups.js';
import { openEditGroup } from './addEdit.js';
import { expenseHasPayment, owedByUserInGroup, owedToUserInGroup } from '../cloudrows.js';
import { toastError, toastSuccess } from '../toast.js';
import { icon } from '../icons.js';
import { confirmModal, pickSettlePayment } from '../confirm.js';

function memberName(group, userId) {
  const m = group.members.find((x) => x.id === userId);
  return m ? m.name : 'Member';
}

// Splits belonging to a given expense.
const splitsFor = (expId) => state.mySplits.filter((s) => s.expense_id === expId);

// "Wed, 5 Feb · 3:42 PM" — friendly spent-on date plus the recorded time.
function dateTimeLabel(spentOn, createdAt) {
  const label = friendlyDate(spentOn);
  if (!createdAt) return label;
  const t = new Date(createdAt);
  if (isNaN(t)) return label;
  const time = t.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${label} · ${time}`;
}

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

// Show the per-member paid/pending breakdown for a group expense in a modal.
function showBreakdown(expId) {
  const g = state.groups.find((x) => x.id === state.openGroupId);
  const exp = state.groupExpenses.find((e) => e.id === expId);
  if (!g || !exp) return;
  $('breakdownTitle').textContent = exp.description || 'Who’s paid';
  const rows = splitsFor(expId)
    .slice()
    .sort((a, b) => (a.debtor_id === exp.payer_id ? -1 : b.debtor_id === exp.payer_id ? 1 : 0))
    .map((s) => {
      const isPayer = s.debtor_id === exp.payer_id;
      const name = memberName(g, s.debtor_id) + (s.debtor_id === state.user?.id ? ' (you)' : '');
      const badge = isPayer
        ? '<span class="pay-badge pay-custom">paid all</span>'
        : s.status === 'done'
          ? '<span class="pay-badge shared-done">paid ✓</span>'
          : '<span class="pay-badge shared-pending">pending</span>';
      return `<div class="cat-manage-row"><div class="cm-name">${name}</div><span class="cm-count">${fmt(s.share_amount)}</span>${badge}</div>`;
    })
    .join('');
  $('breakdownList').innerHTML = rows || '<div style="color:#888;font-size:13px">No splits.</div>';
  $('breakdownModal').classList.add('open');
}

function renderGroupDetail() {
  const g = state.groups.find((x) => x.id === state.openGroupId);
  if (!g) {
    // Group no longer available — go home and reopen the list popover.
    state.openGroupId = null;
    $('groups').classList.remove('active');
    $('home').classList.add('active');
    return;
  }
  $('groupDetailTitle').textContent = g.name;
  $('groupInviteCode').textContent = g.invite_code;
  $('copyCodeBtn').innerHTML = icon.copy({ size: 15 });
  // Owner-only delete-group action in the header. Keep it in layout (hidden) for
  // non-owners so the title stays centered.
  const delGroupBtn = $('deleteGroupBtn');
  delGroupBtn.innerHTML = icon.trash({ size: 18 });
  delGroupBtn.style.display = '';
  delGroupBtn.style.visibility = g.role === 'owner' ? 'visible' : 'hidden';

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

  // "Owed to you" summary: who still owes the current user, per person.
  const owedTo = owedToUserInGroup(g.id);
  if (owedTo.total > 0) {
    const rows = owedTo.byDebtor
      .map((o) => `<div class="owe-row"><span class="owe-name">${memberName(g, o.debtorId)}</span><span class="owe-amt owed-to">${fmt(o.amount)}</span></div>`)
      .join('');
    $('groupOwedTo').innerHTML = `
      <div class="owe-card owed-to-card">
        <div class="owe-head owed-to-head"><span>Owed to you</span><span class="owe-total">${fmt(owedTo.total)}</span></div>
        ${rows}
      </div>`;
  } else {
    $('groupOwedTo').innerHTML = '';
  }

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
          // No "you paid" text (the meta line already says "You paid X"); show a
          // tappable pending count / settled badge that opens the breakdown.
          const pend = splitsFor(e.id).filter((s) => s.debtor_id !== state.user?.id && s.status === 'pending').length;
          action =
            pend > 0
              ? `<button class="pay-badge status-btn shared-pending" data-breakdown="${e.id}">${pend} pending</button>`
              : `<button class="pay-badge status-btn shared-done" data-breakdown="${e.id}">all settled</button>`;
        }
        const editBtn = iPaid ? `<button class="icon-btn gedit" data-gid="${e.id}" title="Edit" aria-label="Edit">${icon.edit({ size: 17 })}</button>` : '';
        const delBtn = iPaid && !expenseHasPayment(e.id) ? `<button class="icon-btn gdel" data-gid="${e.id}" title="Delete" aria-label="Delete">${icon.trash({ size: 17 })}</button>` : '';
        // Line 1: note/title. Line 2: "<Person> paid <amount>". Line 3: date · time.
        const who = iPaid ? 'You' : memberName(g, e.payer_id);
        const when = dateTimeLabel(e.spent_on, e.created_at);
        // Payment method: payer sees how they paid (e.pay); a debtor sees only
        // their own settlement method (mine.pay), never the payer's.
        const payMethod = iPaid ? e.pay : mine && mine.pay;
        const rowClass = iPaid ? 'txn ge-row ge-paid' : mine && mine.status === 'pending' ? 'txn ge-row ge-owe' : 'txn ge-row';
        return `<div class="${rowClass}">
          <div class="txn-ico" style="background:#eef1f620">🧾</div>
          <div class="txn-info">
            <div class="txn-desc">${e.description || 'Expense'}</div>
            <div class="txn-meta ge-payer">${who} paid ${fmt(e.amount)}${payBadge(payMethod)}</div>
            <div class="txn-meta ge-when">${when}</div>
          </div>
          <div class="ge-actions">${action}<div class="ge-btns">${editBtn}${delBtn}</div></div>
        </div>`;
      })
      .join('');
  }
}

// Open the Groups popover (list + create/join). Group detail remains a full page.
export function showGroups() {
  $('overlay').classList.remove('open');
  loadCloudData(); // refresh in background; onGroupData re-renders the list
  if (!cloudEnabled()) {
    $('groupsAuthGate').style.display = 'block';
    $('groupsContent').style.display = 'none';
    $('groupsAuthGate').textContent = 'Cloud sync is not configured, so group features are unavailable.';
  } else if (!state.user) {
    $('groupsAuthGate').style.display = 'block';
    $('groupsContent').style.display = 'none';
    $('groupsAuthGate').textContent = 'Sign in with Google (menu → Sign in) to create and join groups.';
  } else {
    $('groupsAuthGate').style.display = 'none';
    $('groupsContent').style.display = 'block';
    renderGroupList();
  }
  $('groupsOverlay').classList.add('open');
}

function closeGroupsPopover() {
  $('groupsOverlay').classList.remove('open');
}

// Open a group's full detail page (from the popover).
function showGroupDetail(id) {
  state.openGroupId = id;
  closeGroupsPopover();
  ['home', 'catview', 'add'].forEach((sid) => $(sid).classList.remove('active'));
  $('groups').classList.add('active');
  renderGroupDetail();
}

// Re-render whatever group view is currently visible (called on cloud data reload).
export function refreshGroupsView() {
  if ($('groupsOverlay').classList.contains('open') && state.user) renderGroupList();
  if ($('groups').classList.contains('active') && state.openGroupId) renderGroupDetail();
}

export function initGroupsView() {
  // Groups screen (detail) back button -> home.
  $('groupsBackBtn').onclick = () => {
    state.openGroupId = null;
    $('groups').classList.remove('active');
    $('home').classList.add('active');
  };
  // Owner deletes the whole group.
  $('deleteGroupBtn').onclick = async () => {
    const g = state.groups.find((x) => x.id === state.openGroupId);
    if (!g) return;
    if (!(await confirmModal(`Delete the group "${g.name}"? This permanently removes it and all its expenses for everyone. This cannot be undone.`, { title: 'Delete group', confirmLabel: 'Delete group', danger: true }))) return;
    const ok = await deleteGroup(g.id);
    if (ok) {
      state.openGroupId = null;
      $('groups').classList.remove('active');
      $('home').classList.add('active');
      toastSuccess('Group deleted');
    }
  };
  // Popover close + backdrop click.
  $('closeGroupsSheet').innerHTML = icon.close({ size: 20 });
  $('closeGroupsSheet').onclick = closeGroupsPopover;
  $('groupsOverlay').onclick = (e) => {
    if (e.target === $('groupsOverlay')) closeGroupsPopover();
  };

  $('groupList').addEventListener('click', (e) => {
    const row = e.target.closest('.group-row');
    if (row) showGroupDetail(row.dataset.group);
  });

  // Copy the invite code to the clipboard.
  $('copyCodeBtn').onclick = async () => {
    const code = $('groupInviteCode').textContent.trim();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toastSuccess('Invite code copied');
    } catch (err) {
      toastError('Could not copy — code is ' + code);
    }
  };

  $('groupOwe').addEventListener('click', async (e) => {
    const btn = e.target.closest('.owe-settle');
    if (!btn) return;
    const g = state.groups.find((x) => x.id === state.openGroupId);
    const name = g ? memberName(g, btn.dataset.payer) : 'this person';
    if (!(await confirmModal(`Settle everything you owe ${name}? This marks all your pending shares to them as paid.`, { title: 'Settle up', confirmLabel: 'Continue' }))) return;
    const { confirmed, pay } = await pickSettlePayment();
    if (!confirmed) return;
    await settleWithPayer(state.openGroupId, btn.dataset.payer, pay);
    renderGroupDetail();
  });

  $('groupExpenseList').addEventListener('click', async (e) => {
    const breakdownBtn = e.target.closest('[data-breakdown]');
    if (breakdownBtn) {
      showBreakdown(breakdownBtn.dataset.breakdown);
      return;
    }
    const editBtn = e.target.closest('.gedit');
    if (editBtn) {
      openEditGroup(editBtn.dataset.gid);
      return;
    }
    const delBtn = e.target.closest('.gdel');
    if (delBtn) {
      const gid = delBtn.dataset.gid;
      if (expenseHasPayment(gid)) {
        toastError('This expense already has a settled share, so it can no longer be deleted.');
        return;
      }
      if (!(await confirmModal('Delete this group expense for everyone? This cannot be undone.', { title: 'Delete expense', confirmLabel: 'Delete', danger: true }))) return;
      await deleteGroupExpense(gid);
      renderGroupDetail();
      return;
    }
    const btn = e.target.closest('[data-settle]');
    if (!btn) return;
    const { confirmed, pay } = await pickSettlePayment();
    if (!confirmed) return;
    await markShareDone(btn.dataset.settle, pay);
    renderGroupDetail();
  });

  // Breakdown modal close.
  $('breakdownClose').innerHTML = icon.close({ size: 20 });
  $('breakdownClose').onclick = () => $('breakdownModal').classList.remove('open');
  $('breakdownModal').onclick = (e) => {
    if (e.target === $('breakdownModal')) $('breakdownModal').classList.remove('open');
  };
}
