// Google authentication via Supabase. Exposes the signed-in user on state.user
// and notifies the rest of the app on auth changes via a small callback list.
// When cloud is not configured, all functions are no-ops and the app stays local-only.

import { supabase, cloudEnabled } from '../supabase.js';
import { state } from '../state.js';
import { $ } from '../dom.js';
import { icon } from '../icons.js';

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

// Render the auth row inside the menu sheet: the signed-in identity + sign-out,
// a Google sign-in button when logged out, or a note when cloud isn't configured.
function renderAuthUI() {
  const box = $('authBox');
  if (!box) return;
  if (!cloudEnabled()) {
    box.innerHTML = '<div class="auth-note">Cloud sync not configured — group features are unavailable.</div>';
    return;
  }
  if (state.user) {
    box.innerHTML = `
      <div class="profile-card">
        ${state.user.avatar ? `<img src="${state.user.avatar}" alt=""/>` : `<span class="avatar-fallback">${(state.user.name || '?').charAt(0).toUpperCase()}</span>`}
        <div class="profile-meta">
          <div class="profile-name">${state.user.name || 'Signed in'}</div>
          <div class="profile-email">${state.user.email || ''}</div>
        </div>
        <button class="hdr-btn" id="signOutBtn">${icon.logout({ size: 16 })}<span>Sign out</span></button>
      </div>`;
    $('signOutBtn').onclick = signOut;
  } else {
    box.innerHTML = `<button class="google-btn" id="signInBtn">${icon.google()}<span>Sign in with Google</span></button>`;
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
