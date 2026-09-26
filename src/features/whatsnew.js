// "What's new" tutorial: a one-time, version-gated carousel shown the first time a
// user opens the app after it updates. Modeled on the onboarding wizard
// (src/features/onboarding.js) — same step/progress/Back-Next mechanics — but hosted
// in a centered .modal (index.html #whatsNewModal) instead of a full screen.
//
// Gating: PREFS.lastSeenVersion is compared to APP_VERSION. It shows once per version,
// skips brand-new installs (they get profile onboarding, not a changelog), and records
// the version BEFORE showing so a backdrop-dismiss still counts as seen.
//
// Content lives in WHATS_NEW below — bump it alongside package.json's version when
// features ship.

import { state } from '../state.js';
import { $ } from '../dom.js';
import { icon } from '../icons.js';
import { persistPrefs } from '../storage.js';
import { APP_VERSION } from '../version.js';

// One entry per feature to highlight in the current release. `icon` is a key from
// src/icons.js; `hue` tints the icon badge + glow for that step. Update this list
// (and package.json's version) when new features ship.
const WHATS_NEW = [
  {
    icon: 'send',
    hue: '#2E5A8F',
    title: 'Group chat',
    note: 'Nudge your friends to add that expense, argue over who pays for pizza, or just say hi — all right here, no jumping to another app.',
    cta: 'Open a group → Chat tab',
  },
  {
    icon: 'share',
    hue: '#1a6b3a',
    title: 'Import & export CSV',
    note: 'Got months of expenses in a spreadsheet? Pull them in with one file. Need your data elsewhere? Take it all with you as a CSV.',
    cta: 'Menu → Import & export expenses (CSV)',
  },
  {
    icon: 'bell',
    hue: '#a04000',
    title: 'Turn on notifications',
    note: 'Never miss a new message or a split heading your way — we’ll tap you on the shoulder even when the app is closed.',
    cta: 'Menu → Notifications → Group notifications',
  },
];

let step = 0;

const stepEl = (n) => document.querySelector(`#whatsNewModal .wn-step[data-step="${n}"]`);

// Show step `n`; `dir` (+1/-1) picks the slide-in direction for the transition.
function goTo(n, dir) {
  const total = WHATS_NEW.length;
  n = Math.max(0, Math.min(total - 1, n));
  step = n;
  for (let i = 0; i < total; i++) {
    const el = stepEl(i);
    el.hidden = i !== n;
    if (i === n) {
      el.classList.remove('wn-in-left', 'wn-in-right');
      // Force reflow so the animation restarts even on repeat visits to a step.
      void el.offsetWidth;
      el.classList.add(dir < 0 ? 'wn-in-left' : 'wn-in-right');
    }
  }
  // Tint the badge glow + accent for this step.
  const hue = WHATS_NEW[n].hue || 'var(--accent)';
  $('whatsNewModal').style.setProperty('--wn-hue', hue);
  // Dots reflect the current step (and are individually tappable).
  document.querySelectorAll('#wnDots .wn-dot').forEach((d, i) => d.classList.toggle('on', i === n));
  // Footer: hide Skip on the last step; Next becomes a finishing label.
  const last = n === total - 1;
  $('wnSkip').style.visibility = last ? 'hidden' : '';
  $('wnNextLabel').textContent = last ? 'Got it' : 'Next';
}

function render() {
  goTo(step, 1);
}

function close() {
  $('whatsNewModal').classList.remove('open');
}

function next() {
  if (step >= WHATS_NEW.length - 1) {
    close();
    return;
  }
  goTo(step + 1, 1);
}

// Build the step DOM once from WHATS_NEW (text via textContent — safe, though this is
// static in-code copy). Icons injected as inline SVG. Also builds the dot pager.
function buildSteps() {
  const wrap = $('wnSteps');
  wrap.textContent = '';
  WHATS_NEW.forEach((s, n) => {
    const stepDiv = document.createElement('div');
    stepDiv.className = 'wn-step';
    stepDiv.dataset.step = String(n);
    stepDiv.hidden = n !== 0;

    const ico = document.createElement('div');
    ico.className = 'wn-ico';
    const fn = icon[s.icon] || icon.sparkle;
    ico.innerHTML = fn({ size: 30 });

    const title = document.createElement('h3');
    title.className = 'wn-title';
    title.textContent = s.title;

    const note = document.createElement('p');
    note.className = 'wn-note';
    note.textContent = s.note;

    stepDiv.append(ico, title, note);

    // Optional direction line — a distinct, highlighted CTA telling the user where to go.
    if (s.cta) {
      const cta = document.createElement('p');
      cta.className = 'wn-cta';
      cta.textContent = s.cta;
      stepDiv.appendChild(cta);
    }

    wrap.appendChild(stepDiv);
  });

  // Dot pager — one tappable pip per step.
  const dots = $('wnDots');
  dots.textContent = '';
  WHATS_NEW.forEach((_, n) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'wn-dot' + (n === 0 ? ' on' : '');
    dot.setAttribute('aria-label', `Step ${n + 1}`);
    dot.onclick = () => goTo(n, n < step ? -1 : 1);
    dots.appendChild(dot);
  });
}

// Open the carousel from step 0 (used by the version gate and the ?whatsnew=1 deep link).
export function openWhatsNew() {
  if (!WHATS_NEW.length) return;
  step = 0;
  render();
  $('whatsNewModal').classList.add('open');
}

// Show the carousel once, only if the app version changed since the user last saw it.
// Brand-new installs are skipped (they see profile onboarding instead). Records the
// current version immediately so it never re-shows for this version.
export function maybeShowWhatsNew() {
  if (state.PREFS.lastSeenVersion === APP_VERSION) return;
  const firstRun = !state.PREFS.lastSeenVersion;
  state.PREFS.lastSeenVersion = APP_VERSION;
  persistPrefs();
  if (firstRun) return; // don't greet fresh installs with a changelog
  // Small delay so it appears after the first render settles.
  setTimeout(openWhatsNew, 400);
}

export function initWhatsNew() {
  buildSteps();
  // Eyebrow sparkle icon in the header.
  document.querySelectorAll('#whatsNewModal .wn-eyebrow-ico[data-icon]').forEach((el) => {
    const fn = icon[el.dataset.icon];
    if (fn) el.innerHTML = fn({ size: 14 });
  });
  $('wnNext').onclick = next;
  $('wnSkip').onclick = close;
  // Backdrop click closes (mirrors the CSV/confirm modals).
  $('whatsNewModal').onclick = (e) => {
    if (e.target === $('whatsNewModal')) close();
  };
}
