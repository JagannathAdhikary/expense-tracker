// Payment-method management inside the Preferences sheet: list rows with a
// set-default pill + remove, and the add-payment modal.

import { state } from '../state.js';
import { persistPays, persistPrefs } from '../storage.js';
import { $ } from '../dom.js';
import { renderPayChips } from '../views/addEdit.js';
import { toastError } from '../toast.js';
import { confirmModal } from '../confirm.js';

// Modern outline trash icon (matches the one used for category rows).
const TRASH_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

// Guarantee a valid default payment method: if none is set (new user) or the
// saved one no longer exists (was deleted), fall back to the top-most method.
// Persists only when it actually changes.
export function ensureDefaultPay() {
  const has = state.PREFS.defaultPay && state.PAYS.some((p) => p.n === state.PREFS.defaultPay);
  if (!has) {
    const top = state.PAYS[0] ? state.PAYS[0].n : null;
    if (state.PREFS.defaultPay !== top) {
      state.PREFS.defaultPay = top;
      persistPrefs();
    }
  }
  return state.PREFS.defaultPay;
}

export function renderPayManage() {
  const list = $('payManageList');
  ensureDefaultPay();
  const counts = {};
  state.recs.forEach((r) => {
    const k = r.pay || '';
    if (k) counts[k] = (counts[k] || 0) + 1;
  });
  list.innerHTML =
    state.PAYS.map((p) => {
      const n = counts[p.n] || 0;
      const isDefault = state.PREFS.defaultPay === p.n;
      return `<div class="cat-manage-row${isDefault ? ' is-default' : ''}">
      <div class="cm-ico" style="background:#eef1f6">${p.e || '💰'}</div>
      <div class="cm-main">
        <span class="cm-name">${p.n}</span>
        <span class="cm-count">${n} ${n === 1 ? 'entry' : 'entries'}</span>
      </div>
      <button class="cm-default${isDefault ? ' on' : ''}" data-def="${p.n}">${isDefault ? '★ Default' : 'Set default'}</button>
      <button class="cm-del" data-pay="${p.n}" title="Remove" aria-label="Remove ${p.n}">${TRASH_SVG}</button>
    </div>`;
    }).join('') || '<div style="color:#888;font-size:13px;padding:8px 0">No payment methods yet.</div>';
}

// Set (or keep) the default payment method and persist. Shared by the row pill.
export function setDefaultPay(name) {
  if (state.PREFS.defaultPay === name) return;
  state.PREFS.defaultPay = name;
  persistPrefs();
  renderPayManage();
}

export function openPayModal() {
  $('pName').value = '';
  $('pEmoji').value = '';
  $('payModal').classList.add('open');
  setTimeout(() => $('pName').focus(), 100);
}

export function initPayments() {
  $('payManageList').addEventListener('click', async (e) => {
    const def = e.target.closest('.cm-default');
    if (def) {
      setDefaultPay(def.dataset.def);
      return;
    }
    const btn = e.target.closest('.cm-del');
    if (!btn) return;
    const name = btn.dataset.pay;
    const count = state.recs.filter((r) => r.pay === name).length;
    let msg = `Remove payment method "${name}" from the picker?`;
    if (count) msg += ` ${count} existing ${count === 1 ? 'entry' : 'entries'} tagged "${name}" will be kept — the option just won't appear when adding new expenses.`;
    if (!(await confirmModal(msg, { title: 'Remove payment method', confirmLabel: 'Remove', danger: true }))) return;
    state.PAYS = state.PAYS.filter((p) => p.n !== name);
    persistPays();
    // If we removed the default, renderPayManage()'s ensureDefaultPay() promotes
    // the new top-most method and persists it.
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
    if ($('prefsOverlay').classList.contains('open')) renderPayManage();
  };
}
