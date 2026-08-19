// Pure formatting / lookup helpers derived from state + constants.

import { state } from './state.js';
import { MN, DAYS, BUILTIN_PAYS } from './constants.js';

export const fmt = (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Local-timezone YYYY-MM-DD. Using toISOString() here would convert to UTC, so
// just after local midnight (in zones ahead of UTC, e.g. IST) it would still
// report yesterday — stamping new expenses on the wrong day. Build from local parts.
export const isoDay = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export function friendlyDate(dateStr) {
  const d = new Date(dateStr);
  const today = isoDay(new Date());
  const yesterday = isoDay(new Date(Date.now() - 86400000));
  const tomorrow = isoDay(new Date(Date.now() + 86400000));
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  if (dateStr === tomorrow) return 'Tomorrow';
  return DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MN[d.getMonth()];
}

export function payBadge(pay) {
  if (!pay) return '';
  // Built-in payment names use their dedicated color class; custom ones get a neutral badge.
  const cls = BUILTIN_PAYS.includes(pay) ? `pay-${pay}` : 'pay-custom';
  return `<span class="pay-badge ${cls}">${pay}</span>`;
}

export const catByName = (name) => state.CATS.find((c) => c.n === name) || { n: name || 'Other', e: '📦', c: '#808B96' };

export const payByName = (name) => state.PAYS.find((p) => p.n === name) || (name ? { n: name, e: '💰' } : null);

export const initialCat = () =>
  state.PREFS.defaultCat && state.CATS.find((c) => c.n === state.PREFS.defaultCat)
    ? state.PREFS.defaultCat
    : state.CATS[0]
      ? state.CATS[0].n
      : 'Other';

export const initialPay = () =>
  state.PREFS.defaultPay && state.PAYS.find((p) => p.n === state.PREFS.defaultPay)
    ? state.PREFS.defaultPay
    : state.PAYS[0]
      ? state.PAYS[0].n
      : 'UPI';

// filtered() returns records for the currently-viewed month.
export function filtered() {
  return state.recs.filter((r) => {
    const d = new Date(r.date);
    return d.getMonth() === state.cur.getMonth() && d.getFullYear() === state.cur.getFullYear();
  });
}

// True when any home filter is active (drives the header button's active dot + the
// "clear filter" affordance). scope 'all' + empty selections = no filter.
export function filterActive() {
  const f = state.filter;
  return f.scope !== 'all' || f.cats.length > 0 || !!f.groupId || f.pays.length > 0;
}

// True when a row matches a free-text query. Case-insensitive substring over the
// visible text: description/note, category, payment, and (for shared rows) the
// group name in `meta`. Empty/blank query matches everything. Pure — unit-tested.
export function matchesQuery(r, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return true;
  const hay = [r.desc, r.cat, r.pay, r.meta].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(needle);
}

// Apply the home filter to a merged rows array (personal + shared). A personal row
// has no `shared` flag; a group row has `shared:true` and a `groupId`.
export function applyFilter(rows) {
  const f = state.filter;
  return rows.filter((r) => {
    if (f.scope === 'group' && !r.shared) return false;
    if (f.scope === 'personal' && r.shared) return false;
    if (f.groupId && r.groupId !== f.groupId) return false;
    if (f.cats.length && !f.cats.includes(r.cat)) return false;
    if (f.pays.length && !f.pays.includes(r.pay)) return false;
    if (!matchesQuery(r, f.q)) return false;
    return true;
  });
}

// Category spend breakdown for a month's rows. Sums personal + non-pending shared
// amounts per category (pending "you owe" rows don't count until settled), ordered
// by the configured CATS list first, then any leftover names. Used by Analytics.
export function categoryBreakdown(personal, shared) {
  const byc = {};
  personal.forEach((r) => {
    byc[r.cat] = (byc[r.cat] || 0) + r.amt;
  });
  shared.forEach((r) => {
    if (!r.pending) byc[r.cat] = (byc[r.cat] || 0) + r.amt;
  });
  const names = Object.keys(byc);
  const ordered = state.CATS.map((c) => c.n).filter((n) => byc[n] != null);
  names.forEach((n) => {
    if (!ordered.includes(n)) ordered.push(n);
  });
  const mx = Math.max(...Object.values(byc), 1);
  const total = Object.values(byc).reduce((s, v) => s + v, 0);
  return { byc, ordered, mx, total };
}
