// Category management inside the Preferences sheet: list rows with a set-default
// pill + remove, and the add-category modal.

import { state } from '../state.js';
import { PALETTE } from '../constants.js';
import { persistCats, persistPrefs } from '../storage.js';
import { $ } from '../dom.js';
import { render } from '../views/home.js';
import { renderCatChips } from '../views/addEdit.js';
import { toastError } from '../toast.js';
import { confirmModal } from '../confirm.js';

// Modern outline trash icon (shared by category & payment rows via a matching const there).
const TRASH_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

// Guarantee a valid default category: if none is set (new user) or the saved one
// no longer exists (was deleted), fall back to the top-most category. Persists
// only when it actually changes. Returns the resolved default name (or null if
// there are no categories at all).
export function ensureDefaultCat() {
  const has = state.PREFS.defaultCat && state.CATS.some((c) => c.n === state.PREFS.defaultCat);
  if (!has) {
    const top = state.CATS[0] ? state.CATS[0].n : null;
    if (state.PREFS.defaultCat !== top) {
      state.PREFS.defaultCat = top;
      persistPrefs();
    }
  }
  return state.PREFS.defaultCat;
}

export function renderCatManage() {
  const list = $('catManageList');
  ensureDefaultCat();
  const counts = {};
  state.recs.forEach((r) => {
    counts[r.cat] = (counts[r.cat] || 0) + 1;
  });
  list.innerHTML =
    state.CATS.map((c) => {
      const n = counts[c.n] || 0;
      const isDefault = state.PREFS.defaultCat === c.n;
      return `<div class="cat-manage-row${isDefault ? ' is-default' : ''}">
      <div class="cm-ico" style="background:${c.c}20">${c.e}</div>
      <div class="cm-main">
        <span class="cm-name">${c.n}</span>
        <span class="cm-count">${n} ${n === 1 ? 'entry' : 'entries'}</span>
      </div>
      <button class="cm-default${isDefault ? ' on' : ''}" data-def="${c.n}">${isDefault ? '★ Default' : 'Set default'}</button>
      <button class="cm-del" data-cat="${c.n}" title="Remove" aria-label="Remove ${c.n}">${TRASH_SVG}</button>
    </div>`;
    }).join('') || '<div style="color:#888;font-size:13px;padding:8px 0">No categories yet.</div>';
}

// Set (or keep) the default category and persist. Shared by the row pill.
export function setDefaultCat(name) {
  if (state.PREFS.defaultCat === name) return;
  state.PREFS.defaultCat = name;
  persistPrefs();
  renderCatManage();
}

function openCatModalSwatches() {
  const wrap = $('cSwatches');
  wrap.innerHTML = PALETTE.map((c) => `<div class="swatch${c === state.newCatColor ? ' on' : ''}" data-c="${c}" style="background:${c}"></div>`).join('');
}

export function openCatModal() {
  state.newCatColor = PALETTE[Math.floor(Math.random() * PALETTE.length)] || PALETTE[0];
  $('cName').value = '';
  $('cEmoji').value = '';
  openCatModalSwatches();
  $('catModal').classList.add('open');
  setTimeout(() => $('cName').focus(), 100);
}

export function initCategories() {
  $('catManageList').addEventListener('click', async (e) => {
    const def = e.target.closest('.cm-default');
    if (def) {
      setDefaultCat(def.dataset.def);
      return;
    }
    const btn = e.target.closest('.cm-del');
    if (!btn) return;
    const name = btn.dataset.cat;
    const count = state.recs.filter((r) => r.cat === name).length;
    let msg = `Remove category "${name}" from the picker?`;
    if (count) msg += ` ${count} existing ${count === 1 ? 'entry' : 'entries'} labelled "${name}" will be kept — the option just won't appear when adding new expenses.`;
    if (!(await confirmModal(msg, { title: 'Remove category', confirmLabel: 'Remove', danger: true }))) return;
    state.CATS = state.CATS.filter((c) => c.n !== name);
    persistCats();
    // If we removed the default, renderCatManage()'s ensureDefaultCat() promotes
    // the new top-most category and persists it.
    renderCatManage();
    render();
    if (state.filterCat === name) state.filterCat = null;
  });

  $('addCatBtn').onclick = openCatModal;
  $('cCancel').onclick = () => $('catModal').classList.remove('open');
  $('catModal').onclick = (e) => {
    if (e.target === $('catModal')) $('catModal').classList.remove('open');
  };

  $('cSwatches').addEventListener('click', (e) => {
    const s = e.target.closest('.swatch');
    if (!s) return;
    state.newCatColor = s.dataset.c;
    document.querySelectorAll('#cSwatches .swatch').forEach((x) => x.classList.toggle('on', x === s));
  });

  $('cSave').onclick = function () {
    const name = $('cName').value.trim();
    const emoji = $('cEmoji').value.trim() || '📦';
    if (!name) {
      $('cName').focus();
      return;
    }
    if (state.CATS.find((c) => c.n.toLowerCase() === name.toLowerCase())) {
      toastError('A category with that name already exists.');
      return;
    }
    state.CATS.push({ n: name, e: emoji, c: state.newCatColor });
    persistCats();
    $('catModal').classList.remove('open');
    // If the add-expense form is open, refresh chips and select the new one.
    if ($('add').classList.contains('active')) {
      state.selCat = name;
      renderCatChips();
    }
    // If Preferences sheet is open, refresh the list.
    if ($('prefsOverlay').classList.contains('open')) renderCatManage();
    render();
  };
}
