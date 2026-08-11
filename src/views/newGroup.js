// Full-screen "New group" page: name, cover (emoji on a gradient theme, or an
// uploaded photo), and optional members (friends by name, or anyone by exact
// mobile number via the RPC). Create -> createGroup -> open the new group.

import { $ } from '../dom.js';
import { icon } from '../icons.js';
import { navTo, navBack } from '../nav.js';
import { renderForScreen } from './nav-render.js';
import { matchFriends } from '../friends.js';
import { myFriends, findUserByPhone, createGroup, uploadGroupImage, setGroupPhoto } from '../features/groups.js';
import { GROUP_THEME_LIST, GROUP_THEME_ID_LIST, DEFAULT_GROUP_THEME } from './groups.js';
import { downscaleImage } from '../imgutil.js';
import { toastError, toastSuccess } from '../toast.js';

let theme = DEFAULT_GROUP_THEME;
let photoFile = null;
let photoPreview = null;
const selected = new Map(); // userId -> {id, name, avatar}

const digits = (s) => (s || '').replace(/\D/g, '');

// Wide cover preview (photo, else the chosen cover scene).
function renderCover() {
  const el = $('ngIcon');
  if (photoPreview) {
    el.style.background = `center/cover no-repeat url('${photoPreview}')`;
  } else {
    el.style.background = GROUP_THEME_LIST[theme] || GROUP_THEME_LIST[DEFAULT_GROUP_THEME];
  }
  el.innerHTML = '';
}

function renderThemes() {
  $('ngSwatches').innerHTML = GROUP_THEME_ID_LIST.map((id) => `<div class="theme-swatch${id === theme && !photoPreview ? ' on' : ''}" data-theme="${id}" style="background:${GROUP_THEME_LIST[id]}"></div>`).join('');
}

function renderSelected() {
  const wrap = $('ngSelected');
  wrap.innerHTML = !selected.size
    ? ''
    : [...selected.values()].map((m) => `<span class="ng-chip">${m.name}<button class="ng-chip-x" data-remove="${m.id}" aria-label="Remove">×</button></span>`).join('');
}

function avatarDot(f) {
  return f.avatar
    ? `<span class="member-row-av member-avatar"><img src="${f.avatar}" alt="" referrerpolicy="no-referrer"/></span>`
    : `<span class="member-row-av member-avatar">${(f.name || '?').charAt(0).toUpperCase()}</span>`;
}

// Show the friends list under the search bar. Empty query -> all friends (not yet
// selected); typing filters by name, and a 10-digit number looks up anyone by phone.
let searchSeq = 0;
async function renderNgMembers() {
  const seq = ++searchSeq;
  const q = $('ngMemberSearch').value;
  const friends = myFriends().filter((f) => !selected.has(f.id));
  const rowHtml = (f) => `<button class="member-result" data-pick="${f.id}" data-name="${encodeURIComponent(f.name)}">${avatarDot(f)}<span class="member-row-name">${f.name}</span><span class="member-add-plus">+</span></button>`;
  let html;
  if (!q.trim()) {
    html = friends.length
      ? friends.map(rowHtml).join('')
      : '<div class="member-empty">No friends yet. Search by mobile number, or share the invite link after creating.</div>';
  } else {
    let results = matchFriends(friends, q);
    if (!results.length && digits(q).length >= 10) {
      const u = await findUserByPhone(q);
      if (u && !selected.has(u.id)) results = [{ id: u.id, name: u.name, avatar: u.avatar }];
    }
    html = results.length
      ? results.map(rowHtml).join('')
      : '<div class="member-empty">No match. They may not be on the app yet — you can share the invite link after creating.</div>';
  }
  if (seq === searchSeq) $('ngMemberResults').innerHTML = html; // ignore stale async
}

export function showNewGroup() {
  theme = DEFAULT_GROUP_THEME;
  photoFile = null;
  photoPreview = null;
  selected.clear();
  $('ngName').value = '';
  $('ngMemberSearch').value = '';
  $('ngNameErr').style.display = 'none';
  renderCover();
  renderThemes();
  renderSelected();
  renderNgMembers(); // show friends immediately, before any typing
  navTo('newGroup');
  setTimeout(() => $('ngName').focus(), 80);
}

export function initNewGroup() {
  $('ngBackBtn').innerHTML = icon.back({ size: 20 });
  $('ngBackBtn').onclick = () => renderForScreen(navBack());

  document.addEventListener('open-new-group', () => {
    $('groupsOverlay').classList.remove('open');
    showNewGroup();
  });
  $('ngSwatches').addEventListener('click', (e) => {
    const sw = e.target.closest('.theme-swatch');
    if (!sw) return;
    theme = sw.dataset.theme;
    photoFile = null;
    photoPreview = null;
    renderCover();
    renderThemes();
  });

  $('ngPhotoBtn').querySelector('.pub-ico').innerHTML = icon.upload({ size: 16 });
  $('ngPhotoBtn').onclick = () => $('ngPhotoInput').click();
  $('ngIcon').onclick = () => $('ngPhotoInput').click();
  $('ngPhotoInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    photoFile = await downscaleImage(file);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    photoPreview = URL.createObjectURL(photoFile);
    renderCover();
    renderThemes();
  });

  $('ngMemberSearch').addEventListener('input', renderNgMembers);

  $('ngMemberResults').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    selected.set(btn.dataset.pick, { id: btn.dataset.pick, name: decodeURIComponent(btn.dataset.name) });
    $('ngMemberSearch').value = '';
    renderSelected();
    renderNgMembers(); // refresh so the picked friend drops out of the list
  });

  $('ngSelected').addEventListener('click', (e) => {
    const x = e.target.closest('[data-remove]');
    if (!x) return;
    selected.delete(x.dataset.remove);
    renderSelected();
    renderNgMembers(); // the removed friend reappears in the list
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
      const grp = await createGroup(name, [...selected.keys()], { color: theme });
      if (!grp) return;
      if (photoFile) {
        const url = await uploadGroupImage(photoFile, grp.id);
        if (url) await setGroupPhoto(grp.id, url);
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
