// Styled confirm dialog — a promise-based replacement for window.confirm().

import { $ } from './dom.js';
import { state } from './state.js';
import { BUILTIN_PAYS } from './constants.js';

/**
 * Show a modern confirm modal.
 * @param {string} message   body text
 * @param {object} [opts]     { title, confirmLabel, cancelLabel, danger }
 * @returns {Promise<boolean>} resolves true if confirmed
 */
export function confirmModal(message, { title = 'Confirm', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const modal = $('confirmModal');
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = message;
    const yes = $('confirmYes');
    const no = $('confirmNo');
    yes.textContent = confirmLabel;
    no.textContent = cancelLabel;
    yes.classList.toggle('danger-btn', danger);
    const done = (val) => {
      modal.classList.remove('open');
      yes.onclick = null;
      no.onclick = null;
      modal.onclick = null;
      resolve(val);
    };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    modal.onclick = (e) => {
      if (e.target === modal) done(false);
    };
    modal.classList.add('open');
  });
}

// Settle payment-method picker. Resolves { confirmed, pay } — pay is the chosen
// method (or null if skipped). Resolves { confirmed:false } if cancelled.
export function pickSettlePayment() {
  return new Promise((resolve) => {
    const modal = $('settlePayModal');
    let sel = null;
    const chips = $('settlePayChips');
    const render = () => {
      chips.innerHTML = state.PAYS.map((p) => {
        const cls = 'pay-chip' + (BUILTIN_PAYS.includes(p.n) ? '' : ' pay-custom') + (p.n === sel ? ' on' : '');
        return `<div class="${cls}" data-pay="${p.n}">${p.e || '💰'} ${p.n}</div>`;
      }).join('');
    };
    render();
    chips.onclick = (e) => {
      const chip = e.target.closest('.pay-chip');
      if (!chip) return;
      sel = chip.dataset.pay;
      render();
    };
    const done = (confirmed) => {
      modal.classList.remove('open');
      chips.onclick = null;
      $('settlePayConfirm').onclick = null;
      $('settlePaySkip').onclick = null;
      modal.onclick = null;
      resolve({ confirmed, pay: sel });
    };
    $('settlePayConfirm').onclick = () => done(true);
    $('settlePaySkip').onclick = () => done(true); // settle without a method
    modal.onclick = (e) => {
      if (e.target === modal) done(false);
    };
    modal.classList.add('open');
  });
}
