// Groups screen: a list of the user's groups (with create/join controls), and a
// per-group detail view showing expenses, each member's effective balance, and
// the current user's pending shares with "Mark my share done" buttons.

import { state, groupCollapsed } from '../state.js';
import { cloudEnabled } from '../supabase.js';
import { fmt } from '../format.js';
import { friendlyDate, payBadge } from '../format.js';
import { $ } from '../dom.js';
import { loadCloudData, markShareDone, deleteGroupExpense, settleUpWithMember, deleteGroup, setGroupRetired, myFriends, addMemberToGroup } from '../features/groups.js';
import { openEditGroup, showAddForGroup } from './addEdit.js';
import { expenseHasPayment, owedByUserInGroup, owedToUserInGroup, totalShareInGroup } from '../cloudrows.js';
import { toastError, toastSuccess } from '../toast.js';
import { icon } from '../icons.js';
import { matchFriends } from '../friends.js';
import { confirmModal, pickSettlePayment } from '../confirm.js';
import { setGroupIcon, renameGroup } from '../features/groups.js';
import { navTo, navBack } from '../nav.js';
import { renderForScreen } from './nav-render.js';
import { buildUpiLink } from '../upi.js';
import { pendingProfileActions, openProfileEdit } from '../features/profile.js';

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

// Colored initial-circle palette for avatar fallbacks (no photo). Deterministic
// per user id so a person keeps the same color across expenses.
const AVATAR_COLORS = ['#1E3A5F', '#1A6B3A', '#7D3C98', '#C0392B', '#D35400', '#0E6655', '#2874A6', '#B7950B', '#CA6F1E', '#5B2C6F'];
function avatarColor(userId) {
  const s = String(userId);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// Render a member's avatar (photo if available, else a colored initial circle).
// `extraClass` lets callers size it (e.g. the expense-tile icon slot).
function memberAvatar(group, userId, extraClass = '') {
  const m = group.members.find((x) => x.id === userId);
  const name = m ? m.name : 'Member';
  const cls = `member-avatar${extraClass ? ' ' + extraClass : ''}`;
  if (m && m.avatar) return `<span class="${cls}"><img src="${m.avatar}" alt="" referrerpolicy="no-referrer"/></span>`;
  return `<span class="${cls}" style="background:${avatarColor(userId)}">${(name || '?').charAt(0).toUpperCase()}</span>`;
}

// Splits belonging to a given expense.
const splitsFor = (expId) => state.mySplits.filter((s) => s.expense_id === expId);

// Build the invite link + friendly share text for a group. The link carries the
// invite code as ?join=CODE; opening it (when signed in) auto-joins the group.
function buildInvite(g) {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin).href.replace(/\/$/, '');
  const url = `${base}/?join=${encodeURIComponent(g.invite_code)}`;
  const text = `Join my expense group "${g.name}" on Expense Tracker. Tap the link to join, or use code ${g.invite_code}.`;
  return { url, text };
}

// Settle a single expense share: confirm first (so a tap can't commit money
// by accident), then pick a payment method, then mark done. Returns true if it
// actually settled, so callers can close a modal / re-render only on success.
// Exported so the main transaction list can reuse the same rich flow.
export async function confirmAndSettleShare(splitId) {
  const split = state.mySplits.find((s) => s.id === splitId);
  const amt = split ? fmt(split.share_amount) : 'your share';
  // Offer to pay the expense's payer via UPI first (if they have a UPI ID).
  if (split) {
    const exp = state.groupExpenses.find((e) => e.id === split.expense_id);
    const g = exp && state.groups.find((x) => x.id === exp.group_id);
    if (exp && g && exp.payer_id !== state.user?.id) {
      // Note: "<group>: <expense title>" so the payer sees what it's for.
      const title = exp.description || 'Group expense';
      await offerUpiPay(g, exp.payer_id, Number(split.share_amount), `${g.name}: ${title}`);
    }
  }
  if (!(await confirmModal(`Mark your share of ${amt} as settled? Do this once you've actually paid it back.`, { title: 'Settle share', confirmLabel: 'Continue' }))) return false;
  const { confirmed, pay } = await pickSettlePayment();
  if (!confirmed) return false;
  await markShareDone(splitId, pay);
  return true;
}

// If the payee has a UPI ID, offer to open a UPI app pre-filled to pay them. This
// only launches the payment — it can't confirm success, so the caller still runs
// the normal "mark settled" step afterward. No-op (returns silently) when the
// payee has no UPI ID or we're not on a device that resolves upi:// links.
async function offerUpiPay(group, payeeId, amount, note) {
  const payee = group?.members.find((m) => m.id === payeeId);
  const link = payee && payee.upi ? buildUpiLink({ pa: payee.upi, pn: payee.name, amount, note }) : null;
  if (!link) return; // no UPI id / invalid -> skip straight to manual settle
  const name = payee.name;
  const ok = await confirmModal(`Pay ${fmt(amount)} to ${name} (${payee.upi}) via UPI? This opens your UPI app — come back and confirm once it's done.`, {
    title: 'Pay via UPI',
    confirmLabel: 'Open UPI app',
    cancelLabel: 'Skip',
  });
  if (ok) {
    // Launch the UPI app chooser (Android). Harmless no-op link elsewhere.
    window.location.href = link;
  }
}

// "Wed, 5 Feb · 3:42 PM" — friendly spent-on date plus the recorded time.
function dateTimeLabel(spentOn, createdAt) {
  const label = friendlyDate(spentOn);
  if (!createdAt) return label;
  const t = new Date(createdAt);
  if (isNaN(t)) return label;
  const time = t.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${label} · ${time}`;
}

// Which group tab is showing in the popover: 'active' | 'retired'.
let groupTab = 'active';

function renderGroupList() {
  const wrap = $('groupList');
  const active = state.groups.filter((g) => !g.retired);
  const retired = state.groups.filter((g) => g.retired);

  // Show the Retired tab only when some exist; if the retired tab is selected
  // but nothing's left retired, fall back to active.
  const retiredTab = $('grpTabs').querySelector('[data-tab="retired"]');
  retiredTab.style.display = retired.length ? '' : 'none';
  if (groupTab === 'retired' && !retired.length) groupTab = 'active';
  $('grpTabs').querySelectorAll('.grp-tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === groupTab));

  if (state.groups.length === 0) {
    wrap.innerHTML = '<div class="empty"><span>👥</span>No groups yet.<br>Create one or join with a code.</div>';
    return;
  }

  const shown = groupTab === 'retired' ? retired : active;
  if (!shown.length) {
    wrap.innerHTML = '<div class="empty"><span>👥</span>No groups here.</div>';
    return;
  }

  wrap.innerHTML = `<div class="group-tiles">` + shown.map(groupTile).join('') + `</div>`;
}

// A compact group tile: just the icon + truncated name, with a small label badge
// on the icon showing whether MY balance in the group is clear or outstanding.
function groupTile(g) {
  const hasExpenses = state.groupExpenses.some((e) => e.group_id === g.id);
  const settled = owedByUserInGroup(g.id).total === 0 && owedToUserInGroup(g.id).total === 0;
  // No flag on an empty group — "Settled" would be misleading when there's nothing.
  const flag = !hasExpenses ? '' : `<span class="gt-flag ${settled ? 'is-settled' : 'is-owed'}">${settled ? 'Settled' : 'Due'}</span>`;
  return `<button class="group-tile${g.retired ? ' retired' : ''}" data-group="${g.id}">
      <span class="gt-ico-wrap">
        <span class="gt-ico txn-ico" style="background:${groupColor(g)}20">${groupIcon(g)}</span>
        ${flag}
      </span>
      <span class="gt-name">${g.name}</span>
    </button>`;
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

  // Action footer — a full-width "Settle your share" for a pending share you
  // owe, or a status badge once it's settled. In a retired (read-only) group the
  // settle button is replaced by a plain "you owe" badge so no settle can start.
  const action = $('expDetailAction');
  if (mine && !iPaid) {
    if (mine.status !== 'pending') {
      action.innerHTML = `<div class="exp-detail-done">Settled ${fmt(mine.share_amount)} ✓</div>`;
    } else if (g.retired) {
      action.innerHTML = `<div class="exp-detail-owe">You owe ${fmt(mine.share_amount)}</div>`;
    } else {
      action.innerHTML = `<button class="exp-detail-settle" data-settle="${mine.id}">Settle your share ${fmt(mine.share_amount)}</button>`;
    }
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
  $('gsettName').value = g.name; // prefill for rename
  renderIconModal();
  $('groupIconModal').classList.add('open');
}

// Build one group-expense tile (icon/info + status/edit + optional settle
// footer). `g` is the owning group. Every tile is tappable to open its detail.
function renderExpenseTile(e, g) {
  const mine = splitsFor(e.id).find((s) => s.debtor_id === state.user?.id);
  const iPaid = e.payer_id === state.user?.id;
  // A retired group is read-only: no settle button and no edit/delete. A pending
  // owed share still shows its "you owe" pill (below) so the balance is visible.
  const readOnly = !!g.retired;
  // Status pill (compact, top-right). For a pending share you owe, the full
  // "Settle" footer button below carries the amount, so no pill — unless the
  // group is retired (no footer button), where we surface the owed pill instead.
  let status = '';
  if (mine && !iPaid) {
    if (mine.status !== 'pending') status = `<span class="pay-badge shared-done">settled ✓</span>`;
    else if (readOnly) status = `<span class="pay-badge shared-pending">you owe ${fmt(mine.share_amount)}</span>`;
  } else if (iPaid) {
    const pend = splitsFor(e.id).filter((s) => s.debtor_id !== state.user?.id && s.status === 'pending').length;
    status = pend > 0 ? `<span class="pay-badge shared-pending">${pend} pending</span>` : `<span class="pay-badge shared-done">all settled</span>`;
  }
  // Full-width footer action: a pending share you owe gets its own settle
  // button here (never truncated) — suppressed in a retired (read-only) group.
  const footer =
    !readOnly && mine && !iPaid && mine.status === 'pending'
      ? `<button class="ge-settle-btn" data-settle="${mine.id}">Settle your share ${fmt(mine.share_amount)}</button>`
      : '';
  const editBtn = !readOnly && iPaid ? `<button class="icon-btn gedit" data-gid="${e.id}" title="Edit" aria-label="Edit">${icon.edit({ size: 17 })}</button>` : '';
  const delBtn = !readOnly && iPaid && !expenseHasPayment(e.id) ? `<button class="icon-btn gdel" data-gid="${e.id}" title="Delete" aria-label="Delete">${icon.trash({ size: 17 })}</button>` : '';
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
      ${memberAvatar(g, e.payer_id, 'ge-avatar')}
      <div class="txn-info">
        <div class="txn-desc">${e.description || 'Expense'}</div>
        <div class="txn-meta ge-payer">${who} paid ${fmt(e.amount)}${payBadge(payMethod)}</div>
        <div class="txn-meta ge-when">${when}</div>
      </div>
      <div class="ge-actions">${status}<div class="ge-btns">${editBtn}${delBtn}</div></div>
    </div>
    ${footer}
  </div>`;
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
  // Cap the displayed name to 30 chars (ellipsis) — it may wrap to a 2nd line.
  $('groupDetailTitle').textContent = g.name.length > 30 ? g.name.slice(0, 30).trimEnd() + '…' : g.name;
  $('groupDetailTitle').title = g.name; // full name on hover
  $('groupInviteCode').textContent = g.invite_code;
  $('copyCodeBtn').innerHTML = icon.copy({ size: 14 });
  $('shareGroupBtn').innerHTML = icon.share({ size: 14 });
  const memCount = g.members.length;
  $('groupMemberCount').innerHTML = `${icon.users({ size: 12 })} ${memCount} member${memCount === 1 ? '' : 's'}`;
  // Big group icon (tap to edit — any member).
  const bigIco = $('groupIconBig');
  bigIco.textContent = groupIcon(g);
  bigIco.style.background = groupColor(g) + '20';
  $('groupIconEditBadge').innerHTML = icon.edit({ size: 13 });
  // Owner-only header actions (retire + delete). Keep them in layout (hidden) for
  // non-owners so the title stays centered.
  const retireBtn = $('retireGroupBtn');
  retireBtn.innerHTML = icon.archive({ size: 18 });
  retireBtn.title = g.retired ? 'Reactivate group' : 'Retire group';
  retireBtn.setAttribute('aria-label', retireBtn.title);
  retireBtn.style.display = '';
  retireBtn.style.visibility = g.role === 'owner' ? 'visible' : 'hidden';
  const delGroupBtn = $('deleteGroupBtn');
  delGroupBtn.innerHTML = icon.trash({ size: 18 });
  delGroupBtn.style.display = '';
  delGroupBtn.style.visibility = g.role === 'owner' ? 'visible' : 'hidden';

  // Retired (read-only) group: show a banner and hide the add-expense FAB.
  if (g.retired) {
    $('groupRetiredBanner').innerHTML = `<div class="retired-banner">${icon.archive({ size: 16 })}<span>This group is retired — read-only. Reactivate it to add expenses or settle.</span></div>`;
  } else {
    $('groupRetiredBanner').innerHTML = '';
  }
  $('groupAddBtn').closest('.fab').style.display = g.retired ? 'none' : '';

  // Pending-action nudge: if you haven't added a UPI ID, group members can't pay
  // you back in one tap. Tapping the banner opens your profile.
  if (pendingProfileActions() > 0) {
    $('groupPendingBanner').innerHTML = `<button class="pending-banner pending-banner-btn" id="groupPendingBtn">Add your UPI ID so members can pay you back — 1 pending action.</button>`;
    const b = $('groupPendingBtn');
    if (b) b.onclick = () => openProfileEdit();
  } else {
    $('groupPendingBanner').innerHTML = '';
  }

  // Your total share of this group: every split of yours, settled or not —
  // your part of what you spent plus everything you owe. Hidden when zero.
  const myTotal = totalShareInGroup(g.id);
  if (myTotal > 0) {
    $('groupTotal').innerHTML = `
      <div class="group-total-card">
        <span class="gt-label">Your total in this group</span>
        <span class="gt-amt">${fmt(myTotal)}</span>
      </div>`;
  } else {
    $('groupTotal').innerHTML = '';
  }

  // "You owe" summary: per-creditor totals with a one-tap settle-all button.
  // A retired group shows the amounts but no Settle button (read-only).
  const owe = owedByUserInGroup(g.id);
  if (owe.total > 0) {
    const rows = owe.byPayer
      .map((o) => {
        const name = memberName(g, o.payerId);
        const settleBtn = g.retired ? '' : `<button class="owe-settle" data-payer="${o.payerId}">Settle</button>`;
        return `<div class="owe-row">
          <span class="owe-name">${name}</span>
          <span class="owe-amt">${fmt(o.amount)}</span>
          ${settleBtn}
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

  // Members list + count. The "Add member" button lives in the section header
  // (hidden on retired groups). Any member may add friends.
  $('groupMembersCount').textContent = g.members.length ? `· ${g.members.length}` : '';
  $('groupMembersList').innerHTML = g.members
    .map((m) => {
      const you = m.id === state.user?.id ? ' (you)' : '';
      return `<div class="member-row">${memberAvatar(g, m.id, 'member-row-av')}<span class="member-row-name">${m.name}${you}</span></div>`;
    })
    .join('');
  $('addMemberBtn').style.display = g.retired ? 'none' : '';

  // Expense list, grouped by day with collapsible date headers (like the home
  // list). `exps` is already newest-first, so iterating preserves date order.
  if (!exps.length) {
    $('groupExpenseList').innerHTML = '<div class="empty"><span>🧾</span>No group expenses yet.</div>';
  } else {
    const byDate = [];
    const seen = {};
    exps.forEach((e) => {
      if (!seen[e.spent_on]) {
        seen[e.spent_on] = [];
        byDate.push({ date: e.spent_on, items: seen[e.spent_on] });
      }
      seen[e.spent_on].push(e);
    });
    $('groupExpenseList').innerHTML = byDate
      .map((grp) => {
        const isCollapsed = groupCollapsed.has(grp.date);
        // Day total = the current user's own share of that day's expenses, matching
        // the home list: a share you paid or already settled counts; a share you
        // still owe (pending) is excluded until settled. Never the full expense.
        const dayTotal = grp.items.reduce((s, e) => {
          const mine = splitsFor(e.id).find((sp) => sp.debtor_id === state.user?.id);
          if (!mine) return s;
          const iPaid = e.payer_id === state.user?.id;
          if (!iPaid && mine.status === 'pending') return s; // owed but not yet settled
          return s + Number(mine.share_amount);
        }, 0);
        const tiles = grp.items.map((e) => renderExpenseTile(e, g)).join('');
        return `<div class="date-group" data-date="${grp.date}">
          <div class="date-header">
            <div class="date-header-left">
              <span class="chevron${isCollapsed ? '' : ' open'}">▼</span>
              <span class="date-label">${friendlyDate(grp.date)}</span>
              <span class="date-count">${grp.items.length}</span>
            </div>
            <span class="date-total">${fmt(dayTotal)}</span>
          </div>
          <div class="date-entries ge-entries${isCollapsed ? ' collapsed' : ''}">${tiles}</div>
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
      // Expand its date group if collapsed, else it can't scroll into view.
      const grp = target.closest('.date-group');
      if (grp && groupCollapsed.has(grp.dataset.date)) {
        groupCollapsed.delete(grp.dataset.date);
        grp.querySelector('.date-entries').classList.remove('collapsed');
        grp.querySelector('.chevron').classList.add('open');
      }
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
    $('groupsAuthGate').textContent = 'Cloud backend is not configured for this app, so group features are unavailable.';
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
  navTo('groups');
  renderGroupDetail();
}

// Re-render whatever group view is currently visible (called on cloud data reload).
export function refreshGroupsView() {
  if ($('groupsOverlay').classList.contains('open') && state.user) renderGroupList();
  if ($('groups').classList.contains('active') && state.openGroupId) renderGroupDetail();
}

// ---- Member picker (add friends by name / number) --------------------------

// Render the search results into the picker for the currently-open group.
function renderMemberResults() {
  const q = $('memberSearch').value;
  const friends = myFriends(state.openGroupId); // excludes self + current members
  const results = matchFriends(friends, q);
  if (!q.trim()) {
    // No query: show all addable friends (or a hint if none).
    $('memberResults').innerHTML = friends.length
      ? friends.map(memberResultRow).join('')
      : '<div class="member-empty">No friends to add yet. Share the invite link below.</div>';
    return;
  }
  $('memberResults').innerHTML = results.length
    ? results.map(memberResultRow).join('')
    : '<div class="member-empty">No match among your friends. They may not be on the app yet — share the invite link.</div>';
}

function memberResultRow(f) {
  const av = f.avatar
    ? `<span class="member-row-av member-avatar"><img src="${f.avatar}" alt="" referrerpolicy="no-referrer"/></span>`
    : `<span class="member-row-av member-avatar" style="background:${avatarColor(f.id)}">${(f.name || '?').charAt(0).toUpperCase()}</span>`;
  return `<button class="member-result" data-add="${f.id}">${av}<span class="member-row-name">${f.name}</span><span class="member-add-plus">+</span></button>`;
}

export function initGroupsView() {
  // Group detail back -> previous screen (home, category, …).
  $('groupsBackBtn').onclick = () => {
    state.openGroupId = null;
    const to = navBack();
    renderForScreen(to);
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
    const g = state.groups.find((x) => x.id === state.openGroupId);
    const custom = $('giconCustom').value.trim();
    const chosen = custom || giSelIcon;
    const newName = $('gsettName').value.trim();
    if (!newName) {
      $('gsettName').focus();
      toastError('Group name can’t be empty.');
      return;
    }
    // Save the name only when it actually changed, then icon/color.
    const nameOk = !g || newName === g.name ? true : await renameGroup(state.openGroupId, newName);
    if (!nameOk) return;
    const ok = await setGroupIcon(state.openGroupId, { icon: chosen, color: giSelColor });
    if (ok || nameOk) {
      $('groupIconModal').classList.remove('open');
      renderGroupDetail();
    }
  };

  // Owner retires / reactivates the group (read-only archive).
  $('retireGroupBtn').onclick = async () => {
    const g = state.groups.find((x) => x.id === state.openGroupId);
    if (!g) return;
    const msg = g.retired
      ? `Reactivate "${g.name}"? Members will be able to add expenses and settle balances again.`
      : `Retire "${g.name}"? It becomes read-only — no new expenses and no settling — but stays viewable, and you can reactivate it anytime.`;
    if (!(await confirmModal(msg, { title: g.retired ? 'Reactivate group' : 'Retire group', confirmLabel: g.retired ? 'Reactivate' : 'Retire' }))) return;
    const ok = await setGroupRetired(g.id, !g.retired);
    if (ok) {
      renderGroupDetail();
      toastSuccess(g.retired ? 'Group reactivated' : 'Group retired');
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
    const tile = e.target.closest('.group-tile');
    if (tile) showGroupDetail(tile.dataset.group);
  });

  // Tab switch between Active and Retired groups.
  $('grpTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.grp-tab');
    if (!tab) return;
    groupTab = tab.dataset.tab;
    renderGroupList();
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

  // Share the invite: native share sheet (WhatsApp/Messages/etc.) with a tap-to-join
  // link, falling back to copying the invite text where Web Share isn't available.
  $('shareGroupBtn').onclick = async () => {
    const g = state.groups.find((x) => x.id === state.openGroupId);
    if (!g) return;
    const { url, text } = buildInvite(g);
    try {
      if (navigator.share) {
        await navigator.share({ title: `Join "${g.name}"`, text, url });
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        toastSuccess('Invite copied — paste it to your friends');
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return; // user dismissed the share sheet
      try {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        toastSuccess('Invite copied — paste it to your friends');
      } catch {
        toastError('Could not share the invite.');
      }
    }
  };

  // --- Add-member picker ---
  $('addMemberBtn').onclick = () => {
    $('memberSearch').value = '';
    renderMemberResults();
    $('memberModal').classList.add('open');
    setTimeout(() => $('memberSearch').focus(), 60);
  };
  $('memberSearch').addEventListener('input', renderMemberResults);
  $('memberResults').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    const ok = await addMemberToGroup(state.openGroupId, btn.dataset.add);
    if (ok) {
      renderGroupDetail();
      renderMemberResults(); // refresh so the added person drops out of results
      toastSuccess('Member added');
    }
  });
  $('memberInviteBtn').onclick = () => $('shareGroupBtn').click(); // reuse the invite-share flow
  $('memberClose').onclick = () => $('memberModal').classList.remove('open');
  $('memberModal').onclick = (e) => {
    if (e.target === $('memberModal')) $('memberModal').classList.remove('open');
  };

  // Just created a group -> open it and pop the Add-member picker so you can add
  // friends right away (falls back to the invite link for people not on the app).
  document.addEventListener('group-created', (e) => {
    const id = e.detail?.id;
    if (!id) return;
    showGroupDetail(id);
    setTimeout(() => $('addMemberBtn')?.click(), 250);
  });

  $('groupOwe').addEventListener('click', async (e) => {
    const btn = e.target.closest('.owe-settle');
    if (!btn) return;
    const g = state.groups.find((x) => x.id === state.openGroupId);
    const payeeId = btn.dataset.payer;
    const name = g ? memberName(g, payeeId) : 'this person';
    // Amount you owe them (net) — for the UPI pre-fill.
    const owe = owedByUserInGroup(state.openGroupId).byPayer.find((o) => o.payerId === payeeId);
    if (owe && g) await offerUpiPay(g, payeeId, owe.amount, `Settle ${g.name}`);
    if (!(await confirmModal(`Settle up with ${name}? This clears everything between you two — what you owe them and what they owe you.`, { title: 'Settle up', confirmLabel: 'Continue' }))) return;
    const { confirmed, pay } = await pickSettlePayment();
    if (!confirmed) return;
    await settleUpWithMember(state.openGroupId, payeeId, pay);
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
    // Footer "Settle your share" button on the row itself.
    const settleBtn = e.target.closest('[data-settle]');
    if (settleBtn) {
      if (await confirmAndSettleShare(settleBtn.dataset.settle)) renderGroupDetail();
      return;
    }
    // Collapse / expand a date group when its header is tapped.
    const hdr = e.target.closest('.date-header');
    if (hdr) {
      const grp = hdr.closest('.date-group');
      const date = grp.dataset.date;
      const entries = grp.querySelector('.date-entries');
      const chevron = grp.querySelector('.chevron');
      if (groupCollapsed.has(date)) {
        groupCollapsed.delete(date);
        entries.classList.remove('collapsed');
        chevron.classList.add('open');
      } else {
        groupCollapsed.add(date);
        entries.classList.add('collapsed');
        chevron.classList.remove('open');
      }
      return;
    }
    // Fall through: tapping the row (anywhere else) opens the detail popup.
    // Checked last so the action buttons above win.
    const detail = e.target.closest('[data-detail]');
    if (detail) showExpenseDetail(detail.dataset.detail);
  });

  // Detail modal: "Settle your share" button confirms, settles the current
  // user's share, then closes the modal and re-renders.
  $('expDetailAction').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-settle]');
    if (!btn) return;
    if (await confirmAndSettleShare(btn.dataset.settle)) {
      $('breakdownModal').classList.remove('open');
      renderGroupDetail();
    }
  });

  // Detail modal close.
  $('breakdownClose').innerHTML = icon.close({ size: 20 });
  $('breakdownClose').onclick = () => $('breakdownModal').classList.remove('open');
  $('breakdownModal').onclick = (e) => {
    if (e.target === $('breakdownModal')) $('breakdownModal').classList.remove('open');
  };
}
