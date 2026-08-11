// Groups screen: a list of the user's groups (with create/join controls), and a
// per-group detail view showing expenses, each member's effective balance, and
// the current user's pending shares with "Mark my share done" buttons.

import { state, groupCollapsed } from '../state.js';
import { cloudEnabled } from '../supabase.js';
import { fmt } from '../format.js';
import { friendlyDate, payBadge } from '../format.js';
import { $ } from '../dom.js';
import { loadCloudData, markShareDone, deleteGroupExpense, settleUpWithMember, settleAllMyDebts, deleteGroup, setGroupRetired, setGroupSimplify, myFriends, addMemberToGroup, findUserByPhone, leaveGroup, groupDisplayName } from '../features/groups.js';
import { openEditGroup, showAddForGroup } from './addEdit.js';
import { expenseHasPayment, owedByUserInGroup, owedToUserInGroup, totalShareInGroup } from '../cloudrows.js';
import { toastError, toastSuccess } from '../toast.js';
import { icon } from '../icons.js';
import { matchFriends } from '../friends.js';
import { downscaleImage } from '../imgutil.js';
import { confirmModal, pickSettlePayment } from '../confirm.js';
import { setGroupIcon, renameGroup, uploadGroupImage, setGroupPhoto } from '../features/groups.js';
import { navTo, navBack, navReset } from '../nav.js';
import { renderForScreen } from './nav-render.js';
import { buildUpiLink } from '../upi.js';
import { pendingProfileActions, openProfileEdit } from '../features/profile.js';

// Preset icons + gradient cover themes for the group cover editor.
// Each cover is a full-cover, multi-colour vector SVG scene, inlined as a data-URI
// and stretched to fill (center/cover). Encode fully and escape ( ) ' — which
// encodeURIComponent leaves raw — so the value is valid inside url(...) and an HTML
// style="" attribute. Consumers assign the string to `background` and get a scene.
function scene(inner, w = 120, h = 120) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">${inner}</svg>`;
  const enc = encodeURIComponent(svg).replace(/[()']/g, (m) => ({ '(': '%28', ')': '%29', "'": '%27' }[m]));
  return `url(data:image/svg+xml,${enc}) center/cover no-repeat`;
}
// A linear-gradient <defs> + rect base for a scene.
const grad = (id, c1, c2) => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="120" height="120" fill="url(#${id})"/>`;

// Ready-made cover themes: colourful vector scenes. id is stored in groups.color;
// ids are stable for backward-compat.
export const GROUP_THEMES = {
  // Ocean: layered translucent waves in several blues + a sun disc.
  ocean: scene(`${grad('g', '#1E3A5F', '#2E7FB8')}<circle cx="92" cy="26" r="16" fill="#FFE08A" opacity=".85"/><path d="M0 78 Q30 62 60 78 T120 78 V120 H0Z" fill="#3E8FD0" opacity=".55"/><path d="M0 92 Q30 78 60 92 T120 92 V120 H0Z" fill="#6FB6E8" opacity=".5"/><path d="M0 104 Q30 92 60 104 T120 104 V120 H0Z" fill="#BFE4F7" opacity=".45"/>`),
  // Forest: overlapping triangle trees in greens under a mint sky.
  forest: scene(`${grad('g', '#8FE3B5', '#1A6B3A')}<circle cx="26" cy="24" r="12" fill="#FFF3B0" opacity=".8"/><path d="M60 30 L92 96 L28 96Z" fill="#1E7D45" opacity=".9"/><path d="M32 46 L58 100 L6 100Z" fill="#2FA968" opacity=".85"/><path d="M92 50 L116 100 L68 100Z" fill="#16603A" opacity=".85"/>`),
  // Grape: confetti dots + arcs in purples/pinks.
  grape: scene(`${grad('g', '#5B2C6F', '#9B59B6')}<circle cx="30" cy="30" r="18" fill="#C071E0" opacity=".7"/><circle cx="90" cy="80" r="26" fill="#7E3F9C" opacity=".6"/><circle cx="86" cy="26" r="7" fill="#FFB3E6"/><circle cx="24" cy="86" r="6" fill="#E6B3FF"/><circle cx="60" cy="54" r="5" fill="#FFD6F5"/>`),
  // Sunset: banded sun over warm gradient with clouds.
  sunset: scene(`${grad('g', '#FF8A5B', '#C0392B')}<circle cx="60" cy="48" r="30" fill="#FFD36B" opacity=".9"/><rect x="20" y="44" width="80" height="6" fill="#FF8A5B" opacity=".8"/><rect x="20" y="56" width="80" height="6" fill="#FF8A5B" opacity=".8"/><path d="M0 96 Q30 84 64 96 T120 92 V120 H0Z" fill="#8E2C24" opacity=".7"/>`),
  // Amber: rays fanning from a corner sun.
  amber: scene(`${grad('g', '#FFC24D', '#D35400')}<g fill="#FFE9A8" opacity=".55"><path d="M0 0 L60 0 L0 40Z"/><path d="M0 40 L0 90 L44 0Z" opacity=".7"/></g><circle cx="0" cy="0" r="16" fill="#FFF6D0"/><circle cx="88" cy="90" r="22" fill="#B34700" opacity=".5"/>`),
  // Teal: bubbles + arc in teals/cyans.
  teal: scene(`${grad('g', '#0E6655', '#2BC4B6')}<circle cx="34" cy="40" r="24" fill="#7FF0DE" opacity=".55"/><circle cx="92" cy="86" r="18" fill="#0B4F44" opacity=".6"/><circle cx="90" cy="30" r="8" fill="#CFFFF4"/><circle cx="46" cy="90" r="6" fill="#9FF6E6"/>`),
  // Sky: clouds + sun on a blue gradient.
  sky: scene(`${grad('g', '#2874A6', '#7FB6F5')}<circle cx="30" cy="28" r="15" fill="#FFF4C2" opacity=".9"/><ellipse cx="80" cy="52" rx="30" ry="14" fill="#EAF4FF" opacity=".8"/><ellipse cx="40" cy="82" rx="26" ry="12" fill="#CFE6FF" opacity=".7"/>`),
  // Rose: petals / blobs in pinks + magenta.
  rose: scene(`${grad('g', '#FF9EB5', '#C0398C')}<circle cx="34" cy="36" r="22" fill="#FFD1E0" opacity=".7"/><circle cx="88" cy="82" r="26" fill="#9C2E74" opacity=".6"/><circle cx="92" cy="30" r="10" fill="#FFC2DE"/><path d="M0 96 Q30 82 62 96 T120 92 V120 H0Z" fill="#7E2A63" opacity=".55"/>`),
  // Slate: geometric facets in cool greys/blues.
  slate: scene(`${grad('g', '#2C3E50', '#6B7C8F')}<path d="M0 0 L70 0 L0 70Z" fill="#41576E" opacity=".8"/><path d="M120 40 L120 120 L40 120Z" fill="#22303F" opacity=".8"/><path d="M120 0 L120 46 L74 0Z" fill="#8296AB" opacity=".55"/>`),
  // Mint: leaf arcs + dots in fresh greens.
  mint: scene(`${grad('g', '#1A8F5A', '#8FE3B5')}<path d="M0 20 Q60 0 120 20 L120 0 L0 0Z" fill="#BFF3D6" opacity=".6"/><circle cx="90" cy="80" r="24" fill="#12784A" opacity=".55"/><circle cx="30" cy="86" r="14" fill="#5FCf95" opacity=".7"/><circle cx="74" cy="30" r="7" fill="#EAFBF1"/>`),
  // Aurora: sweeping bands of teal/purple/pink over deep indigo with stars.
  aurora: scene(`${grad('g', '#241C4E', '#3B2B7A')}<path d="M0 40 Q40 10 120 34 L120 54 Q40 34 0 62Z" fill="#3DD6C4" opacity=".55"/><path d="M0 62 Q50 34 120 54 L120 78 Q50 60 0 86Z" fill="#8A5CF0" opacity=".5"/><path d="M0 86 Q50 62 120 78 L120 100 Q50 88 0 108Z" fill="#F06CC0" opacity=".45"/><circle cx="24" cy="24" r="2" fill="#fff"/><circle cx="70" cy="18" r="1.6" fill="#fff"/><circle cx="102" cy="30" r="2" fill="#fff"/>`),
  // Coral: warm reef bubbles in coral/peach/gold.
  coral: scene(`${grad('g', '#FF6B6B', '#FF9E7A')}<circle cx="30" cy="34" r="22" fill="#FFC27A" opacity=".7"/><circle cx="92" cy="82" r="26" fill="#E24A6B" opacity=".55"/><circle cx="94" cy="28" r="9" fill="#FFE3B0"/><circle cx="26" cy="90" r="8" fill="#FFB199"/><circle cx="60" cy="58" r="5" fill="#FFF0D6"/>`),
  // Citrus: bright lime + orange wedges on a sunny field.
  citrus: scene(`${grad('g', '#F9D423', '#FF7E5F')}<circle cx="40" cy="46" r="30" fill="#B6E62E" opacity=".7"/><path d="M40 46 L70 30 A34 34 0 0 1 74 62Z" fill="#FF8A3D" opacity=".7"/><circle cx="96" cy="94" r="18" fill="#E85D2A" opacity=".55"/><circle cx="98" cy="24" r="7" fill="#FFF4B0"/>`),
  // Berry: layered berry-toned hills in magenta/violet.
  berry: scene(`${grad('g', '#7A1F5C', '#C0398C')}<circle cx="90" cy="26" r="14" fill="#FFC7E6" opacity=".85"/><path d="M0 84 Q40 60 80 84 T120 80 V120 H0Z" fill="#9C2E74" opacity=".7"/><path d="M0 98 Q40 78 82 98 T120 96 V120 H0Z" fill="#E14FA0" opacity=".6"/><path d="M0 110 Q40 96 82 110 T120 108 V120 H0Z" fill="#FF8FCB" opacity=".5"/>`),
};
const GROUP_THEME_IDS = Object.keys(GROUP_THEMES);
export const GROUP_THEME_LIST = GROUP_THEMES;
export const GROUP_THEME_ID_LIST = GROUP_THEME_IDS;
export const DEFAULT_GROUP_THEME = 'ocean';

// The cover scene for a group: a known theme id, else (backward-compat) a gradient
// from a stored hex colour, else the default cover.
function gradientFor(g) {
  const c = g.color;
  if (c && GROUP_THEMES[c]) return GROUP_THEMES[c];
  if (c && /^#/.test(c)) return `linear-gradient(135deg,${c} 0%,${c} 100%)`;
  return GROUP_THEMES[DEFAULT_GROUP_THEME];
}
// Keep groupColor for the odd caller that still wants a solid tint (avatars etc.).
const groupColor = (g) => (g.color && /^#/.test(g.color) ? g.color : DEFAULT_GROUP_COLOR_HEX);
const DEFAULT_GROUP_COLOR_HEX = '#1E3A5F';

// Background CSS for the cover-hero layer: the photo (cover-fit) if set, else the
// group's theme scene. A dark scrim layer sits on top so overlaid text stays legible.
// Uses the `background` shorthand (not background-image) because theme values carry
// their own position/size (center/cover) which are only valid in the shorthand.
function coverBgStyle(g) {
  if (g.photo) return `background:linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,.55)),center/cover no-repeat url('${g.photo}');`;
  return `background:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.35)),${gradientFor(g)};`;
}

// Paint a cover background layer `el` for group `g` (photo or theme scene).
function paintCover(el, g) {
  el.style.cssText = coverBgStyle(g);
  el.innerHTML = '';
}

// Compact cover background (no scrim) for tiny chips/thumbnails elsewhere (e.g. the
// add-expense "Split with" groups strip): the photo cover-fit, else the theme scene.
export function groupCoverBg(g) {
  if (!g) return `background:${GROUP_THEMES[DEFAULT_GROUP_THEME]}`;
  if (g.photo) return `background:center/cover no-repeat url('${g.photo}')`;
  return `background:${gradientFor(g)}`;
}

// Compact thumbnail (popover tiles): cropped photo, else the theme scene.
function thumbMarkup(g) {
  if (g.photo) return `<span class="gt-ico gt-thumb has-photo"><img class="gt-photo" src="${g.photo}" alt="" referrerpolicy="no-referrer"/></span>`;
  return `<span class="gt-ico gt-thumb" style="background:${gradientFor(g)}"></span>`;
}

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
  // Direct-split containers are not real groups — they're listed separately below.
  const realGroups = state.groups.filter((g) => !g.direct);
  const active = realGroups.filter((g) => !g.retired);
  const retired = realGroups.filter((g) => g.retired);
  // Direct splits the user is part of that actually have expenses (skip empty ones).
  const directSplits = state.groups.filter((g) => g.direct && state.groupExpenses.some((e) => e.group_id === g.id));

  // Show the Retired tab only when some exist; if the retired tab is selected
  // but nothing's left retired, fall back to active.
  const retiredTab = $('grpTabs').querySelector('[data-tab="retired"]');
  retiredTab.style.display = retired.length ? '' : 'none';
  if (groupTab === 'retired' && !retired.length) groupTab = 'active';
  $('grpTabs').querySelectorAll('.grp-tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === groupTab));

  // "Shared splits" section (direct splits with friends), appended below the groups.
  const sharedBlock = directSplits.length
    ? `<p class="section-title shared-splits-title">Shared splits</p><div class="group-tiles">${directSplits.map(groupTile).join('')}</div>`
    : '';

  if (realGroups.length === 0 && !directSplits.length) {
    wrap.innerHTML = '<div class="empty"><span>👥</span>No groups yet.<br>Create one, or split an expense with friends.</div>';
    return;
  }

  const shown = groupTab === 'retired' ? retired : active;
  const groupsBlock = shown.length ? `<div class="group-tiles">${shown.map(groupTile).join('')}</div>` : (groupTab === 'retired' ? '<div class="empty"><span>👥</span>No groups here.</div>' : '');
  wrap.innerHTML = groupsBlock + sharedBlock;
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
        ${thumbMarkup(g)}
        ${flag}
      </span>
      <span class="gt-name">${groupDisplayName(g)}</span>
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
  if (mine && !iPaid && Number(mine.share_amount) > 0) {
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

// Group cover editor — pick a cover design, or upload a photo. Any member.
let giSelTheme = DEFAULT_GROUP_THEME;
let giPhotoFile = null; // pending upload
let giPhotoPreview = null; // object URL, or existing g.photo

function renderIconModal() {
  $('giconSwatches').innerHTML = GROUP_THEME_IDS.map((id) => `<div class="theme-swatch${id === giSelTheme && !giPhotoPreview ? ' on' : ''}" data-theme="${id}" style="background:${GROUP_THEMES[id]}"></div>`).join('');
  const prev = $('giconPreview');
  if (giPhotoPreview) {
    prev.style.background = `center/cover no-repeat url('${giPhotoPreview}')`;
  } else {
    prev.style.background = GROUP_THEMES[giSelTheme] || GROUP_THEMES[DEFAULT_GROUP_THEME];
  }
  prev.innerHTML = '';
}

function openGroupIconModal() {
  const g = state.groups.find((x) => x.id === state.openGroupId);
  if (!g) return;
  giSelTheme = g.color && GROUP_THEMES[g.color] ? g.color : DEFAULT_GROUP_THEME;
  giPhotoFile = null;
  giPhotoPreview = g.photo || null;
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
  if (mine && !iPaid && Number(mine.share_amount) > 0) {
    if (mine.status !== 'pending') status = `<span class="pay-badge shared-done">settled ✓</span>`;
    else if (readOnly) status = `<span class="pay-badge shared-pending">you owe ${fmt(mine.share_amount)}</span>`;
  } else if (iPaid) {
    const pend = splitsFor(e.id).filter((s) => s.debtor_id !== state.user?.id && s.status === 'pending').length;
    status = pend > 0 ? `<span class="pay-badge shared-pending">${pend} pending</span>` : `<span class="pay-badge shared-done">all settled</span>`;
  }
  // Full-width footer action: a pending share you owe gets its own settle
  // button here (never truncated) — suppressed in a retired (read-only) group, and
  // omitted when your share is 0 (nothing to settle).
  const footer =
    !readOnly && mine && !iPaid && mine.status === 'pending' && Number(mine.share_amount) > 0
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

// Drive the shared title as one element travelling from its big cover pose (p=0,
// large + white + low-left over the cover) up into the small bar-center pose (p=1,
// ink, at rest in the fixed bar). Progress is the scroll offset over the hero's
// collapse distance; transform + color are lerped per frame for a continuous move.
const EXPAND_SCALE = 1.7; // how much bigger the title is over the cover
function updateGroupTopbar() {
  const bar = $('groupTopBar');
  const title = $('groupDetailTitle');
  const hero = $('groupHero');
  if (!bar || !title || !hero) return;

  const barRect = bar.getBoundingClientRect();
  const heroRect = hero.getBoundingClientRect();
  // Progress 0 → 1 as the page scrolls from the top until the cover has scrolled up
  // to leave only a bar-height sliver. Use scrollY (0 at the very top) so the bar is
  // fully transparent at rest — measuring heroRect.top instead would start > 0 here
  // because the hero has a negative top margin to bleed under the safe area.
  const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
  const dist = Math.max(1, heroRect.height - barRect.height);
  const p = Math.min(1, Math.max(0, scrollY / dist));
  const e = 1 - p; // expansion amount: 1 fully expanded (cover), 0 collapsed (bar)

  // The title is absolutely centred in the bar (transform-origin:center), so its
  // resting (collapsed) pose is dead-centre with no transform. For the expanded pose
  // it scales up and shifts so its left edge sits at the cover padding, low over the
  // cover. Interpolate between the two by e.
  title.style.transform = '';
  const s = 1 + (EXPAND_SCALE - 1) * e;
  // Measure the real text width via a Range (the element is full-width, so its own
  // rect is the whole bar — not the glyphs).
  let textW = 0;
  const node = title.firstChild;
  if (node) {
    const r = document.createRange();
    r.selectNodeContents(title);
    textW = r.getBoundingClientRect().width;
  }
  const t = title.getBoundingClientRect();
  const barCenterX = t.left + t.width / 2;
  const textCenterY = t.top + t.height / 2;
  // Left edge of the scaled text at each pose.
  const collapsedLeft = barCenterX - textW / 2;               // e=0: centred
  const expandedLeft = heroRect.left + 16;                    // e=1: at cover padding
  const scaledHalf = (textW * s) / 2;
  // Where we want the scaled text's left edge to be, blended by e.
  const targetLeft = expandedLeft * e + collapsedLeft * (1 - e);
  // Because origin is centre, the scaled left edge is barCenterX - scaledHalf; shift
  // it to targetLeft.
  const dx = targetLeft - (barCenterX - scaledHalf);
  const expandedCenterY = heroRect.bottom - 80;
  const dy = (expandedCenterY - textCenterY) * e;
  title.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;

  // Colour + shadow lerp: white with drop-shadow over the cover → ink in the bar,
  // fading in over the back half of the travel so text stays readable throughout.
  const c = Math.min(1, Math.max(0, (p - 0.5) / 0.4));
  const ch = (a, b) => Math.round(a + (b - a) * c);
  title.style.color = `rgb(${ch(255, 23)},${ch(255, 26)},${ch(255, 43)})`; // #fff → --ink #171a2b
  title.style.textShadow = c >= 1 ? 'none' : `0 2px 8px rgba(0,0,0,${(0.5 * (1 - c)).toFixed(2)}),0 1px 3px rgba(0,0,0,${(0.4 * (1 - c)).toFixed(2)})`;

  // Bar background + button restyle fade in gradually with progress (not a snap).
  bar.style.setProperty('--bar-p', p.toFixed(3));
  // Back/gear icons crossfade white → ink as the bar solidifies.
  const btnColor = `rgb(${ch(255, 92)},${ch(255, 101)},${ch(255, 119)})`; // #fff → --ink-soft
  $('groupsBackBtn').style.color = btnColor;
  $('groupGearBtn').style.color = btnColor;

  bar.classList.toggle('scrolled', p > 0.85);
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
  // Cover hero: background (photo/gradient) with the name + members overlaid.
  paintCover($('groupCover'), g);
  $('groupDetailTitle').textContent = groupDisplayName(g);
  $('groupDetailTitle').title = groupDisplayName(g);
  $('groupGearBtn').innerHTML = icon.gear({ size: 20 });
  updateGroupTopbar();
  const memCount = g.members.length;
  $('groupMemberCount').innerHTML = `${icon.users({ size: 13 })} ${memCount} member${memCount === 1 ? '' : 's'}`;
  // Avatar stack to the right of the members button: cap at 5, then +N for the rest.
  const shown = g.members.slice(0, 5);
  const extra = g.members.length - shown.length;
  $('groupHeroAvatars').innerHTML =
    shown.map((m) => memberAvatar(g, m.id, 'hero-av')).join('') + (extra > 0 ? `<span class="hero-av hero-av-more">+${extra}</span>` : '');

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
        <div class="owe-head"><span>You owe${g.simplifyDebts ? ' <span class="simplified-tag">simplified</span>' : ''}</span><span class="owe-total">${fmt(owe.total)}</span></div>
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

  // (Members now live in the cover hero — rendered above.)

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
  if ($('groupSettings').classList.contains('active') && state.openGroupId) renderGroupSettings();
}

// Full-screen group settings/actions (opened by the gear on the cover).
function renderGroupSettings() {
  const g = state.groups.find((x) => x.id === state.openGroupId);
  if (!g) {
    renderForScreen(navBack());
    return;
  }
  const owner = g.role === 'owner';
  // A clickable row: [icon] label ... optional right-side control. The whole row
  // carries data-act so the delegated handler routes it.
  const row = (id, ico, label, { cls = '', trailing = '' } = {}) =>
    `<button class="gs-row ${cls}" data-act="${id}"><span class="gs-ico">${ico}</span><span class="gs-label">${label}</span>${trailing}</button>`;

  // --- Top: the group itself. Whole row edits name/cover; pencil is the affordance.
  // A direct split has no cover/name to edit, so its top row is static.
  const topRow = g.direct
    ? `<div class="gs-group-row gs-group-row--static">
        <span class="gs-group-cover">${thumbMarkup(g)}</span>
        <span class="gs-group-meta"><span class="gs-group-name">${groupDisplayName(g)}</span><span class="gs-group-sub">Direct split · ${g.members.length} member${g.members.length === 1 ? '' : 's'}</span></span>
      </div>`
    : `<button class="gs-group-row" data-act="edit">
        <span class="gs-group-cover">${thumbMarkup(g)}</span>
        <span class="gs-group-meta"><span class="gs-group-name">${g.name}</span><span class="gs-group-sub">${g.members.length} member${g.members.length === 1 ? '' : 's'}</span></span>
        <span class="gs-edit-ico">${icon.edit({ size: 18 })}</span>
      </button>`;

  // --- Group members: add + share invite. A retired group takes no new members;
  // a direct split has no invite link (and adding people would make it a real group).
  const memberRows = g.retired
    ? ''
    : g.direct
      ? row('add', icon.users({ size: 18 }), 'Add members')
      : [row('add', icon.users({ size: 18 }), 'Add members'), row('invite', icon.share({ size: 18 }), 'Invite link')].join('');

  // --- Danger zone: retire (distinct), leave, delete.
  const dangerRows = [
    owner ? row('retire', icon.archive({ size: 18 }), g.retired ? 'Reactivate group' : 'Retire group', { cls: 'gs-retire' }) : '',
    row('leave', icon.logout({ size: 18 }), 'Leave group', { cls: 'gs-warn' }),
    owner ? row('delete', icon.trash({ size: 18 }), 'Delete group', { cls: 'gs-danger' }) : '',
  ].filter(Boolean).join('');

  // --- Advanced: group-wide "simplify debts" toggle. Minimizes the number of
  // repayments to settle the group; everyone sees the same simplified payments.
  const simplifyRow = `<button class="gs-row gs-toggle-row" data-act="simplify">
      <span class="gs-ico">${icon.sparkle({ size: 18 })}</span>
      <span class="gs-label gs-label-stack"><span>Simplify group debts</span><span class="gs-sub">Combine debts to reduce the number of repayments</span></span>
      <span class="switch${g.simplifyDebts ? ' on' : ''}" id="simplifySwitch"></span>
    </button>`;

  $('gsBody').innerHTML = `
    <div class="gs-section">${topRow}</div>
    ${memberRows ? `<p class="gs-section-title">Group members</p><div class="gs-section">${memberRows}</div>` : ''}
    <p class="gs-section-title">Advanced</p>
    <div class="gs-section">${simplifyRow}</div>
    <div class="gs-section gs-section-danger">${dangerRows}</div>`;
}

export function showGroupSettings() {
  if (!state.openGroupId) return;
  navTo('groupSettings');
  renderGroupSettings();
}

// Open the add-member picker (from the cover members button or settings -> Add member).
function openMemberPicker() {
  const g = state.groups.find((x) => x.id === state.openGroupId);
  if (!g || g.retired) return; // no adding members to a retired group
  $('memberSearch').value = '';
  renderMemberResults();
  $('memberModal').classList.add('open');
  setTimeout(() => $('memberSearch').focus(), 60);
}

// Share the invite via the native share sheet (WhatsApp/Messages/etc.) with a
// tap-to-join link, falling back to copying the invite text where Web Share
// isn't available.
async function shareInvite() {
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
}

// Dispatch a row tap on the full-screen group settings page.
async function handleSettingsAction(act) {
  const g = state.groups.find((x) => x.id === state.openGroupId);
  if (!g) return;
  switch (act) {
    case 'edit':
      openGroupIconModal();
      break;
    case 'add':
      openMemberPicker();
      break;
    case 'invite':
      shareInvite();
      break;
    case 'simplify': {
      const target = !g.simplifyDebts;
      // Optimistic: flip the switch immediately so it feels responsive, then persist.
      const sw = $('simplifySwitch');
      if (sw) sw.classList.toggle('on', target);
      const ok = await setGroupSimplify(g.id, target);
      renderGroupSettings(); // reflect the persisted state (reverts the switch if it failed)
      if (ok) refreshGroupsView();
      break;
    }
    case 'retire': {
      const msg = g.retired
        ? `Reactivate "${g.name}"? Members will be able to add expenses and settle balances again.`
        : `Retire "${g.name}"? It becomes read-only — no new expenses and no settling — but stays viewable, and you can reactivate it anytime.`;
      if (!(await confirmModal(msg, { title: g.retired ? 'Reactivate group' : 'Retire group', confirmLabel: g.retired ? 'Reactivate' : 'Retire' }))) return;
      const ok = await setGroupRetired(g.id, !g.retired);
      if (ok) {
        renderGroupSettings();
        toastSuccess(g.retired ? 'Group reactivated' : 'Group retired');
      }
      break;
    }
    case 'leave': {
      if (!(await confirmModal(`Leave "${g.name}"? You'll stop seeing its expenses. Any balances stay recorded — settle up first if you owe or are owed.`, { title: 'Leave group', confirmLabel: 'Leave', danger: true }))) return;
      const ok = await leaveGroup(g.id);
      if (ok) {
        state.openGroupId = null;
        navReset('home');
        renderForScreen('home');
        toastSuccess('You left the group');
      }
      break;
    }
    case 'delete': {
      if (!(await confirmModal(`Delete the group "${g.name}"? This permanently removes it and all its expenses for everyone. This cannot be undone.`, { title: 'Delete group', confirmLabel: 'Delete group', danger: true }))) return;
      const ok = await deleteGroup(g.id);
      if (ok) {
        state.openGroupId = null;
        navReset('home');
        renderForScreen('home');
        toastSuccess('Group deleted');
      }
      break;
    }
  }
}

// ---- Member picker (add friends by name / number) --------------------------

let memberSearchSeq = 0;

// Render search results for the picker. Friends match by name or number locally;
// a full 10-digit number with no friend match falls back to the exact-user RPC so
// you can add anyone registered (not just existing friends).
async function renderMemberResults() {
  const seq = ++memberSearchSeq;
  const q = $('memberSearch').value;
  const friends = myFriends(state.openGroupId); // excludes self + current members
  if (!q.trim()) {
    $('memberResults').innerHTML = friends.length
      ? friends.map(memberResultRow).join('')
      : '<div class="member-empty">No friends to add yet. Search by mobile number, or share the invite link below.</div>';
    return;
  }
  let results = matchFriends(friends, q);
  if (!results.length && q.replace(/\D/g, '').length >= 10) {
    const u = await findUserByPhone(q);
    // Skip if this result is already a member of the open group.
    const g = state.groups.find((x) => x.id === state.openGroupId);
    const already = u && g && g.members.some((m) => m.id === u.id);
    if (u && !already) results = [{ id: u.id, name: u.name, avatar: u.avatar, phone: null }];
  }
  if (seq !== memberSearchSeq) return; // a newer keystroke superseded this one
  $('memberResults').innerHTML = results.length
    ? results.map(memberResultRow).join('')
    : '<div class="member-empty">No match. They may not be on the app yet — share the invite link.</div>';
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
  // Cover gear -> full-screen group settings. Members button -> add-member picker.
  $('groupGearBtn').onclick = showGroupSettings;
  $('membersBtn').onclick = openMemberPicker;
  // Drive the shared title on scroll, throttled to one update per animation frame.
  let topbarTick = false;
  window.addEventListener('scroll', () => {
    if (topbarTick || !$('groups').classList.contains('active')) return;
    topbarTick = true;
    requestAnimationFrame(() => {
      topbarTick = false;
      updateGroupTopbar();
    });
  }, { passive: true });
  $('gsBackBtn').innerHTML = icon.back({ size: 20 });
  $('gsBackBtn').onclick = () => renderForScreen(navBack());
  $('gsBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) handleSettingsAction(btn.dataset.act);
  });
  // Group cover/name editor modal (opened via settings -> Edit group).
  $('giconSwatches').addEventListener('click', (e) => {
    const sw = e.target.closest('.theme-swatch');
    if (!sw) return;
    giSelTheme = sw.dataset.theme;
    giPhotoFile = null;
    giPhotoPreview = null; // choosing a cover clears a pending/existing photo
    renderIconModal();
  });
  $('giconPhotoBtn').querySelector('.pub-ico').innerHTML = icon.upload({ size: 16 });
  $('giconPhotoBtn').onclick = () => $('giconPhotoInput').click();
  $('giconPhotoInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    giPhotoFile = await downscaleImage(file);
    if (giPhotoPreview && giPhotoPreview.startsWith('blob:')) URL.revokeObjectURL(giPhotoPreview);
    giPhotoPreview = URL.createObjectURL(giPhotoFile);
    renderIconModal();
  });
  $('giconCancel').onclick = () => $('groupIconModal').classList.remove('open');
  $('groupIconModal').onclick = (e) => {
    if (e.target === $('groupIconModal')) $('groupIconModal').classList.remove('open');
  };
  $('giconSave').onclick = async () => {
    const g = state.groups.find((x) => x.id === state.openGroupId);
    const newName = $('gsettName').value.trim();
    if (!newName) {
      $('gsettName').focus();
      toastError('Group name can’t be empty.');
      return;
    }
    if (!g) return;
    if (newName !== g.name) {
      const nameOk = await renameGroup(state.openGroupId, newName);
      if (!nameOk) return;
    }
    // Save the chosen cover (color). A newly-picked photo uploads + overrides;
    // clearing the photo (chose a cover design) resets photo_url to null.
    await setGroupIcon(state.openGroupId, { color: giSelTheme });
    if (giPhotoFile) {
      const url = await uploadGroupImage(giPhotoFile, state.openGroupId);
      if (url) await setGroupPhoto(state.openGroupId, url);
    } else if (!giPhotoPreview && g.photo) {
      await setGroupPhoto(state.openGroupId, null); // photo removed in favor of a cover
    }
    $('groupIconModal').classList.remove('open');
    renderGroupDetail();
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

  // --- Add-member picker ---
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
  $('memberInviteBtn').onclick = shareInvite; // reuse the invite-share flow
  $('memberClose').onclick = () => $('memberModal').classList.remove('open');
  $('memberModal').onclick = (e) => {
    if (e.target === $('memberModal')) $('memberModal').classList.remove('open');
  };


  $('groupOwe').addEventListener('click', async (e) => {
    const btn = e.target.closest('.owe-settle');
    if (!btn) return;
    const g = state.groups.find((x) => x.id === state.openGroupId);
    const payeeId = btn.dataset.payer;
    const name = g ? memberName(g, payeeId) : 'this person';
    // Amount you owe them (net, or re-routed under simplify) — for the UPI pre-fill.
    const owe = owedByUserInGroup(state.openGroupId).byPayer.find((o) => o.payerId === payeeId);
    if (owe && g) await offerUpiPay(g, payeeId, owe.amount, `Settle ${g.name}`);
    if (g && g.simplifyDebts) {
      // Simplified view: the payee is a re-routed creditor. Paying them clears your
      // real underlying debts (net → 0), so this settles your whole position here.
      if (!(await confirmModal(`Pay ${name} ${fmt(owe ? owe.amount : 0)}? With simplify on, this settles all your debts in "${g.name}".`, { title: 'Settle up', confirmLabel: 'Continue' }))) return;
      const { confirmed, pay } = await pickSettlePayment();
      if (!confirmed) return;
      await settleAllMyDebts(state.openGroupId, payeeId, owe ? owe.amount : 0, pay);
      renderGroupDetail();
      return;
    }
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
