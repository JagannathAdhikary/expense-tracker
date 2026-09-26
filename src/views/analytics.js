// Analytics screen: a rich, period-scoped breakdown of spending. A period toggle
// (Month / 3M / 6M / 12M / All) rescopes every chart. Charts: hero total + delta,
// KPI tiles, a spending-over-time chart (monthly trend line for multi-month, or a
// day-of-month strip for a single month), a category donut + ranked bars, a
// payment-method split, and a weekday pattern. All hand-rolled inline SVG/CSS —
// no chart library. Category/donut colors follow the user's category palette
// (categorical, kept legible with legend + labels + surface gaps); the time and
// weekday charts use a single accent hue / emphasis so they read safely for everyone.

import { MN } from '../constants.js';
import { fmt, catByName } from '../format.js';
import { $ } from '../dom.js';
import {
  rangeStats,
  monthsBack,
  monthlySeries,
  categoryTotals,
  paymentTotals,
  weekdayBuckets,
  dayOfMonthBuckets,
  foldToOther,
  WEEKDAYS,
} from '../analytics.js';
import { showCategoryView } from './category.js';
import { navTo, navBack } from '../nav.js';
import { renderForScreen } from './nav-render.js';

// Selected period: 'month' | '3' | '6' | '12' | 'all'. Kept for the session.
let period = 'month';

// Compact rupee for tight spots (tiles, axis, tooltips): ₹1.2k, ₹3.4L, ₹1.2Cr.
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

// The months (day-1 Dates) covered by the current selection, oldest-first.
function resolveMonths() {
  if (period === 'month') return monthsBack(1);
  if (period === 'all') return monthsBack('all');
  return monthsBack(parseInt(period, 10));
}

// A human label for the resolved range, e.g. "Sep 2026" or "Apr – Sep 2026".
function rangeLabel(months) {
  const a = months[0];
  const b = months[months.length - 1];
  const one = (d) => `${MN[d.getMonth()]} ${d.getFullYear()}`;
  if (months.length === 1) return one(a);
  const sameYear = a.getFullYear() === b.getFullYear();
  return sameYear ? `${MN[a.getMonth()]} – ${MN[b.getMonth()]} ${b.getFullYear()}` : `${one(a)} – ${one(b)}`;
}

// ---- Shared floating tooltip -------------------------------------------------
// Tooltips ENHANCE the charts (values are also on axes/labels); they never gate a
// value. Shown on pointer/focus, hidden on leave/blur. Positioned near the pointer,
// clamped to the analytics screen.
function showTip(html, clientX, clientY) {
  const tip = $('anTip');
  tip.innerHTML = html;
  tip.hidden = false;
  const screen = $('analytics');
  const box = screen.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left = clientX - box.left - tw / 2;
  let top = clientY - box.top - th - 12;
  left = Math.max(6, Math.min(left, box.width - tw - 6));
  if (top < 4) top = clientY - box.top + 16; // flip below if no room above
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
function hideTip() {
  $('anTip').hidden = true;
}

// ---- Hero + KPIs -------------------------------------------------------------
function renderHeroAndKpis(months) {
  const s = rangeStats(months);
  $('anTot').textContent = fmt(s.total);
  $('anHeroLbl').textContent = months.length === 1 ? 'Total spent' : `Total spent · ${months.length} months`;

  const delta = $('anDelta');
  if (s.deltaPct == null) {
    delta.className = 'an-delta';
    delta.textContent = 'No earlier period to compare';
  } else {
    const up = s.deltaPct >= 0;
    const pct = Math.abs(s.deltaPct).toFixed(0);
    const vs = months.length === 1 ? `vs ${MN[(months[0].getMonth() + 11) % 12]}` : `vs previous ${months.length}M`;
    delta.className = 'an-delta ' + (up ? 'is-up' : 'is-down');
    delta.innerHTML = `<span class="an-delta-arrow">${up ? '▲' : '▼'}</span> ${pct}% ${vs}`;
  }

  const perMonth = s.total / months.length;
  const tiles = [
    { lbl: months.length === 1 ? 'Avg / day' : 'Avg / month', val: fmtShort(months.length === 1 ? s.avgPerDay : perMonth) },
    { lbl: 'Biggest', val: fmtShort(s.biggest) },
    { lbl: 'Expenses', val: String(s.count) },
    { lbl: 'Top category', val: s.topCat ? `${catByName(s.topCat).e} ${s.topCat}` : '—' },
  ];
  $('anKpis').innerHTML = tiles
    .map((t) => `<div class="an-kpi"><div class="an-kpi-lbl">${t.lbl}</div><div class="an-kpi-val">${t.val}</div></div>`)
    .join('');
}

// ---- Spending over time ------------------------------------------------------
// Multi-month selection -> a monthly trend LINE (single accent hue). Single month
// -> a day-of-month bar strip (emphasis on the peak day). We never show two time
// charts at once (redundancy guard).
function renderTimeChart(months) {
  if (months.length > 1) {
    $('anTimeTitle').textContent = 'Monthly spend';
    renderTrendLine(monthlySeries(months));
  } else {
    $('anTimeTitle').textContent = 'Daily spend';
    renderDayOfMonth(months[0]);
  }
}

// Monthly trend as a single-hue line + area, with a hover crosshair + dot.
function renderTrendLine(series) {
  const host = $('anTimeChart');
  const W = 320;
  const H = 120;
  const padL = 6;
  const padR = 6;
  const padT = 10;
  const padB = 20;
  const mx = Math.max(...series.map((p) => p.total), 1);
  const n = series.length;
  const xAt = (i) => (n === 1 ? W / 2 : padL + (i * (W - padL - padR)) / (n - 1));
  const yAt = (v) => padT + (1 - v / mx) * (H - padT - padB);
  const pts = series.map((p, i) => [xAt(i), yAt(p.total)]);

  const linePath = pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${pts[pts.length - 1][0].toFixed(1)} ${H - padB} L ${pts[0][0].toFixed(1)} ${H - padB} Z`;

  // Sparse x-labels: first, middle, last (dedup for short series).
  const lblIdx = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  const xlabels = lblIdx
    .map((i) => `<text x="${xAt(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="an-axis-lbl">${series[i].label}</text>`)
    .join('');

  // Dots — larger hit target added via an invisible overlay rect per point.
  const dots = pts
    .map(([x, y], i) => (n === 1 ? `<circle cx="${x}" cy="${y}" r="3.5" class="an-line-dot"/>` : (i === n - 1 ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" class="an-line-dot"/>` : '')))
    .join('');

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Monthly spend trend">
      <path d="${areaPath}" class="an-line-area"/>
      <path d="${linePath}" class="an-line-stroke" fill="none"/>
      ${dots}
      <g class="an-cross" style="display:none"><line class="an-cross-line" y1="${padT}" y2="${H - padB}"/><circle r="4" class="an-line-dot"/></g>
      ${xlabels}
    </svg>`;

  // Hover / focus: nearest-point crosshair + tooltip. One overlay listener maps
  // pointer x to the nearest series index (hit target = the whole plot width).
  const svg = host.querySelector('svg');
  const cross = host.querySelector('.an-cross');
  const crossLine = host.querySelector('.an-cross-line');
  const crossDot = host.querySelector('.an-cross circle');
  const toIdx = (clientX) => {
    const r = svg.getBoundingClientRect();
    const svgX = ((clientX - r.left) / r.width) * W;
    let best = 0;
    let bestD = Infinity;
    pts.forEach(([x], i) => {
      const d = Math.abs(x - svgX);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };
  const move = (e) => {
    const i = toIdx(e.clientX);
    const [x, y] = pts[i];
    cross.style.display = '';
    crossLine.setAttribute('x1', x);
    crossLine.setAttribute('x2', x);
    crossDot.setAttribute('cx', x);
    crossDot.setAttribute('cy', y);
    const p = series[i];
    showTip(`<b>${p.label} ${p.year}</b><br>${fmt(p.total)}`, e.clientX, e.clientY);
  };
  const leave = () => { cross.style.display = 'none'; hideTip(); };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', leave);
  svg.addEventListener('pointerdown', move);
}

// Day-of-month strip for a single month: emphasis bar on the peak day, others muted.
function renderDayOfMonth(cur) {
  const host = $('anTimeChart');
  const all = dayOfMonthBuckets([cur]);
  const days = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
  const buckets = all.slice(0, days);
  const mx = Math.max(...buckets, 1);
  const peak = buckets.indexOf(Math.max(...buckets));
  const W = 320;
  const H = 96;
  const gap = 2;
  const bw = (W - gap * (days - 1)) / days;
  const bars = buckets
    .map((v, i) => {
      const h = v > 0 ? Math.max(2, (v / mx) * (H - 6)) : 0;
      const x = i * (bw + gap);
      const y = H - h;
      const cls = v > 0 && i === peak ? 'an-bar-peak' : 'an-bar';
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" class="${cls}" data-i="${i}"/>`;
    })
    .join('');
  const labels = [...new Set([1, Math.round(days / 2), days])]
    .map((d) => {
      const x = (d - 1) * (bw + gap) + bw / 2;
      return `<text x="${x.toFixed(1)}" y="${H + 12}" text-anchor="middle" class="an-axis-lbl">${d}</text>`;
    })
    .join('');
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H + 16}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Daily spend">${bars}${labels}</svg>`;

  attachBarHover(host.querySelector('svg'), (i, e) => {
    if (buckets[i] <= 0) return null;
    return `<b>${i + 1} ${MN[cur.getMonth()]}</b><br>${fmt(buckets[i])}`;
  });
}

// ---- Category donut + bars ---------------------------------------------------
function renderCategory(months) {
  const items0 = categoryTotals(months);
  const total = items0.reduce((s, it) => s + it.amt, 0);

  const empty = !items0.length || total <= 0;
  $('anCatEmpty').style.display = empty ? '' : 'none';
  $('anDonutWrap').style.display = empty ? 'none' : '';
  $('anBars').style.display = empty ? 'none' : '';
  if (empty) {
    $('anDonut').innerHTML = '';
    $('anLegend').innerHTML = '';
    $('anBars').innerHTML = '';
    return;
  }

  // Donut: fold tail beyond 8 into "Other" (never generate a 9th hue).
  const items = foldToOther(items0.slice(), 8);
  const size = 168;
  const cx = size / 2;
  const cy = size / 2;
  const rO = 78;
  const rI = 48;
  let a = 0;
  const segs = items
    .map((it, i) => {
      const frac = it.amt / total;
      const a1 = a + frac * Math.PI * 2;
      const d = donutArc(cx, cy, rO, rI, a, a1);
      a = a1;
      return `<path d="${d}" fill="${it.color}" stroke="var(--surface)" stroke-width="2" data-i="${i}"/>`;
    })
    .join('');
  const sub = months.length === 1 ? 'this month' : `${months.length} months`;
  $('anDonut').innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Category share">
      ${segs}
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="an-donut-total">${fmtShort(total)}</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="an-donut-sub">${sub}</text>
    </svg>`;

  // Donut hover: highlight segment + tooltip with % and amount.
  const donutSvg = $('anDonut').querySelector('svg');
  donutSvg.querySelectorAll('path[data-i]').forEach((path) => {
    const it = items[+path.dataset.i];
    const pct = Math.round((it.amt / total) * 100);
    const tip = (e) => showTip(`<b>${it.name}</b><br>${fmt(it.amt)} · ${pct}%`, e.clientX, e.clientY);
    path.addEventListener('pointerenter', tip);
    path.addEventListener('pointermove', tip);
    path.addEventListener('pointerleave', hideTip);
  });

  // Legend with % (direct labels — color alone isn't enough for identity).
  $('anLegend').innerHTML = items
    .map((it) => {
      const pct = Math.round((it.amt / total) * 100);
      return `<div class="an-leg-row"><span class="an-leg-dot" style="background:${it.color}"></span><span class="an-leg-name">${it.name}</span><span class="an-leg-pct">${pct}%</span></div>`;
    })
    .join('');

  // Ranked bars (tap -> category detail). Real categories only ("Other" not tappable).
  // Bars are normalized to the top category for at-a-glance comparison.
  const mx = items0[0].amt || 1;
  $('anBars').innerHTML = items0
    .map((it) => {
      const c = catByName(it.name);
      const pct = Math.round((it.amt / mx) * 100);
      return `<div class="cat-row" data-cat="${it.name}">
        <div class="cname">${c.e} ${it.name}</div>
        <div class="bar-wrap"><div class="bar-fill" style="width:${pct}%;background:${it.color}"></div></div>
        <div class="camt">${fmt(it.amt)}</div>
      </div>`;
    })
    .join('');
}

// ---- Payment-method split ----------------------------------------------------
// A single horizontal stacked bar (part-to-whole) + a labelled legend. Categorical
// colors, capped/folded so we never exceed the categorical ceiling.
function renderPayments(months) {
  const items0 = paymentTotals(months);
  const total = items0.reduce((s, it) => s + it.amt, 0);
  const host = $('anPay');
  if (!items0.length || total <= 0) {
    host.style.display = 'none';
    $('anPayTitle').style.display = 'none';
    return;
  }
  host.style.display = '';
  $('anPayTitle').style.display = '';
  const items = foldToOther(items0.slice(), 6);

  const segs = items
    .map((it) => {
      const pct = (it.amt / total) * 100;
      return `<span class="an-pay-seg" style="width:${pct}%;background:${it.color}" data-name="${it.name}"><span class="an-pay-tipwrap"></span></span>`;
    })
    .join('');
  const legend = items
    .map((it) => {
      const pct = Math.round((it.amt / total) * 100);
      return `<div class="an-pay-leg"><span class="an-leg-dot" style="background:${it.color}"></span><span class="an-pay-name">${it.name}</span><span class="an-pay-amt">${fmt(it.amt)}</span><span class="an-pay-pct">${pct}%</span></div>`;
    })
    .join('');
  host.innerHTML = `<div class="an-pay-bar" role="img" aria-label="Spending by payment method">${segs}</div><div class="an-pay-legend">${legend}</div>`;

  host.querySelectorAll('.an-pay-seg').forEach((seg, i) => {
    const it = items[i];
    const pct = Math.round((it.amt / total) * 100);
    const tip = (e) => showTip(`<b>${it.name}</b><br>${fmt(it.amt)} · ${pct}%`, e.clientX, e.clientY);
    seg.addEventListener('pointerenter', tip);
    seg.addEventListener('pointermove', tip);
    seg.addEventListener('pointerleave', hideTip);
  });
}

// ---- Weekday pattern ---------------------------------------------------------
// Emphasis bars: the heaviest weekday in accent, the rest muted. Reveals rhythm
// (e.g. weekend-heavy spending) at a glance.
function renderWeekday(months) {
  const host = $('anWeekday');
  const buckets = weekdayBuckets(months); // index 0 = Sunday
  const mx = Math.max(...buckets, 1);
  const total = buckets.reduce((s, v) => s + v, 0);
  if (total <= 0) { host.innerHTML = '<div class="empty"><span>📅</span>No spending in this range.</div>'; return; }
  const peak = buckets.indexOf(Math.max(...buckets));
  host.innerHTML = buckets
    .map((v, i) => {
      const pct = Math.round((v / mx) * 100);
      const cls = i === peak && v > 0 ? 'an-wd-fill is-peak' : 'an-wd-fill';
      return `<div class="an-wd-row" data-i="${i}">
        <div class="an-wd-lbl">${WEEKDAYS[i]}</div>
        <div class="an-wd-track"><div class="${cls}" style="width:${pct}%"></div></div>
        <div class="an-wd-amt">${fmtShort(v)}</div>
      </div>`;
    })
    .join('');
}

// ---- Bar hover helper --------------------------------------------------------
// Attaches a nearest-rect hover/tooltip to an SVG of <rect data-i>. `tipFor(i,e)`
// returns tooltip HTML or null to suppress.
function attachBarHover(svg, tipFor) {
  const rects = [...svg.querySelectorAll('rect[data-i]')];
  const W = 320;
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const svgX = ((e.clientX - r.left) / r.width) * W;
    let best = null;
    let bestD = Infinity;
    rects.forEach((rc) => {
      const cx = +rc.getAttribute('x') + +rc.getAttribute('width') / 2;
      const d = Math.abs(cx - svgX);
      if (d < bestD) { bestD = d; best = rc; }
    });
    if (!best) return;
    const html = tipFor(+best.dataset.i, e);
    if (html) showTip(html, e.clientX, e.clientY); else hideTip();
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', hideTip);
}

// ---- Orchestration -----------------------------------------------------------
export function renderAnalytics() {
  const months = resolveMonths();
  $('anPeriod').textContent = rangeLabel(months);
  // Reflect the active period button.
  document.querySelectorAll('#anPeriodSeg button').forEach((b) => {
    const on = b.dataset.period === period;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  hideTip();
  renderHeroAndKpis(months);
  renderTimeChart(months);
  renderCategory(months);
  renderPayments(months);
  renderWeekday(months);
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
  // Period toggle: rescope every chart.
  $('anPeriodSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-period]');
    if (!b || b.dataset.period === period) return;
    period = b.dataset.period;
    renderAnalytics();
  });
}
