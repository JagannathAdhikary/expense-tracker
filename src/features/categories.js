// Manage-categories sheet and the add-category modal.

import { state } from '../state.js';
import { PALETTE } from '../constants.js';
import { persistCats, persistPrefs } from '../storage.js';
import { $ } from '../dom.js';
import { render } from '../views/home.js';
import { renderCatChips } from '../views/addEdit.js';
import { toastError } from '../toast.js';

function renderCatManage() {
  const list = $('catManageList');
  const counts = {};
  state.recs.forEach((r) => {
    counts[r.cat] = (counts[r.cat] || 0) + 1;
  });
  list.innerHTML =
    state.CATS.map((c) => {
      const n = counts[c.n] || 0;
      const isDefault = state.PREFS.defaultCat === c.n;
      return `<div class="cat-manage-row">
      <div class="cm-ico" style="background:${c.c}20">${c.e}</div>
      <div class="cm-name">${c.n}${isDefault ? ' <span class="default-star" title="Default">★</span>' : ''}</div>
      <span class="cm-count">${n} ${n === 1 ? 'entry' : 'entries'}</span>
      <button class="cm-del" data-cat="${c.n}" title="Remove">🗑</button>
    </div>`;
    }).join('') || '<div style="color:#888;font-size:13px;padding:8px 0">No categories yet.</div>';
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
  $('manageCatsBtn').onclick = () => {
    $('overlay').classList.remove('open');
    renderCatManage();
    $('catOverlay').classList.add('open');
  };
  $('closeCatSheet').onclick = () => $('catOverlay').classList.remove('open');
  $('catOverlay').onclick = (e) => {
    if (e.target === $('catOverlay')) $('catOverlay').classList.remove('open');
  };

  $('catManageList').addEventListener('click', (e) => {
    const btn = e.target.closest('.cm-del');
    if (!btn) return;
    const name = btn.dataset.cat;
    const count = state.recs.filter((r) => r.cat === name).length;
    let msg = `Remove category "${name}" from the picker?`;
    if (count) msg += `\n\n${count} existing ${count === 1 ? 'entry' : 'entries'} still labelled "${name}" will be kept — they'll show as "${name}" but the option won't appear when adding new expenses.`;
    if (!confirm(msg)) return;
    state.CATS = state.CATS.filter((c) => c.n !== name);
    if (state.PREFS.defaultCat === name) {
      state.PREFS.defaultCat = null;
      persistPrefs();
    }
    persistCats();
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
    // If manage sheet is open, refresh it.
    if ($('catOverlay').classList.contains('open')) renderCatManage();
    render();
  };
}
