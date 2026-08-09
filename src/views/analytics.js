// Analytics screen: rich monthly breakdown — hero total + month-over-month delta,
// KPI stat tiles, a category donut + bars, and a daily-spend trend. All charts are
// hand-rolled inline SVG/CSS (no chart library). Scoped to the viewed month
// (state.cur); re-renders on month-change from main.js.

import { state } from '../state.js';
import { MN } from '../constants.js';
import { fmt, filtered, catByName, categoryBreakdown } from '../format.js';
import { $ } from '../dom.js';
import { sharedRowsForMonth } from '../cloudrows.js';
import { monthStats, dailyBuckets, foldToOther } from '../analytics.js';
import { showCategoryView } from './category.js';
import { navTo, navBack } from '../nav.js';
import { renderForScreen } from './nav-render.js';

// Compact rupee for tight spots (tiles, axis): ₹1.2k, ₹3.4L.
function fmtShort(n) {
  const v = Math.round(n);
  if (v >= 10000000) return '₹' + (v / 10000000).toFixed(1).replace(/\.0$/, '') + 'Cr';
  if (v >= 100000) return '₹' + (v / 100000).toFixed(1).replace(/\.0$/, '') + 'L';
  if (v >= 1000) return '₹' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return '₹' + v;
}

// SVG arc path for a donut segment from angle a0 to a1 (radians, 0 = top, clockwise).
function donutArc(cx, cy, rOuter, rInner, a0, a1) {
  const p = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [x0o, y0o] = p(rOuter, a0);
  const [x1o, y1o] = p(rOuter, a1);
  const [x1i, y1i] = p(rInner, a1);
  const [x0i, y0i] = p(rInner, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0o} ${y0o} A ${rOuter} ${rOuter} 0 ${large} 1 ${x1o} ${y1o} L ${x1i} ${y1i} A ${rInner} ${rInner} 0 ${large} 0 ${x0i} ${y0i} Z`;
}

function renderHeroAndKpis(cur) {
  const s = monthStats(cur);
  $('anTot').textContent = fmt(s.total);

  // Month-over-month delta: more spend is "bad" (serious/red), less is "good" (green).
  const delta = $('anDelta');
  if (s.deltaPct == null) {
    delta.className = 'an-delta';
    delta.textContent = 'No previous month to compare';
  } else {
    const up = s.deltaPct >= 0;
    const pct = Math.abs(s.deltaPct).toFixed(0);
    delta.className = 'an-delta ' + (up ? 'is-up' : 'is-down');
    delta.innerHTML = `<span class="an-delta-arrow">${up ? '▲' : '▼'}</span> ${pct}% vs ${MN[(cur.getMonth() + 11) % 12]}`;
  }

  const tiles = [
    { lbl: 'Avg / day', val: fmtShort(s.avgPerDay) },
    { lbl: 'Biggest', val: fmtShort(s.biggest) },
    { lbl: 'Expenses', val: String(s.count) },
    { lbl: 'Top category', val: s.topCat ? `${catByName(s.topCat).e} ${s.topCat}` : '—' },
  ];
  $('anKpis').innerHTML = tiles.map((t) => `<div class="an-kpi"><div class="an-kpi-lbl">${t.lbl}</div><div class="an-kpi-val">${t.val}</div></div>`).join('');
}

function renderCategory(cur) {
  const personal = filtered();
  const shared = sharedRowsForMonth(cur);
  const { byc, ordered, mx, total } = categoryBreakdown(personal, shared);

  const empty = !ordered.length || total <= 0;
  $('anCatEmpty').style.display = empty ? '' : 'none';
  $('anDonutWrap').style.display = empty ? 'none' : '';
  $('anBars').style.display = empty ? 'none' : '';
  if (empty) {
    $('anDonut').innerHTML = '';
    $('anLegend').innerHTML = '';
    $('anBars').innerHTML = '';
    return;
  }

  // Build share list sorted desc, fold tail beyond 8 into "Other".
  let items = ordered.map((name) => ({ name, amt: byc[name], color: catByName(name).c }));
  items.sort((a, b) => b.amt - a.amt);
  items = foldToOther(items, 8);

  // Donut.
  const size = 168;
  const cx = size / 2;
  const cy = size / 2;
  const rO = 78;
  const rI = 48;
  let a = 0;
  const segs = items
    .map((it) => {
      const frac = it.amt / total;
      const a1 = a + frac * Math.PI * 2;
      const d = donutArc(cx, cy, rO, rI, a, a1);
      a = a1;
      return `<path d="${d}" fill="${it.color}" stroke="var(--surface)" stroke-width="2"/>`;
    })
    .join('');
  $('anDonut').innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Category share">
      ${segs}
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="an-donut-total">${fmtShort(total)}</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="an-donut-sub">this month</text>
    </svg>`;

  // Legend with % (direct labels, since color alone isn't enough).
  $('anLegend').innerHTML = items
    .map((it) => {
      const pct = Math.round((it.amt / total) * 100);
      return `<div class="an-leg-row"><span class="an-leg-dot" style="background:${it.color}"></span><span class="an-leg-name">${it.name}</span><span class="an-leg-pct">${pct}%</span></div>`;
    })
    .join('');

  // Bars (tap -> category detail). Only real categories are tappable (not "Other").
  $('anBars').innerHTML = ordered
    .map((name) => {
      const c = catByName(name);
      const pct = Math.round((byc[name] / mx) * 100);
      return `<div class="cat-row" data-cat="${name}">
        <div class="cname">${c.e} ${c.n}</div>
        <div class="bar-wrap"><div class="bar-fill" style="width:${pct}%;background:${c.c}"></div></div>
        <div class="camt">${fmt(byc[name])}</div>
      </div>`;
    })
    .join('');
}

function renderTrend(cur) {
  const buckets = dailyBuckets(cur);
  const mx = Math.max(...buckets, 1);
  const days = buckets.length;
  const W = 320;
  const H = 96;
  const gap = 2;
  const bw = (W - gap * (days - 1)) / days;
  const today = new Date();
  const isThisMonth = today.getMonth() === cur.getMonth() && today.getFullYear() === cur.getFullYear();
  const bars = buckets
    .map((v, i) => {
      const h = v > 0 ? Math.max(2, (v / mx) * (H - 16)) : 0;
      const x = i * (bw + gap);
      const y = H - h;
      const isToday = isThisMonth && i + 1 === today.getDate();
      const fill = isToday ? 'var(--accent)' : 'var(--an-trend-bar)';
      return `<g><rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="1.5" fill="${fill}"><title>${i + 1} ${MN[cur.getMonth()]}: ${fmt(v)}</title></rect></g>`;
    })
    .join('');
  // Sparse day labels: 1, ~mid, last.
  const labels = [1, Math.round(days / 2), days]
    .filter((d, idx, arr) => arr.indexOf(d) === idx)
    .map((d) => {
      const x = (d - 1) * (bw + gap) + bw / 2;
      return `<text x="${x}" y="${H + 12}" text-anchor="middle" class="an-trend-lbl">${d}</text>`;
    })
    .join('');
  $('anTrend').innerHTML = `<svg viewBox="0 0 ${W} ${H + 16}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Daily spend">${bars}${labels}</svg>`;
}

export function renderAnalytics() {
  const cur = state.cur;
  $('anPeriod').textContent = MN[cur.getMonth()] + ' ' + cur.getFullYear();
  renderHeroAndKpis(cur);
  renderCategory(cur);
  renderTrend(cur);
}

export function showAnalytics() {
  navTo('analytics');
  renderAnalytics();
}

export function initAnalytics() {
  $('anBackBtn').onclick = () => renderForScreen(navBack());
  // Tap a category bar -> the month+category detail view.
  $('anBars').addEventListener('click', (e) => {
    const row = e.target.closest('.cat-row');
    if (row) showCategoryView(row.dataset.cat);
  });
}
