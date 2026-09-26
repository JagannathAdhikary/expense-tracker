// Preferences hub: one bottom sheet with a Categories | Payment methods segment.
// Opening it wires straight into the existing category/payment managers, which
// render into #catManageList / #payManageList (both live inside this sheet) and
// own their own add-modal + set-default + remove logic.

import { $ } from '../dom.js';
import { icon } from '../icons.js';
import { renderCatManage, ensureDefaultCat } from './categories.js';
import { renderPayManage, ensureDefaultPay } from './payments.js';

function showSeg(seg) {
  const isCat = seg === 'cat';
  $('prefCatPane').style.display = isCat ? '' : 'none';
  $('prefPayPane').style.display = isCat ? 'none' : '';
  document.querySelectorAll('#prefSeg button').forEach((b) => {
    const on = b.dataset.seg === seg;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

export function initPreferences() {
  // Ensure a sensible default exists from first launch (top-most item), even
  // before the user ever opens this sheet.
  ensureDefaultCat();
  ensureDefaultPay();
  // The close (✕) glyph is injected here — the shared .sb-ico[data-icon] pass in
  // initHeader() doesn't cover sheet-close buttons, so without this the button
  // shows as an empty square.
  $('closePrefsSheet').innerHTML = icon.close({ size: 20 });
  $('prefsBtn').onclick = () => {
    showSeg('cat');
    renderCatManage();
    renderPayManage();
    $('prefsOverlay').classList.add('open');
  };
  $('closePrefsSheet').onclick = () => $('prefsOverlay').classList.remove('open');
  $('prefsOverlay').onclick = (e) => {
    if (e.target === $('prefsOverlay')) $('prefsOverlay').classList.remove('open');
  };
  $('prefSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-seg]');
    if (b) showSeg(b.dataset.seg);
  });
}
