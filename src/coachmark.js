// One-time coach-mark: a small popover that points at a target element to
// introduce a feature. Auto-positions below the target with an arrow, dismisses
// on button click, tap-away, scroll, or resize.

import { $ } from './dom.js';

let active = null;

function teardown() {
  if (!active) return;
  window.removeEventListener('scroll', teardown, true);
  window.removeEventListener('resize', teardown);
  active.remove();
  active = null;
}

/**
 * Show a coach-mark anchored to a target element.
 * @param {string} targetId  element to point at
 * @param {object} opts       { title, body, cta }
 */
export function showCoachmark(targetId, { title = '', body = '', cta = 'Got it' } = {}) {
  const target = $(targetId);
  if (!target) return;
  teardown();

  const overlay = document.createElement('div');
  overlay.className = 'coach-overlay';
  overlay.innerHTML = `
    <div class="coach-pop" role="dialog">
      <div class="coach-arrow"></div>
      ${title ? `<div class="coach-title">${title}</div>` : ''}
      <div class="coach-body">${body}</div>
      <button class="coach-cta">${cta}</button>
    </div>`;
  document.body.appendChild(overlay);
  active = overlay;

  const pop = overlay.querySelector('.coach-pop');
  const arrow = overlay.querySelector('.coach-arrow');

  // Position under the target, right-aligned to it, clamped to the viewport.
  const r = target.getBoundingClientRect();
  const margin = 10;
  const popWidth = Math.min(280, window.innerWidth - margin * 2);
  pop.style.width = popWidth + 'px';
  let left = r.right - popWidth;
  left = Math.max(margin, Math.min(left, window.innerWidth - popWidth - margin));
  pop.style.top = r.bottom + 12 + 'px';
  pop.style.left = left + 'px';
  // Arrow points up at the target's horizontal center.
  const arrowX = Math.max(14, Math.min(r.left + r.width / 2 - left, popWidth - 14));
  arrow.style.left = arrowX + 'px';

  requestAnimationFrame(() => pop.classList.add('show'));

  overlay.querySelector('.coach-cta').onclick = teardown;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) teardown();
  });
  window.addEventListener('scroll', teardown, true);
  window.addEventListener('resize', teardown);
}
