// Google authentication via Supabase. Exposes the signed-in user on state.user
// and notifies the rest of the app on auth changes via a small callback list.
// When cloud is not configured, all functions are no-ops and the app stays local-only.

import { supabase, cloudEnabled } from '../supabase.js';
import { state } from '../state.js';
import { $ } from '../dom.js';

// Listeners invoked whenever auth state changes (sign in / out / session restore).
const authListeners = [];
export const onAuthChange = (fn) => authListeners.push(fn);
const notify = () => authListeners.forEach((fn) => fn(state.user));

function setUser(session) {
  const u = session?.user || null;
  state.user = u
    ? {
        id: u.id,
        email: u.email,
        name: u.user_metadata?.full_name || u.user_metadata?.name || u.email,
        avatar: u.user_metadata?.avatar_url || null,
      }
    : null;
}

// Redirect back to the app's base path after the OAuth round-trip.
const redirectTo = () => window.location.origin + import.meta.env.BASE_URL;

export async function signInWithGoogle() {
  if (!cloudEnabled()) return;
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectTo() },
  });
}

export async function signOut() {
  if (!cloudEnabled()) return;
  await supabase.auth.signOut();
}

// Render the auth row inside the Options sheet: either a sign-in button or the
// signed-in identity + sign-out.
function renderAuthUI() {
  const box = $('authBox');
  if (!box) return;
  if (!cloudEnabled()) {
    box.innerHTML = '<div style="font-size:12px;color:#999;padding:4px 0">Cloud sync not configured. Group features are unavailable.</div>';
    return;
  }
  if (state.user) {
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 0">
        ${state.user.avatar ? `<img src="${state.user.avatar}" alt="" style="width:32px;height:32px;border-radius:50%"/>` : '<span style="font-size:26px">👤</span>'}
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${state.user.name || 'Signed in'}</div>
          <div style="font-size:11px;color:#999;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${state.user.email || ''}</div>
        </div>
        <button class="chip" id="signOutBtn">Sign out</button>
      </div>`;
    $('signOutBtn').onclick = signOut;
  } else {
    box.innerHTML = '<button class="sheet-btn" id="signInBtn"><span>🔑</span> Sign in with Google</button>';
    $('signInBtn').onclick = signInWithGoogle;
  }
}

export function initAuth() {
  renderAuthUI(); // initial paint (logged-out / not-configured)
  if (!cloudEnabled()) return;

  // Restore any existing session and react to future changes.
  supabase.auth.getSession().then(({ data }) => {
    setUser(data.session);
    renderAuthUI();
    notify();
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    setUser(session);
    renderAuthUI();
    notify();
  });
}
