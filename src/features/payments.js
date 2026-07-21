// Manage-payment-methods sheet and the add-payment modal.

import { state } from '../state.js';
import { persistPays, persistPrefs } from '../storage.js';
import { $ } from '../dom.js';
import { renderPayChips } from '../views/addEdit.js';
import { toastError } from '../toast.js';

function renderPayManage() {
  const list = $('payManageList');
  const counts = {};
  state.recs.forEach((r) => {
    const k = r.pay || '';
    if (k) counts[k] = (counts[k] || 0) + 1;
  });
  list.innerHTML =
    state.PAYS.map((p) => {
      const n = counts[p.n] || 0;
      const isDefault = state.PREFS.defaultPay === p.n;
      return `<div class="cat-manage-row">
      <div class="cm-ico" style="background:#eef1f6">${p.e || '💰'}</div>
      <div class="cm-name">${p.n}${isDefault ? ' <span class="default-star" title="Default">★</span>' : ''}</div>
      <span class="cm-count">${n} ${n === 1 ? 'entry' : 'entries'}</span>
      <button class="cm-del" data-pay="${p.n}" title="Remove">🗑</button>
    </div>`;
    }).join('') || '<div style="color:#888;font-size:13px;padding:8px 0">No payment methods yet.</div>';
}

export function openPayModal() {
  $('pName').value = '';
  $('pEmoji').value = '';
  $('payModal').classList.add('open');
  setTimeout(() => $('pName').focus(), 100);
}

export function initPayments() {
  $('managePaysBtn').onclick = () => {
    $('overlay').classList.remove('open');
    renderPayManage();
    $('payOverlay').classList.add('open');
  };
  $('closePaySheet').onclick = () => $('payOverlay').classList.remove('open');
  $('payOverlay').onclick = (e) => {
    if (e.target === $('payOverlay')) $('payOverlay').classList.remove('open');
  };

  $('payManageList').addEventListener('click', (e) => {
    const btn = e.target.closest('.cm-del');
    if (!btn) return;
    const name = btn.dataset.pay;
    const count = state.recs.filter((r) => r.pay === name).length;
    let msg = `Remove payment method "${name}" from the picker?`;
    if (count) msg += `\n\n${count} existing ${count === 1 ? 'entry' : 'entries'} still tagged "${name}" will be kept — the option just won't appear when adding new expenses.`;
    if (!confirm(msg)) return;
    state.PAYS = state.PAYS.filter((p) => p.n !== name);
    // If the removed one was the default, clear the pref so we don't auto-select a missing option.
    if (state.PREFS.defaultPay === name) {
      state.PREFS.defaultPay = null;
      persistPrefs();
    }
    persistPays();
    renderPayManage();
  });

  $('addPayBtn').onclick = openPayModal;
  $('pCancel').onclick = () => $('payModal').classList.remove('open');
  $('payModal').onclick = (e) => {
    if (e.target === $('payModal')) $('payModal').classList.remove('open');
  };

  $('pSave').onclick = function () {
    const name = $('pName').value.trim();
    const emoji = $('pEmoji').value.trim() || '💰';
    if (!name) {
      $('pName').focus();
      return;
    }
    if (state.PAYS.find((p) => p.n.toLowerCase() === name.toLowerCase())) {
      toastError('A payment method with that name already exists.');
      return;
    }
    state.PAYS.push({ n: name, e: emoji });
    persistPays();
    $('payModal').classList.remove('open');
    // If add-expense form is open, refresh chips and select the new one.
    if ($('add').classList.contains('active')) {
      state.selPay = name;
      renderPayChips();
    }
    if ($('payOverlay').classList.contains('open')) renderPayManage();
  };
}
