// Pure formatting / lookup helpers derived from state + constants.

import { state } from './state.js';
import { MN, DAYS, BUILTIN_PAYS } from './constants.js';

export const fmt = (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const isoDay = (d) => d.toISOString().split('T')[0];

export function friendlyDate(dateStr) {
  const d = new Date(dateStr);
  const today = isoDay(new Date());
  const yesterday = isoDay(new Date(Date.now() - 86400000));
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
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
