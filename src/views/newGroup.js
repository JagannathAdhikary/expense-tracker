// Full-screen "New group" page: name, icon (emoji + color, or an uploaded photo),
// and optional members (friends by name, or anyone by exact mobile number via the
// RPC). Create -> createGroup(name, memberIds, {color, photoUrl}) -> open detail.

import { state } from '../state.js';
import { $ } from '../dom.js';
import { icon } from '../icons.js';
import { navTo, navBack } from '../nav.js';
import { renderForScreen } from './nav-render.js';
import { matchFriends } from '../friends.js';
import { myFriends, findUserByPhone, createGroup, uploadGroupImage } from '../features/groups.js';
import { toastError, toastSuccess } from '../toast.js';

const COLORS = ['#1E3A5F', '#1A6B3A', '#7D3C98', '#C0392B', '#D35400', '#0E6655', '#2874A6', '#B7950B', '#CA6F1E', '#5B2C6F', '#34495E', '#808B96'];
const DEFAULT_ICON = '👥';

let color = COLORS[0];
let photoFile = null; // pending upload (File)
let photoPreview = null; // object URL for preview
const selected = new Map(); // userId -> {id, name, avatar}

const digits = (s) => (s || '').replace(/\D/g, '');

function renderIcon() {
  const el = $('ngIcon');
  const inner = $('ngIconInner');
  if (photoPreview) {
    inner.innerHTML = `<img class="gt-photo" src="${photoPreview}" alt=""/>`;
    el.style.background = 'transparent';
  } else {
    inner.textContent = DEFAULT_ICON;
    el.style.background = color + '20';
  }
}

function renderSwatches() {
  $('ngSwatches').innerHTML = COLORS.map((c) => `<div class="swatch${c === color ? ' on' : ''}" data-c="${c}" style="background:${c}"></div>`).join('');
}

function renderSelected() {
  const wrap = $('ngSelected');
  if (!selected.size) {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = [...selected.values()]
    .map((m) => `<span class="ng-chip">${m.name}<button class="ng-chip-x" data-remove="${m.id}" aria-label="Remove">×</button></span>`)
    .join('');
}

async function renderResults() {
  // (unused placeholder removed — search rendering lives in initNewGroup)
  return null;
}

function avatarDot(f) {
  return f.avatar
    ? `<span class="member-row-av member-avatar"><img src="${f.avatar}" alt="" referrerpolicy="no-referrer"/></span>`
    : `<span class="member-row-av member-avatar">${(f.name || '?').charAt(0).toUpperCase()}</span>`;
}

// Downscale a chosen image to <=512px (canvas) so uploads stay small. Falls back
// to the original file if anything goes wrong.
function downscale(file, max = 512) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob((blob) => resolve(blob ? new File([blob], 'group.jpg', { type: 'image/jpeg' }) : file), 'image/jpeg', 0.85);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

export function showNewGroup() {
  color = COLORS[0];
  photoFile = null;
  photoPreview = null;
  selected.clear();
  $('ngName').value = '';
  $('ngMemberSearch').value = '';
  $('ngMemberResults').innerHTML = '';
  $('ngNameErr').style.display = 'none';
  renderIcon();
  renderSwatches();
  renderSelected();
  navTo('newGroup');
  setTimeout(() => $('ngName').focus(), 80);
}

export function initNewGroup() {
  $('ngBackBtn').innerHTML = icon.back({ size: 20 });
  $('ngBackBtn').onclick = () => renderForScreen(navBack());

  document.addEventListener('open-new-group', () => {
    $('groupsOverlay').classList.remove('open'); // close the dropdown
    showNewGroup();
  });

  $('ngSwatches').addEventListener('click', (e) => {
    const sw = e.target.closest('.swatch');
    if (!sw) return;
    color = sw.dataset.c;
    photoFile = null;
    photoPreview = null; // choosing a color clears a pending photo
    renderIcon();
    renderSwatches();
  });

  $('ngPhotoBtn').onclick = () => $('ngPhotoInput').click();
  $('ngIcon').onclick = () => $('ngPhotoInput').click();
  $('ngPhotoInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    photoFile = await downscale(file);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    photoPreview = URL.createObjectURL(photoFile);
    renderIcon();
  });

  let searchSeq = 0;
  $('ngMemberSearch').addEventListener('input', async () => {
    const seq = ++searchSeq;
    const html = await renderResultsAsync();
    if (seq === searchSeq) $('ngMemberResults').innerHTML = html; // ignore stale async results
  });
  // helper that returns HTML (so we can guard against out-of-order async)
  async function renderResultsAsync() {
    const q = $('ngMemberSearch').value;
    const friends = myFriends().filter((f) => !selected.has(f.id));
    if (!q.trim()) return '';
    let results = matchFriends(friends, q);
    if (!results.length && digits(q).length >= 10) {
      const u = await findUserByPhone(q);
      if (u && !selected.has(u.id)) results = [{ id: u.id, name: u.name, avatar: u.avatar }];
    }
    return results.length
      ? results.map((f) => `<button class="member-result" data-pick="${f.id}" data-name="${encodeURIComponent(f.name)}">${avatarDot(f)}<span class="member-row-name">${f.name}</span><span class="member-add-plus">+</span></button>`).join('')
      : '<div class="member-empty">No match. They may not be on the app yet — you can share the invite link after creating.</div>';
  }

  $('ngMemberResults').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    selected.set(btn.dataset.pick, { id: btn.dataset.pick, name: decodeURIComponent(btn.dataset.name) });
    $('ngMemberSearch').value = '';
    $('ngMemberResults').innerHTML = '';
    renderSelected();
  });

  $('ngSelected').addEventListener('click', (e) => {
    const x = e.target.closest('[data-remove]');
    if (!x) return;
    selected.delete(x.dataset.remove);
    renderSelected();
  });

  $('ngCreateBtn').onclick = async () => {
    const name = $('ngName').value.trim();
    if (!name) {
      $('ngNameErr').textContent = 'Please name your group.';
      $('ngNameErr').style.display = '';
      $('ngName').focus();
      return;
    }
    const btn = $('ngCreateBtn');
    btn.disabled = true;
    btn.textContent = 'Creating…';
    try {
      // Create first (need a group id for the photo path), then upload + attach.
      const grp = await createGroup(name, [...selected.keys()], { color });
      if (!grp) return;
      if (photoFile) {
        const url = await uploadGroupImage(photoFile, grp.id);
        if (url) {
          const { setGroupPhoto } = await import('../features/groups.js');
          await setGroupPhoto(grp.id, url);
        }
      }
      toastSuccess('Group created');
      const { showGroupDetail } = await import('./groups.js');
      $('newGroup').classList.remove('active');
      showGroupDetail(grp.id);
    } catch (err) {
      toastError('Could not create the group.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create group';
    }
  };
}
