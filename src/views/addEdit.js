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
import { saveGroupExpense, editGroupExpense, updateMySplitMeta, updateGroupExpenseMeta, isGroupRetired } from '../features/groups.js';
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

// ---- Group split UI -------------------------------------------------------

// The members of the currently-tagged group (empty if none / not signed in).
function taggedGroupMembers() {
  const g = state.groups.find((x) => x.id === state.selGroup);
  return g ? g.members : [];
}

// Render the group picker chips. Only shown when signed in with ≥1 group.
export function renderGroupChips() {
  const field = $('groupField');
  if (!cloudEnabled() || !state.user || state.groups.length === 0) {
    field.style.display = 'none';
    return;
  }
  field.style.display = 'block';
  if (state.groupPickLocked && state.selGroup) {
    // Adding from a group's detail page: this expense belongs to that group only.
    const g = state.groups.find((x) => x.id === state.selGroup);
    $('igroupchips').innerHTML = `<div class="chip on" data-group="${state.selGroup}">👥 ${g ? g.name : 'Group'}</div>`;
    renderSplitConfig();
    return;
  }
  $('igroupchips').innerHTML =
    `<div class="chip${state.selGroup === null ? ' on' : ''}" data-group="">Just me</div>` +
    state.groups.filter((g) => !g.retired).map((g) => `<div class="chip${g.id === state.selGroup ? ' on' : ''}" data-group="${g.id}">👥 ${g.name}</div>`).join('');
  renderSplitConfig();
}

// Show/hide the split-mode + per-member config for the tagged group.
function renderSplitConfig() {
  const cfg = $('splitConfig');
  if (!state.selGroup) {
    cfg.style.display = 'none';
    return;
  }
  cfg.style.display = 'block';
  document.querySelectorAll('#isplitmode .pay-chip').forEach((c) => c.classList.toggle('on', c.dataset.mode === state.selSplitMode));

  const members = taggedGroupMembers();
  const weights = $('splitWeights');
  if (state.selSplitMode === 'equal') {
    weights.innerHTML = '';
  } else {
    const unit = state.selSplitMode === 'percent' ? '%' : '₹';
    weights.innerHTML = members
      .map((m) => {
        const val = state.splitWeights[m.id] ?? '';
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="flex:1;font-size:13px">${m.name}${m.id === state.user?.id ? ' (you)' : ''}</span>
          <input type="number" class="split-weight" data-member="${m.id}" value="${val}" placeholder="${unit}" inputmode="decimal" style="width:90px;padding:8px"/>
        </div>`;
      })
      .join('');
  }
  renderSplitPreview();
  if (state.editGroupExpId && state.groupEditLocked) applyGroupLock();
}

function renderSplitPreview() {
  const el = $('splitPreview');
  const members = taggedGroupMembers().map((m) => m.id);
  const amt = parseFloat($('iamt').value);
  if (!state.selGroup || !amt || amt <= 0 || members.length === 0) {
    el.textContent = '';
    return;
  }
  try {
    const shares = computeSplits({ amount: amt, members, mode: state.selSplitMode, weights: state.splitWeights, payerId: state.user?.id });
    const byId = Object.fromEntries(shares.map((s) => [s.userId, s.share]));
    const names = taggedGroupMembers();
    el.textContent = names.map((m) => `${m.name.split(' ')[0]}: ${fmt(byId[m.id] || 0)}`).join('  ·  ');
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
  state.selSplitMode = 'equal';
  state.splitWeights = {};
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
  state.selSplitMode = 'equal';
  state.splitWeights = {};
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
  document.querySelectorAll('#igroupchips .chip, #isplitmode .pay-chip, #splitWeights .split-weight').forEach((el) => {
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

  // Group picker: "Just me" (null) or a specific group.
  $('igroupchips').addEventListener('click', (e) => {
    if (state.groupEditLocked || state.groupPickLocked) return; // locked (payment made, or added from group page)
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.selGroup = chip.dataset.group || null;
    state.splitWeights = {};
    renderGroupChips();
  });

  // Split-mode selector.
  $('isplitmode').addEventListener('click', (e) => {
    if (state.groupEditLocked) return; // locked once a payment is made
    const chip = e.target.closest('.pay-chip');
    if (!chip) return;
    state.selSplitMode = chip.dataset.mode;
    renderGroupChips();
  });

  // Per-member weight inputs (amount / percent modes).
  $('splitWeights').addEventListener('input', (e) => {
    const input = e.target.closest('.split-weight');
    if (!input) return;
    state.splitWeights[input.dataset.member] = parseFloat(input.value) || 0;
    renderSplitPreview();
  });

  // Keep the split preview in sync as the amount changes.
  $('iamt').addEventListener('input', () => {
    if (state.selGroup) renderSplitPreview();
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

    // Group expense: creating new, editing an existing group expense, or MOVING
    // a personal expense into a group. (Not when plain-editing a personal record.)
    if (state.selGroup && !state.editMySplitId) {
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
      const members = taggedGroupMembers().map((m) => m.id);
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
