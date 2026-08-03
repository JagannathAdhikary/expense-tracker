// Groups screen: a list of the user's groups (with create/join controls), and a
// per-group detail view showing expenses, each member's effective balance, and
// the current user's pending shares with "Mark my share done" buttons.

import { state } from '../state.js';
import { cloudEnabled } from '../supabase.js';
import { fmt } from '../format.js';
import { friendlyDate, payBadge } from '../format.js';
import { $ } from '../dom.js';
import { loadCloudData, markShareDone, deleteGroupExpense, settleUpWithMember, deleteGroup } from '../features/groups.js';
import { openEditGroup, showAddForGroup } from './addEdit.js';
import { expenseHasPayment, owedByUserInGroup, owedToUserInGroup } from '../cloudrows.js';
import { toastError, toastSuccess } from '../toast.js';
import { icon } from '../icons.js';
import { confirmModal, pickSettlePayment } from '../confirm.js';
import { setGroupIcon } from '../features/groups.js';

// Preset icons + colors for the group icon editor.
const GROUP_ICONS = ['👥', '🏠', '✈️', '🍽️', '🎉', '🛒', '🏖️', '🏔️', '🎬', '⚽', '🎓', '💼', '🚗', '🏥', '🐾', '💡'];
const GROUP_COLORS = ['#1E3A5F', '#1A6B3A', '#7D3C98', '#C0392B', '#D35400', '#0E6655', '#2874A6', '#B7950B', '#CA6F1E', '#5B2C6F', '#34495E', '#808B96'];
const DEFAULT_GROUP_ICON = '👥';
const DEFAULT_GROUP_COLOR = '#1E3A5F';

const groupIcon = (g) => g.icon || DEFAULT_GROUP_ICON;
const groupColor = (g) => g.color || DEFAULT_GROUP_COLOR;

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
        <div class="txn-ico" style="background:${groupColor(g)}20">${groupIcon(g)}</div>
        <div class="txn-info">
          <div class="txn-desc">${g.name}</div>
          <div class="txn-meta">${g.members.length} member${g.members.length === 1 ? '' : 's'} · ${expCount} expense${expCount === 1 ? '' : 's'}</div>
        </div>
        <span class="chevron">›</span>
      </div>`;
    })
    .join('');
}

// Show a group expense's full details in a modal. Works for every expense:
//  - one you paid: basics + the per-member "who's settled / still pending" list.
//  - one you owe: basics + your share, plus a "Mark done" button while pending.
function showExpenseDetail(expId) {
  const g = state.groups.find((x) => x.id === state.openGroupId);
  const exp = state.groupExpenses.find((e) => e.id === expId);
  if (!g || !exp) return;

  const iPaid = exp.payer_id === state.user?.id;
  const mine = splitsFor(expId).find((s) => s.debtor_id === state.user?.id);
  const who = iPaid ? 'You' : memberName(g, exp.payer_id);
  const when = dateTimeLabel(exp.spent_on, exp.created_at);
  // Payer sees how they paid; a debtor sees only their own settlement method.
  const payMethod = iPaid ? exp.pay : mine && mine.pay;

  $('breakdownTitle').textContent = exp.description || 'Expense details';

  // Basic details block — shown for every expense.
  const metaRows = [
    { label: 'Date', value: when },
    { label: iPaid ? 'You paid' : `${who} paid`, value: fmt(exp.amount) + payBadge(payMethod) },
  ];
  if (mine) metaRows.push({ label: 'Your share', value: fmt(mine.share_amount) });
  $('expDetailMeta').innerHTML = metaRows
    .map((r) => `<div class="edm-row"><span class="edm-label">${r.label}</span><span class="edm-value">${r.value}</span></div>`)
    .join('');

  // Per-member breakdown — only meaningful for the payer (who's paid them back).
  const wrap = $('expDetailBreakdownWrap');
  if (iPaid) {
    wrap.style.display = '';
    $('expDetailListLabel').textContent = 'Split breakdown';
    const rows = splitsFor(expId)
      .slice()
      .sort((a, b) => (a.debtor_id === exp.payer_id ? -1 : b.debtor_id === exp.payer_id ? 1 : 0))
      .map((s) => {
        const isPayer = s.debtor_id === exp.payer_id;
        const name = memberName(g, s.debtor_id) + (s.debtor_id === state.user?.id ? ' (you)' : '');
        // The payer fronted the whole expense; everyone else is settled or pending.
        const badge = isPayer
          ? '<span class="pay-badge pay-custom">paid in full</span>'
          : s.status === 'done'
            ? '<span class="pay-badge shared-done">settled ✓</span>'
            : '<span class="pay-badge shared-pending">pending</span>';
        return `<div class="cat-manage-row"><div class="cm-name">${name}</div><span class="cm-count">${fmt(s.share_amount)}</span>${badge}</div>`;
      })
      .join('');
    $('breakdownList').innerHTML = rows || '<div style="color:#888;font-size:13px">No splits.</div>';
  } else {
    wrap.style.display = 'none';
    $('breakdownList').innerHTML = '';
  }

  // Action footer — a full-width "Mark done" for a pending share you owe, or a
  // status badge once it's settled.
  const action = $('expDetailAction');
  if (mine && !iPaid) {
    action.innerHTML =
      mine.status === 'pending'
        ? `<button class="exp-detail-settle" data-settle="${mine.id}">Settle your share ${fmt(mine.share_amount)}</button>`
        : `<div class="exp-detail-done">Settled ${fmt(mine.share_amount)} ✓</div>`;
  } else {
    action.innerHTML = '';
  }

  $('breakdownModal').classList.add('open');
}

// Group icon editor — presets + custom emoji + color, editable by any member.
let giSelIcon = DEFAULT_GROUP_ICON;
let giSelColor = DEFAULT_GROUP_COLOR;

function renderIconModal() {
  $('giconPresets').innerHTML = GROUP_ICONS.map((e) => `<div class="chip gicon-chip${e === giSelIcon ? ' on' : ''}" data-icon="${e}" style="font-size:20px">${e}</div>`).join('');
  $('giconSwatches').innerHTML = GROUP_COLORS.map((c) => `<div class="swatch${c === giSelColor ? ' on' : ''}" data-c="${c}" style="background:${c}"></div>`).join('');
  const prev = $('giconPreview');
  prev.textContent = giSelIcon;
  prev.style.background = giSelColor + '20';
}

function openGroupIconModal() {
  const g = state.groups.find((x) => x.id === state.openGroupId);
  if (!g) return;
  giSelIcon = groupIcon(g);
  giSelColor = groupColor(g);
  $('giconCustom').value = '';
  renderIconModal();
  $('groupIconModal').classList.add('open');
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
  // Big group icon (tap to edit — any member).
  const bigIco = $('groupIconBig');
  bigIco.textContent = groupIcon(g);
  bigIco.style.background = groupColor(g) + '20';
  $('groupIconEditBadge').innerHTML = icon.edit({ size: 13 });
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

  // Most recent first. spent_on is date-only (ties on the same day), so break ties
  // by created_at — the actual record time — newest at the top.
  const exps = state.groupExpenses
    .filter((e) => e.group_id === g.id)
    .slice()
    .sort((a, b) => {
      const at = a.created_at ? new Date(a.created_at).getTime() : new Date(a.spent_on).getTime();
      const bt = b.created_at ? new Date(b.created_at).getTime() : new Date(b.spent_on).getTime();
      return new Date(b.spent_on) - new Date(a.spent_on) || bt - at;
    });

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
        // Status pill (compact, top-right). For a pending share you owe, the
        // full "Mark done" footer button below carries the amount, so no pill.
        let status = '';
        if (mine && !iPaid) {
          if (mine.status !== 'pending') status = `<span class="pay-badge shared-done">settled ✓</span>`;
        } else if (iPaid) {
          const pend = splitsFor(e.id).filter((s) => s.debtor_id !== state.user?.id && s.status === 'pending').length;
          status =
            pend > 0
              ? `<span class="pay-badge shared-pending">${pend} pending</span>`
              : `<span class="pay-badge shared-done">all settled</span>`;
        }
        // Full-width footer action: a pending share you owe gets its own settle
        // button here (never truncated); everything else opens details on tap.
        const footer =
          mine && !iPaid && mine.status === 'pending'
            ? `<button class="ge-settle-btn" data-settle="${mine.id}">Settle your share ${fmt(mine.share_amount)}</button>`
            : '';
        const editBtn = iPaid ? `<button class="icon-btn gedit" data-gid="${e.id}" title="Edit" aria-label="Edit">${icon.edit({ size: 17 })}</button>` : '';
        const delBtn = iPaid && !expenseHasPayment(e.id) ? `<button class="icon-btn gdel" data-gid="${e.id}" title="Delete" aria-label="Delete">${icon.trash({ size: 17 })}</button>` : '';
        // Line 1: note/title. Line 2: "<Person> paid <amount>". Line 3: date · time.
        const who = iPaid ? 'You' : memberName(g, e.payer_id);
        const when = dateTimeLabel(e.spent_on, e.created_at);
        // Payment method: payer sees how they paid (e.pay); a debtor sees only
        // their own settlement method (mine.pay), never the payer's.
        const payMethod = iPaid ? e.pay : mine && mine.pay;
        // Every row is tappable to open its detail popup.
        const rowClass = iPaid ? 'txn ge-row ge-paid ge-open' : mine && mine.status === 'pending' ? 'txn ge-row ge-owe ge-open' : 'txn ge-row ge-open';
        return `<div class="${rowClass}" data-exp-id="${e.id}" data-detail="${e.id}" role="button" tabindex="0" title="View details">
          <div class="ge-main">
            <div class="txn-ico" style="background:#eef1f620">🧾</div>
            <div class="txn-info">
              <div class="txn-desc">${e.description || 'Expense'}</div>
              <div class="txn-meta ge-payer">${who} paid ${fmt(e.amount)}${payBadge(payMethod)}</div>
              <div class="txn-meta ge-when">${when}</div>
            </div>
            <div class="ge-actions">${status}<div class="ge-btns">${editBtn}${delBtn}</div></div>
          </div>
          ${footer}
        </div>`;
      })
      .join('');
  }

  // If we arrived here focused on a specific expense (tapped from the main list),
  // scroll it into view and flash a highlight, then clear the focus.
  if (state.focusGroupExpId) {
    const target = $('groupExpenseList').querySelector(`[data-exp-id="${state.focusGroupExpId}"]`);
    state.focusGroupExpId = null;
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('ge-flash');
      setTimeout(() => target.classList.remove('ge-flash'), 1600);
    }
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

// Open a group's full detail page (from the popover, or a group txn row).
// `focusExpId` (optional): scroll to and flash that expense once rendered.
export function showGroupDetail(id, focusExpId = null) {
  state.openGroupId = id;
  state.focusGroupExpId = focusExpId;
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
  // "+" on the group detail page: add an expense pre-tagged to this group.
  // Use the same SVG plus icon as the main FAB (header.js) so they match.
  $('groupAddBtn').innerHTML = icon.plus({ size: 28 });
  $('groupAddBtn').onclick = () => {
    if (state.openGroupId) showAddForGroup(state.openGroupId);
  };
  // Group icon editor (any member).
  $('groupIconBtn').onclick = openGroupIconModal;
  $('giconPresets').addEventListener('click', (e) => {
    const chip = e.target.closest('.gicon-chip');
    if (!chip) return;
    giSelIcon = chip.dataset.icon;
    $('giconCustom').value = '';
    renderIconModal();
  });
  $('giconCustom').addEventListener('input', (e) => {
    const v = e.target.value.trim();
    if (v) {
      giSelIcon = v;
      renderIconModal();
    }
  });
  $('giconSwatches').addEventListener('click', (e) => {
    const sw = e.target.closest('.swatch');
    if (!sw) return;
    giSelColor = sw.dataset.c;
    renderIconModal();
  });
  $('giconCancel').onclick = () => $('groupIconModal').classList.remove('open');
  $('groupIconModal').onclick = (e) => {
    if (e.target === $('groupIconModal')) $('groupIconModal').classList.remove('open');
  };
  $('giconSave').onclick = async () => {
    const custom = $('giconCustom').value.trim();
    const chosen = custom || giSelIcon;
    const ok = await setGroupIcon(state.openGroupId, { icon: chosen, color: giSelColor });
    if (ok) {
      $('groupIconModal').classList.remove('open');
      renderGroupDetail();
    }
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
    if (!(await confirmModal(`Settle up with ${name}? This clears everything between you two — what you owe them and what they owe you.`, { title: 'Settle up', confirmLabel: 'Continue' }))) return;
    const { confirmed, pay } = await pickSettlePayment();
    if (!confirmed) return;
    await settleUpWithMember(state.openGroupId, btn.dataset.payer, pay);
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
        toastError('This expense already has a settled share, so it can no longer be deleted.');
        return;
      }
      if (!(await confirmModal('Delete this group expense for everyone? This cannot be undone.', { title: 'Delete expense', confirmLabel: 'Delete', danger: true }))) return;
      await deleteGroupExpense(gid);
      renderGroupDetail();
      return;
    }
    // Footer "Mark done" button on the row itself.
    const settleBtn = e.target.closest('[data-settle]');
    if (settleBtn) {
      const { confirmed, pay } = await pickSettlePayment();
      if (!confirmed) return;
      await markShareDone(settleBtn.dataset.settle, pay);
      renderGroupDetail();
      return;
    }
    // Fall through: tapping the row (anywhere else) opens the detail popup.
    // Checked last so the action buttons above win.
    const detail = e.target.closest('[data-detail]');
    if (detail) showExpenseDetail(detail.dataset.detail);
  });

  // Detail modal: "Mark done" button settles the current user's share, then
  // closes the modal and re-renders.
  $('expDetailAction').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-settle]');
    if (!btn) return;
    const { confirmed, pay } = await pickSettlePayment();
    if (!confirmed) return;
    await markShareDone(btn.dataset.settle, pay);
    $('breakdownModal').classList.remove('open');
    renderGroupDetail();
  });

  // Detail modal close.
  $('breakdownClose').innerHTML = icon.close({ size: 20 });
  $('breakdownClose').onclick = () => $('breakdownModal').classList.remove('open');
  $('breakdownModal').onclick = (e) => {
    if (e.target === $('breakdownModal')) $('breakdownModal').classList.remove('open');
  };
}
