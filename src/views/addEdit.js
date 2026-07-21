// Add / edit expense screen: category & payment chips, form population, and save.

import { state } from '../state.js';
import { BUILTIN_PAYS } from '../constants.js';
import { isoDay, initialCat, initialPay } from '../format.js';
import { persist } from '../storage.js';
import { $ } from '../dom.js';
import { render, showHome } from './home.js';
import { renderCategoryView } from './category.js';
import { openCatModal } from '../features/categories.js';
import { openPayModal } from '../features/payments.js';

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

export function showAdd() {
  state.editId = null;
  state.selCat = initialCat();
  state.selPay = initialPay();
  $('form-title').textContent = 'Add expense';
  renderCatChips();
  renderPayChips();
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

  $('savebtn').onclick = function () {
    const amt = parseFloat($('iamt').value);
    if (!amt || amt <= 0) {
      $('iamt').focus();
      return;
    }
    const desc = $('idesc').value.trim();
    const date = $('idate').value || isoDay(new Date());
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
