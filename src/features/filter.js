// Home transaction-list filter: a bottom sheet to filter by scope (all / group /
// personal), specific group, categories, and payment methods. Edits a draft while
// the sheet is open, commits to state.filter on Apply, then calls the onApply cb.

import { state } from '../state.js';
import { cloudEnabled } from '../supabase.js';
import { catByName } from '../format.js';
import { $ } from '../dom.js';
import { icon } from '../icons.js';
import { thumbMarkup } from '../views/groups.js';

let draft = null; // working copy while the sheet is open
let applyCb = null; // re-render callback supplied by the opener

// A concise human summary of the active filter, for the filter bar on home.
export function filterSummary() {
  const f = state.filter;
  const parts = [];
  if (f.scope === 'group') parts.push('Group');
  else if (f.scope === 'personal') parts.push('Personal');
  if (f.groupId) {
    const g = state.groups.find((x) => x.id === f.groupId);
    if (g) parts.push(g.name);
  }
  if (f.cats.length) parts.push(f.cats.length === 1 ? f.cats[0] : `${f.cats.length} categories`);
  if (f.pays.length) parts.push(f.pays.length === 1 ? f.pays[0] : `${f.pays.length} payments`);
  return parts.length ? 'Filter: ' + parts.join(' · ') : 'Filter active';
}

// Reset the filter to "show everything". Preserves the free-text search `q`, which
// is a separate always-visible affordance (the search box), not part of the sheet.
export function clearFilter() {
  state.filter = { scope: 'all', cats: [], groupId: null, pays: [], q: state.filter.q || '' };
}

function renderSheet() {
  // Scope chips.
  $('fltScope').querySelectorAll('.pay-chip').forEach((c) => c.classList.toggle('on', c.dataset.scope === draft.scope));

  // Group picker: only when scope is "group" (choosing a specific group makes no
  // sense for All/Personal). Include retired groups so their history is filterable.
  const groups = cloudEnabled() && state.user ? state.groups : [];
  const groupField = $('fltGroupField');
  if (groups.length && draft.scope === 'group') {
    groupField.style.display = '';
    $('fltGroups').innerHTML =
      `<div class="chip${!draft.groupId ? ' on' : ''}" data-group="">Any group</div>` +
      groups.map((g) => `<div class="chip${g.id === draft.groupId ? ' on' : ''}" data-group="${g.id}">${thumbMarkup(g)} ${g.name}${g.retired ? ' (retired)' : ''}</div>`).join('');
  } else {
    groupField.style.display = 'none';
  }

  // Category chips (multi-select).
  $('fltCats').innerHTML = state.CATS.map((c) => `<div class="chip${draft.cats.includes(c.n) ? ' on' : ''}" data-cat="${c.n}">${c.e} ${c.n}</div>`).join('');

  // Payment chips (multi-select).
  $('fltPays').innerHTML = state.PAYS.map((p) => `<div class="pay-chip${draft.pays.includes(p.n) ? ' on' : ''}" data-pay="${p.n}">${p.e || '💰'} ${p.n}</div>`).join('');
}

export function openFilterSheet(onApply) {
  applyCb = onApply;
  // Clone current filter into the draft so Cancel/close discards edits.
  draft = { scope: state.filter.scope, cats: [...state.filter.cats], groupId: state.filter.groupId, pays: [...state.filter.pays] };
  renderSheet();
  $('filterOverlay').classList.add('open');
}

export function initFilter() {
  $('closeFilterSheet').innerHTML = icon.close({ size: 20 });
  const close = () => $('filterOverlay').classList.remove('open');
  $('closeFilterSheet').onclick = close;
  $('filterOverlay').onclick = (e) => {
    if (e.target === $('filterOverlay')) close();
  };

  $('fltScope').addEventListener('click', (e) => {
    const chip = e.target.closest('.pay-chip');
    if (!chip || !draft) return;
    draft.scope = chip.dataset.scope;
    if (draft.scope !== 'group') draft.groupId = null; // a specific group only applies to "group" scope
    renderSheet();
  });

  $('fltGroups').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip || !draft) return;
    draft.groupId = chip.dataset.group || null;
    renderSheet();
  });

  $('fltCats').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip || !draft) return;
    const cat = chip.dataset.cat;
    draft.cats = draft.cats.includes(cat) ? draft.cats.filter((c) => c !== cat) : [...draft.cats, cat];
    renderSheet();
  });

  $('fltPays').addEventListener('click', (e) => {
    const chip = e.target.closest('.pay-chip');
    if (!chip || !draft) return;
    const pay = chip.dataset.pay;
    draft.pays = draft.pays.includes(pay) ? draft.pays.filter((p) => p !== pay) : [...draft.pays, pay];
    renderSheet();
  });

  $('fltClear').onclick = () => {
    draft = { scope: 'all', cats: [], groupId: null, pays: [] };
    renderSheet();
  };

  $('fltApply').onclick = () => {
    if (draft) state.filter = { scope: draft.scope, cats: [...draft.cats], groupId: draft.groupId, pays: [...draft.pays], q: state.filter.q || '' };
    close();
    if (applyCb) applyCb();
  };
}
