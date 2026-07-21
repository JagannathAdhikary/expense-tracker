// Shared date-grouped transaction list: the renderer plus the click handler used
// by both the home list (#tlist) and the category-detail list (#cvlist).

import { state, collapsed } from '../state.js';
import { fmt, friendlyDate, payBadge, catByName } from '../format.js';
import { persist } from '../storage.js';

// Render a list of rows grouped by date into a container element.
export function renderDateGroups(rows, container) {
  const groups = [];
  const seen = {};
  rows.forEach((r) => {
    if (!seen[r.date]) {
      seen[r.date] = [];
      groups.push({ date: r.date, items: seen[r.date] });
    }
    seen[r.date].push(r);
  });
  container.innerHTML = '';
  groups.forEach((g) => {
    const isCollapsed = collapsed.has(g.date);
    const groupTotal = g.items.reduce((s, r) => s + r.amt, 0);
    const grp = document.createElement('div');
    grp.className = 'date-group';
    grp.dataset.date = g.date;

    const entriesHtml = g.items
      .map((r) => {
        const cat = catByName(r.cat);
        return `<div class="txn">
        <div class="txn-ico" style="background:${cat.c}20">${cat.e}</div>
        <div class="txn-info">
          <div class="txn-desc">${r.desc || cat.n}</div>
          <div class="txn-meta">${cat.n}${payBadge(r.pay || 'UPI')}</div>
        </div>
        <div class="txn-amt">${fmt(r.amt)}</div>
        <div class="txn-actions">
          <button class="icon-btn edit" data-id="${r.id}">✏️</button>
          <button class="icon-btn del" data-id="${r.id}">×</button>
        </div>
      </div>`;
      })
      .join('');

    grp.innerHTML = `
      <div class="date-header">
        <div class="date-header-left">
          <span class="chevron${isCollapsed ? '' : ' open'}">▼</span>
          <span class="date-label">${friendlyDate(g.date)}</span>
          <span class="date-count">${g.items.length}</span>
        </div>
        <span class="date-total">${fmt(groupTotal)}</span>
      </div>
      <div class="date-entries${isCollapsed ? ' collapsed' : ''}">${entriesHtml}</div>`;
    container.appendChild(grp);
  });
}

// Attach the shared delete / edit / collapse click handling to a list container.
// The render callbacks are passed in to avoid circular imports between views.
export function attachListHandler(container, { onEdit, rerender }) {
  container.addEventListener('click', (e) => {
    const del = e.target.closest('.del');
    if (del) {
      if (!confirm('Delete this entry?')) return;
      state.recs = state.recs.filter((r) => r.id != del.dataset.id);
      persist();
      rerender();
      return;
    }
    const edit = e.target.closest('.edit');
    if (edit) {
      onEdit(Number(edit.dataset.id));
      return;
    }
    const hdr = e.target.closest('.date-header');
    if (hdr) {
      const grp = hdr.closest('.date-group');
      const date = grp.dataset.date;
      const entries = grp.querySelector('.date-entries');
      const chevron = grp.querySelector('.chevron');
      if (collapsed.has(date)) {
        collapsed.delete(date);
        entries.classList.remove('collapsed');
        chevron.classList.add('open');
      } else {
        collapsed.add(date);
        entries.classList.add('collapsed');
        chevron.classList.remove('open');
      }
    }
  });
}
