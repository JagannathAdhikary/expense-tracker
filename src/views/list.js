// Shared date-grouped transaction list: the renderer plus the click handler used
// by both the home list (#tlist) and the category-detail list (#cvlist).

import { state, collapsed } from '../state.js';
import { fmt, friendlyDate, payBadge, catByName } from '../format.js';
import { persist } from '../storage.js';
import { pushRecord, syncOn } from '../features/sync.js';

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
        // Shared (group) rows are cloud-managed: no local edit/delete, badge instead.
        if (r.shared) {
          const b = r.badge || { label: r.pending ? 'pending' : 'settled', cls: r.pending ? 'shared-pending' : 'shared-done' };
          const badge = `<span class="pay-badge ${b.cls}">${b.label}</span>`;
          const amtCls = r.amt < 0 ? ' neg' : '';
          return `<div class="txn shared-txn">
        <div class="txn-ico" style="background:${cat.c}20">${cat.e}</div>
        <div class="txn-info">
          <div class="txn-desc">${r.desc || cat.n}</div>
          <div class="txn-meta">${r.meta || cat.n}${badge}</div>
        </div>
        <div class="txn-amt${amtCls}">${fmt(r.amt)}</div>
        <div class="txn-actions">
          ${r.canEdit ? `<button class="icon-btn gedit" data-gid="${r.groupExpId}" title="Edit group expense">✏️</button>` : ''}
          ${r.canEdit ? `<button class="icon-btn gdel" data-gid="${r.groupExpId}" title="Delete group expense">×</button>` : ''}
          ${r.settleId ? `<button class="icon-btn settle" data-settle="${r.settleId}" title="Mark my share done">✓</button>` : ''}
        </div>
      </div>`;
        }
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
// onSettle (optional) handles the "mark my share done" ✓ button on shared rows.
export function attachListHandler(container, { onEdit, rerender, onSettle, onEditGroup, onDeleteGroup }) {
  container.addEventListener('click', (e) => {
    const gdel = e.target.closest('.gdel');
    if (gdel) {
      if (onDeleteGroup) onDeleteGroup(gdel.dataset.gid);
      return;
    }
    const gedit = e.target.closest('.gedit');
    if (gedit) {
      if (onEditGroup) onEditGroup(gedit.dataset.gid);
      return;
    }
    const settle = e.target.closest('.settle');
    if (settle) {
      if (onSettle) onSettle(settle.dataset.settle);
      return;
    }
    const del = e.target.closest('.del');
    if (del) {
      if (!confirm('Delete this entry?')) return;
      const id = del.dataset.id;
      if (syncOn()) {
        // Soft-delete so the removal propagates to other devices via the cloud.
        const rec = state.recs.find((r) => r.id == id);
        if (rec) pushRecord({ ...rec, deleted: true, updated: Date.now() });
      }
      state.recs = state.recs.filter((r) => r.id != id);
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
