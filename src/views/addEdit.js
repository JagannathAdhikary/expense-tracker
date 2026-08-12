// Add / edit expense screen: category & payment chips, form population, and save.

import { state } from '../state.js';
import { BUILTIN_PAYS } from '../constants.js';
import { isoDay, initialCat, initialPay, fmt, friendlyDate } from '../format.js';
import { persist } from '../storage.js';
import { $ } from '../dom.js';
import { openCatModal } from '../features/categories.js';
import { openPayModal } from '../features/payments.js';
import { cloudEnabled } from '../supabase.js';
import { computeSplits } from '../split.js';
import { saveGroupExpense, editGroupExpense, updateMySplitMeta, updateGroupExpenseMeta, isGroupRetired, myFriends, findUserByPhone, findOrCreateDirectSplit } from '../features/groups.js';
import { groupCoverBg } from './groups.js';
import { matchFriends } from '../friends.js';
import { pushRecord, syncOn } from '../features/sync.js';
import { expenseHasPayment } from '../cloudrows.js';
import { toastError, toastSuccess } from '../toast.js';
import { navTo, navBack } from '../nav.js';
import { renderForScreen } from './nav-render.js';

export function renderCatChips() {
  // Selected category first so it's visible without scrolling the horizontal row.
  const cats = [...state.CATS].sort((a, b) => (a.n === state.selCat ? -1 : b.n === state.selCat ? 1 : 0));
  const html =
    cats.map((c) => `<div class="chip${c.n === state.selCat ? ' on' : ''}" data-cat="${c.n}">${c.e} ${c.n}</div>`).join('') +
    `<div class="chip add-chip" id="addCatChip">＋ New</div>`;
  $('ichips').innerHTML = html;
}

export function renderPayChips() {
  // Selected payment first (same reason). Built-in pay names keep their color
  // classes via data-pay; custom ones get pay-custom.
  const pays = [...state.PAYS].sort((a, b) => (a.n === state.selPay ? -1 : b.n === state.selPay ? 1 : 0));
  const html =
    pays.map((p) => {
      const cls = 'pay-chip' + (BUILTIN_PAYS.includes(p.n) ? '' : ' pay-custom') + (p.n === state.selPay ? ' on' : '');
      return `<div class="${cls}" data-pay="${p.n}">${p.e || '💰'} ${p.n}</div>`;
    }).join('') + `<div class="pay-chip add-chip" id="addPayChip">＋ New</div>`;
  $('ipaychips').innerHTML = html;
}

export function setPayChip(pay) {
  state.selPay = pay;
  document.querySelectorAll('#ipaychips .pay-chip').forEach((c) => c.classList.toggle('on', c.dataset.pay === pay && !c.classList.contains('add-chip')));
}

// ---- Split-with UI --------------------------------------------------------

// The members participating in the split, as {id,name,avatar} objects:
// - a chosen group -> its members;
// - loose friends -> the current user + the chosen friends;
// - nobody -> [] (personal expense).
function splitMembers() {
  if (state.selGroup) {
    const g = state.groups.find((x) => x.id === state.selGroup);
    return g ? g.members : [];
  }
  const friends = [...(state.splitFriends?.values() || [])];
  if (!friends.length) return [];
  const me = { id: state.user?.id, name: 'You', avatar: state.user?.avatar || null };
  return [me, ...friends];
}

// Members who actually take a share. In Equal mode, unchecked members are excluded
// (possibly leaving an empty list — the caller must validate before saving); other
// modes include everyone (a 0 weight already yields a 0 share).
function activeSplitMembers() {
  const all = splitMembers();
  if (state.selSplitMode !== 'equal') return all;
  const ex = state.splitExclude || new Set();
  return all.filter((m) => !ex.has(m.id));
}

let splitSearchSeq = 0;

// The "Split with" control: static line when locked in a group, else a search box
// (groups + friends) with the current selection shown as removable chips.
export function renderGroupChips() {
  const field = $('groupField');
  if (!cloudEnabled() || !state.user || state.groups.length === 0) {
    field.style.display = 'none';
    return;
  }
  field.style.display = 'block';

  // Adding from a group's detail page: locked to that group, no picker.
  if (state.groupPickLocked && state.selGroup) {
    const g = state.groups.find((x) => x.id === state.selGroup);
    $('splitLocked').style.display = '';
    $('splitLocked').innerHTML = `<span class="split-locked-ico">👥</span> Splitting in <strong>${g ? g.name : 'group'}</strong>`;
    $('splitPicker').style.display = 'none';
    renderSplitConfig();
    return;
  }
  $('splitLocked').style.display = 'none';
  $('splitPicker').style.display = '';
  // A group is a single, exclusive choice — once picked, hide the search input +
  // results entirely (no friends can be added). Removing the group chip brings it back.
  const groupChosen = !!state.selGroup;
  $('splitSearch').style.display = groupChosen ? 'none' : '';
  if (groupChosen) $('splitResults').innerHTML = '';
  renderSplitSelected();
  if (!groupChosen) renderSplitResults();
  renderSplitConfig();
}

// Chips for the current selection: the chosen group (cover + name), or the chosen
// friends (avatar only — no name, to stay compact).
function renderSplitSelected() {
  const wrap = $('splitSelected');
  if (state.selGroup) {
    const g = state.groups.find((x) => x.id === state.selGroup);
    wrap.innerHTML = `<span class="ng-chip split-group-selected"><span class="split-group-ico" style="${groupCoverBg(g)}"></span>${g ? g.name : 'Group'}<button class="ng-chip-x" data-clear-group aria-label="Remove">×</button></span>`;
    return;
  }
  const friends = [...(state.splitFriends?.values() || [])];
  wrap.innerHTML = friends
    .map(
      (f) => `<span class="split-friend-chip" title="${f.name}">
        ${f.avatar ? `<img class="split-friend-av" src="${f.avatar}" alt="${f.name}" referrerpolicy="no-referrer"/>` : `<span class="split-friend-av">${(f.name || '?').charAt(0).toUpperCase()}</span>`}
        <button class="split-friend-x" data-remove-friend="${f.id}" aria-label="Remove ${f.name}">×</button>
      </span>`,
    )
    .join('');
}

// The split-with results panel: hidden until the user focuses the search box. When
// open it shows a horizontal-scrolling strip of groups (icon + name) and, below, a
// vertical list of friends (~3 visible, scrollable). Typing filters both.
async function renderSplitResults() {
  const seq = ++splitSearchSeq;
  const q = $('splitSearch').value.trim();
  const out = $('splitResults');
  // Closed (not focused) and nothing typed -> show nothing.
  if (!state.splitPanelOpen && !q) {
    out.innerHTML = '';
    return;
  }
  // A chosen group makes the box inert until it's cleared.
  if (state.selGroup) {
    out.innerHTML = '';
    return;
  }
  const chosen = state.splitFriends || new Map();
  const groups = state.groups.filter((g) => !g.retired && !g.direct);
  const groupMatches = q ? groups.filter((g) => g.name.toLowerCase().includes(q.toLowerCase())) : groups;
  let friends = myFriends().filter((f) => !chosen.has(f.id));
  if (q) friends = matchFriends(friends, q);

  // Horizontal group strip.
  const groupStrip = groupMatches.length
    ? `<div class="split-groups-strip">${groupMatches
        .map(
          (g) => `<button class="split-group-chip" data-pick-group="${g.id}">
            <span class="split-group-ico" style="${groupCoverBg(g)}"></span>
            <span class="split-group-name">${g.name}</span>
          </button>`,
        )
        .join('')}</div>`
    : '';

  // Vertical friends list (scrollable; ~3 rows tall via CSS).
  let friendRows = friends
    .map((f) => `<button class="member-result" data-pick-friend="${f.id}" data-name="${encodeURIComponent(f.name)}" data-avatar="${f.avatar ? encodeURIComponent(f.avatar) : ''}">${avatarDot(f)}<span class="member-row-name">${f.name}</span><span class="member-add-plus">+</span></button>`)
    .join('');
  if (!friendRows && q && q.replace(/\D/g, '').length >= 10) {
    const u = await findUserByPhone(q);
    if (seq !== splitSearchSeq) return;
    if (u && !chosen.has(u.id)) friendRows = `<button class="member-result" data-pick-friend="${u.id}" data-name="${encodeURIComponent(u.name)}" data-avatar="${u.avatar ? encodeURIComponent(u.avatar) : ''}">${avatarDot(u)}<span class="member-row-name">${u.name}</span><span class="member-add-plus">+</span></button>`;
  }
  const friendsList = friendRows ? `<div class="split-friends-list">${friendRows}</div>` : '';

  let html = groupStrip + friendsList;
  if (!html) html = '<div class="member-empty">No match. Search a group name, friend, or mobile number.</div>';
  if (seq === splitSearchSeq) out.innerHTML = html;
}

function avatarDot(f) {
  return f.avatar
    ? `<span class="member-row-av member-avatar"><img src="${f.avatar}" alt="" referrerpolicy="no-referrer"/></span>`
    : `<span class="member-row-av member-avatar">${(f.name || '?').charAt(0).toUpperCase()}</span>`;
}

// Show/hide the split-mode + per-member config for the current split target.
function renderSplitConfig() {
  const cfg = $('splitConfig');
  const members = splitMembers();
  if (!members.length) {
    cfg.style.display = 'none';
    return;
  }
  cfg.style.display = 'block';
  document.querySelectorAll('#isplitmode .split-mode').forEach((c) => c.classList.toggle('on', c.dataset.mode === state.selSplitMode));

  const weights = $('splitWeights');
  const exclude = state.splitExclude || (state.splitExclude = new Set());
  if (state.selSplitMode === 'equal') {
    // Each member has a checkbox; only checked members split the bill equally.
    weights.innerHTML = members
      .map((m) => {
        const on = !exclude.has(m.id);
        return `<label class="split-check-row${on ? '' : ' off'}">
          <span class="split-weight-av">${avatarDot(m)}</span>
          <span class="split-weight-name">${m.name}${m.id === state.user?.id && m.name !== 'You' ? ' (you)' : ''}</span>
          <input type="checkbox" class="split-include" data-member="${m.id}" ${on ? 'checked' : ''}/>
          <span class="split-check-box"></span>
        </label>`;
      })
      .join('');
  } else {
    const mode = state.selSplitMode; // amount | percent | shares
    weights.innerHTML = members
      .map((m) => {
        const val = state.splitWeights[m.id] ?? '';
        let affix;
        if (mode === 'percent') affix = `<input type="number" class="split-weight" data-member="${m.id}" value="${val}" placeholder="0" inputmode="decimal" min="0"/><span class="swf-unit swf-suffix">%</span>`;
        else if (mode === 'shares') affix = `<input type="number" class="split-weight" data-member="${m.id}" value="${val}" placeholder="0" inputmode="numeric" min="0"/><span class="swf-unit swf-suffix">×</span>`;
        else affix = `<span class="swf-unit swf-prefix">₹</span><input type="number" class="split-weight" data-member="${m.id}" value="${val}" placeholder="0" inputmode="decimal" min="0"/>`;
        return `<div class="split-weight-row">
          <span class="split-weight-av">${avatarDot(m)}</span>
          <span class="split-weight-name">${m.name}${m.id === state.user?.id && m.name !== 'You' ? ' (you)' : ''}</span>
          <span class="split-weight-field${mode === 'percent' || mode === 'shares' ? ' is-suffix' : ''}">${affix}</span>
        </div>`;
      })
      .join('');
  }
  renderSplitPreview();
  if (state.editGroupExpId && state.groupEditLocked) applyGroupLock();
}

// When every member's split field is filled EXCEPT one, auto-fill that last blank
// field with the remainder so the split always balances:
//   amount  -> (total expense amount) − sum(others)
//   percent -> 100 − sum(others)
// `changed` is the input the user just edited (so we don't overwrite it). Only fires
// when exactly one field is still blank; clamps the remainder at 0.
function autoFillLastWeight(changed) {
  if (state.selSplitMode === 'shares') return; // ratios have no fixed total to balance
  const inputs = [...$('splitWeights').querySelectorAll('.split-weight')];
  if (inputs.length < 2) return;
  const blanks = inputs.filter((i) => i.value.trim() === '');
  if (blanks.length !== 1) return;
  const last = blanks[0];
  if (last === changed) return; // don't fill the one being typed
  const filledSum = inputs.filter((i) => i !== last).reduce((s, i) => s + (parseFloat(i.value) || 0), 0);
  const percent = state.selSplitMode === 'percent';
  const cap = percent ? 100 : parseFloat($('iamt').value) || 0;
  const remainder = Math.max(0, Math.round((cap - filledSum) * 100) / 100);
  last.value = remainder;
  state.splitWeights[last.dataset.member] = remainder;
}

function renderSplitPreview() {
  const el = $('splitPreview');
  const memberObjs = activeSplitMembers();
  const members = memberObjs.map((m) => m.id);
  // Equal mode with everyone unchecked: warn instead of silently splitting.
  if (state.selSplitMode === 'equal' && !members.length) {
    el.textContent = 'Select at least one person to split with.';
    el.style.color = 'var(--neg)';
    return;
  }
  el.style.color = '';
  const amt = parseFloat($('iamt').value);
  if (!members.length || !amt || amt <= 0) {
    el.textContent = '';
    return;
  }
  try {
    const shares = computeSplits({ amount: amt, members, mode: state.selSplitMode, weights: state.splitWeights, payerId: state.user?.id });
    const byId = Object.fromEntries(shares.map((s) => [s.userId, s.share]));
    el.textContent = memberObjs.map((m) => `${m.name.split(' ')[0]}: ${fmt(byId[m.id] || 0)}`).join('  ·  ');
    // Flag a mismatch live for amount / percent so it's obvious before saving.
    const sumW = members.reduce((s, id) => s + (Number(state.splitWeights[id]) || 0), 0);
    if (state.selSplitMode === 'amount' && Math.abs(sumW - amt) > 0.01) {
      el.textContent += `  —  ${sumW > amt ? 'over' : 'short'} by ${fmt(Math.abs(amt - sumW))}`;
      el.style.color = 'var(--neg)';
    } else if (state.selSplitMode === 'percent' && Math.abs(sumW - 100) > 0.01) {
      el.textContent += `  —  totals ${sumW}% (needs 100%)`;
      el.style.color = 'var(--neg)';
    }
  } catch (e) {
    el.textContent = '';
  }
}

// Restore the standard add/edit form fields (undo the personal-edit hiding).
function restoreFormFields() {
  $('amtField').style.display = '';
  $('idate').closest('.field').style.display = '';
}

export function showAdd() {
  state.editId = null;
  state.editMySplitId = null;
  restoreFormFields();
  state.selCat = initialCat();
  state.selPay = initialPay();
  state.selGroup = null;
  state.splitFriends = new Map();
  state.splitPanelOpen = false;
  state.selSplitMode = 'equal';
  state.splitWeights = {};
  state.splitExclude = new Set();
  state.editGroupExpId = null;
  state.groupEditLocked = false;
  state.groupPickLocked = false;
  $('iamt').disabled = false;
  const note0 = $('groupLockNote');
  if (note0) note0.style.display = 'none';
  $('form-title').textContent = 'Add expense';
  renderCatChips();
  renderPayChips();
  renderGroupChips();
  $('iamt').value = '';
  $('idesc').value = '';
  $('idate').value = isoDay(new Date());
  syncDateLabel();
  navTo('add'); // records the previous screen so Back/Save can return to it
  setTimeout(() => $('iamt').focus(), 100);
}

// Open the add form pre-tagged to a specific group, with the group locked (no
// "Just me" or other groups) — used by the + button on the group detail page.
export function showAddForGroup(groupId) {
  showAdd();
  const g = state.groups.find((x) => x.id === groupId);
  if (!g) return; // not a real group; leave as normal add
  if (g.retired) {
    // Retired groups are read-only; fall back to a normal (Just me) add.
    toastError('This group is retired — reactivate it to add expenses.');
    return;
  }
  state.selGroup = groupId;
  state.groupPickLocked = true;
  renderGroupChips();
}

export function showEdit(id) {
  const r = state.recs.find((x) => x.id === id);
  if (!r) return;
  state.editId = id;
  state.editGroupExpId = null;
  state.editMySplitId = null;
  state.groupEditLocked = false;
  restoreFormFields();
  $('iamt').disabled = false;
  state.selCat = r.cat;
  state.selPay = r.pay || initialPay();
  // If the record's category was deleted, keep it selectable for this edit.
  if (!state.CATS.find((c) => c.n === state.selCat)) {
    state.CATS.push({ n: state.selCat, e: '📦', c: '#808B96' });
  }
  // Same treatment for a payment method that was removed.
  if (state.selPay && !state.PAYS.find((p) => p.n === state.selPay)) {
    state.PAYS.push({ n: state.selPay, e: '💰' });
  }
  $('form-title').textContent = 'Edit expense';
  // Allow tagging a group to MOVE this personal expense into a group.
  state.selGroup = null;
  state.splitFriends = new Map();
  state.splitPanelOpen = false;
  state.selSplitMode = 'equal';
  state.splitWeights = {};
  state.splitExclude = new Set();
  renderCatChips();
  renderPayChips();
  renderGroupChips();
  $('iamt').value = r.amt;
  $('idesc').value = r.desc || '';
  $('idate').value = r.date;
  syncDateLabel();
  navTo('add');
  setTimeout(() => $('iamt').focus(), 100);
}

// Open the form to edit an existing group expense (payer only). Prefills the
// amount/description/category/date, tags the group, and restores the split mode.
// Existing per-member shares seed the weights so "amount" mode shows current values.
export function openEditGroup(gid) {
  const exp = state.groupExpenses.find((e) => e.id === gid);
  if (!exp) return;
  if (exp.payer_id !== state.user?.id) {
    toastError('Only the person who paid can edit this expense.');
    return;
  }
  state.editId = null;
  state.editGroupExpId = gid;
  state.editMySplitId = null;
  restoreFormFields();
  // Lock the money-affecting fields when someone's already settled OR the group
  // is retired (read-only balances). Category / payment / note stay editable.
  state.groupEditLocked = expenseHasPayment(gid) || isGroupRetired(exp.group_id);
  state.selCat = exp.category || initialCat();
  state.selPay = exp.pay || initialPay();
  state.selGroup = exp.group_id;
  state.selSplitMode = exp.split_mode || 'equal';
  // Seed weights from current splits (used by amount/percent modes).
  state.splitWeights = {};
  const splits = state.mySplits.filter((s) => s.expense_id === gid);
  if (state.selSplitMode === 'amount') {
    splits.forEach((s) => (state.splitWeights[s.debtor_id] = Number(s.share_amount)));
  } else if (state.selSplitMode === 'percent') {
    const total = Number(exp.amount) || 1;
    splits.forEach((s) => (state.splitWeights[s.debtor_id] = Math.round((Number(s.share_amount) / total) * 100)));
  }
  if (!state.CATS.find((c) => c.n === state.selCat)) {
    state.CATS.push({ n: state.selCat, e: '📦', c: '#808B96' });
  }
  $('form-title').textContent = 'Edit group expense';
  renderCatChips();
  renderPayChips();
  renderGroupChips();
  $('iamt').value = exp.amount;
  $('idesc').value = exp.description || '';
  $('idate').value = exp.spent_on;
  syncDateLabel();
  // When a payment has already been made, lock the money-affecting fields.
  applyGroupLock();
  navTo('add');
  setTimeout(() => $('iamt').focus(), 100);
}

// Open a limited form for a debtor to personalize their OWN settled share of a
// group expense — category, payment type, and note only. Amount, group tag, and
// split are hidden; nothing here affects other members or the shared expense.
export function openEditMySplit(splitId) {
  const split = state.mySplits.find((s) => s.id === splitId && s.debtor_id === state.user?.id);
  if (!split) return;
  const exp = state.groupExpenses.find((e) => e.id === split.expense_id);
  state.editId = null;
  state.editGroupExpId = null;
  state.groupEditLocked = false;
  state.editMySplitId = splitId;
  state.selGroup = null; // no group tagging in this personal-edit mode
  // Personal category defaults to any prior override, else the expense's category.
  state.selCat = split.cat || exp?.category || initialCat();
  if (!state.CATS.find((c) => c.n === state.selCat)) {
    state.CATS.push({ n: state.selCat, e: '📦', c: '#808B96' });
  }
  state.selPay = split.pay || initialPay();
  $('form-title').textContent = 'Personalize expense';
  // Hide amount + group/split; show only category, payment, note.
  $('amtField').style.display = 'none';
  $('groupField').style.display = 'none';
  $('idate').closest('.field').style.display = 'none';
  renderCatChips();
  renderPayChips();
  $('idesc').value = split.note || exp?.description || '';
  navTo('add');
}

// Enable/disable amount, group picker, and split-mode based on state.groupEditLocked.
function applyGroupLock() {
  const locked = state.groupEditLocked;
  $('iamt').disabled = locked;
  document.querySelectorAll('#splitPicker .split-search, #isplitmode .pay-chip, #splitWeights .split-weight').forEach((el) => {
    if (el.tagName === 'INPUT') el.disabled = locked;
    el.classList.toggle('locked', locked);
  });
  let note = $('groupLockNote');
  if (locked) {
    if (!note) {
      note = document.createElement('div');
      note.id = 'groupLockNote';
      note.className = 'lock-note';
      $('groupField').appendChild(note);
    }
    // Distinguish the two lock reasons for a clearer message.
    const retired = state.selGroup && isGroupRetired(state.selGroup);
    note.textContent = retired
      ? 'This group is retired — amount and split are locked. You can still edit the note, category, payment and date.'
      : 'Someone has already settled — amount, group and split type are locked. You can still edit the note, category and date.';
    note.style.display = 'block';
  } else if (note) {
    note.style.display = 'none';
  }
}

// ---- Date stepper ---------------------------------------------------------
// The native <input type="date" id="idate"> stays the source of truth (all
// value reads/writes elsewhere keep working); the stepper just drives it.

// Refresh the friendly label ("Today" / "Yesterday" / "Wed, 5 Feb") from idate.
export function syncDateLabel() {
  const v = $('idate').value || isoDay(new Date());
  $('dsLabel').textContent = friendlyDate(v);
}

// Move the selected date by `delta` days and update the label.
function stepDate(delta) {
  const cur = $('idate').value ? new Date($('idate').value + 'T00:00:00') : new Date();
  cur.setDate(cur.getDate() + delta);
  $('idate').value = isoDay(cur);
  syncDateLabel();
}

function initDateStepper() {
  $('dsPrev').onclick = () => stepDate(-1);
  $('dsNext').onclick = () => stepDate(1);
  // Tap the label to open the native calendar for far-off dates.
  $('dsLabel').onclick = () => {
    const inp = $('idate');
    if (typeof inp.showPicker === 'function') {
      try {
        inp.showPicker();
        return;
      } catch {
        /* fall through to focus */
      }
    }
    inp.focus();
    inp.click();
  };
  // Keep the label in sync if the native picker changes the value.
  $('idate').addEventListener('change', syncDateLabel);

  // Swipe left = previous day, right = next day (matches the ‹ / › arrows).
  let startX = null;
  let startY = null;
  const stepper = $('dateStepper');
  stepper.addEventListener(
    'touchstart',
    (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    },
    { passive: true },
  );
  stepper.addEventListener(
    'touchend',
    (e) => {
      if (startX == null) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      startX = startY = null;
      // Horizontal swipe past the threshold, and clearly more horizontal than vertical.
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        stepDate(dx > 0 ? -1 : 1); // swipe right -> yesterday (past), left -> tomorrow (future)
      }
    },
    { passive: true },
  );
}

export function initAddEdit() {
  $('addbtn').onclick = showAdd;
  initDateStepper();

  $('backbtn').onclick = () => {
    // Return to whichever screen opened the form (home, category, group detail…).
    const to = navBack();
    renderForScreen(to);
  };

  $('ichips').addEventListener('click', (e) => {
    if (e.target.closest('#addCatChip')) {
      openCatModal();
      return;
    }
    const chip = e.target.closest('.chip');
    if (!chip || chip.classList.contains('add-chip')) return;
    state.selCat = chip.dataset.cat;
    document.querySelectorAll('#ichips .chip').forEach((c) => c.classList.toggle('on', c === chip));
  });

  $('ipaychips').addEventListener('click', (e) => {
    if (e.target.closest('#addPayChip')) {
      openPayModal();
      return;
    }
    const chip = e.target.closest('.pay-chip');
    if (!chip || chip.classList.contains('add-chip')) return;
    setPayChip(chip.dataset.pay);
  });

  // Split-with search: opens the results panel on focus; type to filter. Blur closes
  // it (deferred so a result click registers first).
  $('splitSearch').addEventListener('focus', () => {
    state.splitPanelOpen = true;
    renderSplitResults();
  });
  $('splitSearch').addEventListener('blur', () => {
    setTimeout(() => {
      state.splitPanelOpen = false;
      if (!$('splitSearch').value.trim()) renderSplitResults();
    }, 150);
  });
  $('splitSearch').addEventListener('input', renderSplitResults);
  // Tapping a result must NOT blur the search input (which would close the panel via
  // the blur timer). Prevent the default focus-steal so the input keeps focus and the
  // panel stays open — essential for picking multiple friends in a row.
  $('splitResults').addEventListener('mousedown', (e) => {
    if (e.target.closest('[data-pick-friend], [data-pick-group]')) e.preventDefault();
  });
  // Pick a group or friend from the results.
  $('splitResults').addEventListener('click', (e) => {
    const gBtn = e.target.closest('[data-pick-group]');
    const fBtn = e.target.closest('[data-pick-friend]');
    if (gBtn) {
      // A group is exclusive: replace any friends and collapse the picker.
      state.selGroup = gBtn.dataset.pickGroup;
      state.splitFriends = new Map();
      state.splitWeights = {};
      state.splitPanelOpen = false;
      $('splitSearch').value = '';
      renderGroupChips();
    } else if (fBtn) {
      // Friends are multi-select: add and KEEP the panel open so more can be picked.
      state.selGroup = null;
      const av = fBtn.dataset.avatar ? decodeURIComponent(fBtn.dataset.avatar) : null;
      state.splitFriends.set(fBtn.dataset.pickFriend, { id: fBtn.dataset.pickFriend, name: decodeURIComponent(fBtn.dataset.name), avatar: av });
      state.splitWeights = {};
      state.splitPanelOpen = true;
      $('splitSearch').value = '';
      renderSplitSelected();
      renderSplitResults(); // refresh so the picked friend drops out of the list
      renderSplitConfig();
      $('splitSearch').focus(); // keep focus for the next pick
    }
  });
  // Remove a selection (clear the group, or remove a friend chip).
  $('splitSelected').addEventListener('click', (e) => {
    if (e.target.closest('[data-clear-group]')) {
      state.selGroup = null;
    } else {
      const rm = e.target.closest('[data-remove-friend]');
      if (!rm) return;
      state.splitFriends.delete(rm.dataset.removeFriend);
    }
    state.splitWeights = {};
    renderGroupChips();
  });

  // Split-mode selector.
  $('isplitmode').addEventListener('click', (e) => {
    if (state.groupEditLocked) return; // locked once a payment is made
    const chip = e.target.closest('.split-mode');
    if (!chip) return;
    state.selSplitMode = chip.dataset.mode;
    renderSplitConfig();
  });

  // Equal-mode include/exclude checkboxes.
  $('splitWeights').addEventListener('change', (e) => {
    const box = e.target.closest('.split-include');
    if (!box) return;
    const id = box.dataset.member;
    if (box.checked) state.splitExclude.delete(id);
    else state.splitExclude.add(id);
    renderSplitConfig();
  });

  // Per-member weight inputs (amount / percent / shares modes).
  $('splitWeights').addEventListener('input', (e) => {
    const input = e.target.closest('.split-weight');
    if (!input) return;
    state.splitWeights[input.dataset.member] = parseFloat(input.value) || 0;
    autoFillLastWeight(input); // once only one person is blank, fill their remainder
    renderSplitPreview();
  });

  // Keep the split preview in sync as the amount changes.
  $('iamt').addEventListener('input', () => {
    renderSplitPreview();
  });

  $('savebtn').onclick = async function () {
    const btn = $('savebtn');
    if (btn.disabled) return; // guard against double-submit
    const origLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await doSave();
    } finally {
      btn.disabled = false;
      btn.textContent = origLabel;
    }
  };

  async function doSave() {
    // Personal-edit mode: only my category/payment/note on a settled group split.
    if (state.editMySplitId) {
      const ok = await updateMySplitMeta(state.editMySplitId, {
        cat: state.selCat,
        pay: state.selPay,
        note: $('idesc').value.trim() || null,
      });
      if (ok) {
        state.editMySplitId = null;
        renderForScreen(navBack());
      }
      return;
    }

    const amt = parseFloat($('iamt').value);
    if (!amt || amt <= 0) {
      $('iamt').focus();
      return;
    }
    const desc = $('idesc').value.trim();
    const date = $('idate').value || isoDay(new Date());

    // Split expense: a chosen group, an in-group locked add, editing an existing group
    // expense, moving a personal expense into a group, OR splitting with loose friends
    // (resolved to a hidden "direct" container). Not for plain personal edits.
    const hasFriends = state.splitFriends && state.splitFriends.size > 0;
    if ((state.selGroup || hasFriends) && !state.editMySplitId) {
      // Loose friends with no group -> find/create the direct container, then treat it
      // like any group below.
      if (!state.selGroup && hasFriends) {
        const gid = await findOrCreateDirectSplit([...state.splitFriends.keys()]);
        if (!gid) {
          toastError('Could not set up the split. Try again.');
          return;
        }
        state.selGroup = gid;
      }
      // Retired group + editing an existing expense: labels only (amount/split are
      // frozen). Skip the split recompute entirely and update just the meta fields.
      if (state.editGroupExpId && isGroupRetired(state.selGroup)) {
        const ok = await updateGroupExpenseMeta({
          expenseId: state.editGroupExpId,
          description: desc,
          category: state.selCat,
          pay: state.selPay,
        });
        if (ok) {
          state.editGroupExpId = null;
          state.groupEditLocked = false;
          toastSuccess('Updated');
          renderForScreen(navBack());
        }
        return;
      }
      const members = activeSplitMembers().map((m) => m.id);
      if (!members.length) {
        toastError('Pick at least one person to split with.');
        return;
      }
      // Validate the split adds up before saving (no silent remainder absorption).
      const sumW = members.reduce((s, id) => s + (Number(state.splitWeights[id]) || 0), 0);
      if (state.selSplitMode === 'amount' && Math.abs(sumW - amt) > 0.01) {
        toastError(`Amounts add up to ${fmt(sumW)}, but the total is ${fmt(amt)}.`);
        return;
      }
      if (state.selSplitMode === 'percent' && Math.abs(sumW - 100) > 0.01) {
        toastError(`Percentages add up to ${sumW}%, but they must total 100%.`);
        return;
      }
      if (state.selSplitMode === 'shares' && sumW <= 0) {
        toastError('Enter a share for at least one person.');
        return;
      }
      let shares;
      try {
        shares = computeSplits({ amount: amt, members, mode: state.selSplitMode, weights: state.splitWeights, payerId: state.user?.id });
      } catch (err) {
        toastError('Check the split values: ' + err.message);
        return;
      }
      const ok = state.editGroupExpId
        ? await editGroupExpense({
            expenseId: state.editGroupExpId,
            amount: amt,
            description: desc,
            category: state.selCat,
            pay: state.selPay,
            spentOn: date,
            splitMode: state.selSplitMode,
            shares,
          })
        : await saveGroupExpense({
            groupId: state.selGroup,
            amount: amt,
            description: desc,
            category: state.selCat,
            pay: state.selPay,
            spentOn: date,
            splitMode: state.selSplitMode,
            shares,
          });
      if (ok) {
        // Converting an existing personal expense: remove the local record (it
        // now lives in the group). Tombstone it if cloud sync is on.
        if (state.editId) {
          const rec = state.recs.find((r) => r.id === state.editId);
          if (rec && syncOn()) pushRecord({ ...rec, deleted: true, updated: Date.now() });
          state.recs = state.recs.filter((r) => r.id !== state.editId);
          persist();
          toastSuccess('Moved to group');
        }
        // Return to whichever screen opened the form. When added from a group's
        // detail page that's the group itself; otherwise home/category.
        state.groupPickLocked = false;
        const to = navBack();
        renderForScreen(to);
      }
      return;
    }

    if (state.editId) {
      const idx = state.recs.findIndex((r) => r.id === state.editId);
      if (idx > -1) {
        state.recs[idx] = { ...state.recs[idx], amt, cat: state.selCat, pay: state.selPay, desc, date, updated: Date.now() };
        pushRecord(state.recs[idx]);
      }
    } else {
      const rec = { id: Date.now(), amt, cat: state.selCat, pay: state.selPay, desc, date, updated: Date.now() };
      state.recs.push(rec);
      pushRecord(rec);
    }
    persist();
    // Return to the screen that opened the form (home / category detail / …).
    const to = navBack();
    renderForScreen(to);
  }
}
