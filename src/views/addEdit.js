// Add / edit expense screen: category & payment chips, form population, and save.

import { state } from '../state.js';
import { BUILTIN_PAYS } from '../constants.js';
import { isoDay, initialCat, initialPay, fmt } from '../format.js';
import { persist } from '../storage.js';
import { $ } from '../dom.js';
import { render, showHome } from './home.js';
import { renderCategoryView } from './category.js';
import { openCatModal } from '../features/categories.js';
import { openPayModal } from '../features/payments.js';
import { cloudEnabled } from '../supabase.js';
import { computeSplits } from '../split.js';
import { saveGroupExpense } from '../features/groups.js';

export function renderCatChips() {
  const html =
    state.CATS.map((c) => `<div class="chip${c.n === state.selCat ? ' on' : ''}" data-cat="${c.n}">${c.e} ${c.n}</div>`).join('') +
    `<div class="chip add-chip" id="addCatChip">＋ New</div>`;
  $('ichips').innerHTML = html;
}

export function renderPayChips() {
  // Built-in pay names keep their color classes via data-pay; custom ones get pay-custom.
  const html =
    state.PAYS.map((p) => {
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
  $('igroupchips').innerHTML =
    `<div class="chip${state.selGroup === null ? ' on' : ''}" data-group="">Just me</div>` +
    state.groups.map((g) => `<div class="chip${g.id === state.selGroup ? ' on' : ''}" data-group="${g.id}">👥 ${g.name}</div>`).join('');
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

export function showAdd() {
  state.editId = null;
  state.selCat = initialCat();
  state.selPay = initialPay();
  state.selGroup = null;
  state.selSplitMode = 'equal';
  state.splitWeights = {};
  $('form-title').textContent = 'Add expense';
  renderCatChips();
  renderPayChips();
  renderGroupChips();
  $('iamt').value = '';
  $('idesc').value = '';
  $('idate').value = isoDay(new Date());
  $('home').classList.remove('active');
  $('catview').classList.remove('active');
  $('add').classList.add('active');
  setTimeout(() => $('iamt').focus(), 100);
}

export function showEdit(id) {
  const r = state.recs.find((x) => x.id === id);
  if (!r) return;
  state.editId = id;
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
  state.selGroup = null; // group expenses are cloud-managed; local edit only
  $('groupField').style.display = 'none';
  renderCatChips();
  renderPayChips();
  $('iamt').value = r.amt;
  $('idesc').value = r.desc || '';
  $('idate').value = r.date;
  $('home').classList.remove('active');
  $('catview').classList.remove('active');
  $('add').classList.add('active');
  setTimeout(() => $('iamt').focus(), 100);
}

export function initAddEdit() {
  $('addbtn').onclick = showAdd;

  $('backbtn').onclick = () => {
    // If we came from a category view (still set), return there; else home.
    if (state.filterCat) {
      $('add').classList.remove('active');
      $('catview').classList.add('active');
      render();
      renderCategoryView();
    } else showHome();
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
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.selGroup = chip.dataset.group || null;
    state.splitWeights = {};
    renderGroupChips();
  });

  // Split-mode selector.
  $('isplitmode').addEventListener('click', (e) => {
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
    const amt = parseFloat($('iamt').value);
    if (!amt || amt <= 0) {
      $('iamt').focus();
      return;
    }
    const desc = $('idesc').value.trim();
    const date = $('idate').value || isoDay(new Date());

    // Group-tagged expense (new only): write to the cloud, then return home.
    if (state.selGroup && !state.editId) {
      const members = taggedGroupMembers().map((m) => m.id);
      let shares;
      try {
        shares = computeSplits({ amount: amt, members, mode: state.selSplitMode, weights: state.splitWeights, payerId: state.user?.id });
      } catch (err) {
        alert('Check the split values: ' + err.message);
        return;
      }
      const ok = await saveGroupExpense({
        groupId: state.selGroup,
        amount: amt,
        description: desc,
        category: state.selCat,
        spentOn: date,
        splitMode: state.selSplitMode,
        shares,
      });
      if (ok) showHome();
      return;
    }

    if (state.editId) {
      const idx = state.recs.findIndex((r) => r.id === state.editId);
      if (idx > -1) state.recs[idx] = { ...state.recs[idx], amt, cat: state.selCat, pay: state.selPay, desc, date };
    } else {
      state.recs.push({ id: Date.now(), amt, cat: state.selCat, pay: state.selPay, desc, date });
    }
    persist();
    if (state.filterCat) {
      // If user changed the record's category away from filter, stay on filter view anyway.
      $('add').classList.remove('active');
      $('catview').classList.add('active');
      render();
      renderCategoryView();
    } else showHome();
  };
}
