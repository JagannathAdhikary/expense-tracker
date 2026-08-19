// Web Push: subscribe the browser and store the subscription in Supabase so the
// notify-group Edge Function can reach group members when the app is closed.
//
// Flow: after login we AUTO-ask permission and subscribe on grant ("on by default"
// as far as browsers allow — a one-time Allow is unavoidable). A menu toggle turns
// it off. On iOS the prompt needs a user gesture + an installed PWA, so auto-ask
// may not fire there; the toggle is the reliable path.

import { supabase, cloudEnabled } from '../supabase.js';
import { toastError, toastSuccess, toastInfo } from '../toast.js';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function subKeys(sub) {
  const j = sub.toJSON();
  return { endpoint: sub.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth };
}

const getReg = () => navigator.serviceWorker.ready;

// Ensure a subscription exists and is stored for `user`. Idempotent (upsert by endpoint).
async function subscribeAndStore(user) {
  if (!cloudEnabled() || !user || !VAPID_PUBLIC_KEY) return false;
  const reg = await getReg();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
  }
  const { endpoint, p256dh, auth } = subKeys(sub);
  if (!endpoint || !p256dh || !auth) return false;
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ user_id: user.id, endpoint, p256dh, auth, user_agent: navigator.userAgent }, { onConflict: 'endpoint' });
  if (error) {
    console.warn('store push subscription failed', error);
    return false;
  }
  return true;
}

export async function isSubscribed() {
  if (!pushSupported()) return false;
  try {
    return !!(await (await getReg()).pushManager.getSubscription());
  } catch {
    return false;
  }
}

// Auto-enable after login: if permission is already granted, silently (re)subscribe.
// If it's the default (unasked) state, proactively ask once and subscribe on grant.
// Respects a user's explicit opt-out (stored so we don't re-nag every login).
export async function autoEnablePush(user) {
  if (!pushSupported() || !VAPID_PUBLIC_KEY || !cloudEnabled() || !user) return;
  if (localStorage.getItem('push_optout') === '1') return; // user turned it off
  const perm = Notification.permission;
  if (perm === 'granted') {
    await subscribeAndStore(user);
  } else if (perm === 'default') {
    try {
      const res = await Notification.requestPermission();
      if (res === 'granted') await subscribeAndStore(user);
    } catch {
      /* iOS may reject non-gesture requests; the menu toggle covers it */
    }
  }
}

// Menu toggle "on": request permission (from the tap) + subscribe.
export async function enablePush(user) {
  if (!pushSupported()) {
    toastInfo('Notifications aren’t supported on this browser.');
    return false;
  }
  if (!VAPID_PUBLIC_KEY) {
    toastError('Notifications aren’t configured yet.');
    return false;
  }
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    toastInfo(perm === 'denied' ? 'Notifications are blocked in your browser settings.' : 'Notifications not enabled.');
    return false;
  }
  localStorage.removeItem('push_optout');
  const ok = await subscribeAndStore(user);
  if (ok) toastSuccess('Group notifications on');
  else toastError('Could not enable notifications.');
  return ok;
}

// Turn off: unsubscribe locally, delete the row, remember the opt-out.
export async function disablePush() {
  localStorage.setItem('push_optout', '1');
  if (!pushSupported()) return;
  try {
    const sub = await (await getReg()).pushManager.getSubscription();
    if (!sub) return;
    const { endpoint } = subKeys(sub);
    if (cloudEnabled() && endpoint) await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    await sub.unsubscribe();
  } catch (e) {
    console.warn('push unsubscribe failed', e);
  }
}

export function pushStatus() {
  if (!pushSupported() || !VAPID_PUBLIC_KEY) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}
