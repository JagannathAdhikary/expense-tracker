// "Set defaults" modal — choose the default category and payment method.

import { state } from '../state.js';
import { BUILTIN_PAYS } from '../constants.js';
import { persistPrefs } from '../storage.js';
import { $ } from '../dom.js';

let defCatSel = null;
let defPaySel = null;

function renderDefaultChips() {
  $('defCatChips').innerHTML = state.CATS.map((c) => `<div class="chip${c.n === defCatSel ? ' on' : ''}" data-cat="${c.n}">${c.e} ${c.n}</div>`).join('');
  $('defPayChips').innerHTML = state.PAYS.map((p) => {
    const cls = 'pay-chip' + (BUILTIN_PAYS.includes(p.n) ? '' : ' pay-custom') + (p.n === defPaySel ? ' on' : '');
    return `<div class="${cls}" data-pay="${p.n}">${p.e || '💰'} ${p.n}</div>`;
  }).join('');
}

export function initDefaults() {
  $('defaultsBtn').onclick = () => {
    $('overlay').classList.remove('open');
    defCatSel = state.PREFS.defaultCat && state.CATS.find((c) => c.n === state.PREFS.defaultCat) ? state.PREFS.defaultCat : state.CATS[0] ? state.CATS[0].n : null;
    defPaySel = state.PREFS.defaultPay && state.PAYS.find((p) => p.n === state.PREFS.defaultPay) ? state.PREFS.defaultPay : state.PAYS[0] ? state.PAYS[0].n : null;
    renderDefaultChips();
    $('defModal').classList.add('open');
  };
  $('defCancel').onclick = () => $('defModal').classList.remove('open');
  $('defModal').onclick = (e) => {
    if (e.target === $('defModal')) $('defModal').classList.remove('open');
  };

  $('defCatChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    defCatSel = chip.dataset.cat;
    renderDefaultChips();
  });
  $('defPayChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.pay-chip');
    if (!chip) return;
    defPaySel = chip.dataset.pay;
    renderDefaultChips();
  });

  $('defSave').onclick = function () {
    state.PREFS.defaultCat = defCatSel;
    state.PREFS.defaultPay = defPaySel;
    persistPrefs();
    $('defModal').classList.remove('open');
  };
}
