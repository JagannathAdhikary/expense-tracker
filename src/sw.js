// Custom service worker (injectManifest). Keeps Workbox precaching AND hosts Web
// Push handlers so group members get notified of new expenses even when the app is
// closed. Registered via virtual:pwa-register in src/main.js.

import { precacheAndRoute } from 'workbox-precaching';

precacheAndRoute(self.__WB_MANIFEST);

self.skipWaiting();
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const BASE = '/expense-tracker/';

// Incoming push -> show a notification. Payload is JSON from the Edge Function.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Expense Tracker';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: BASE + 'icon-192.png',
      badge: BASE + 'badge-96.png',
      tag: data.tag,
      data: { url: data.url || BASE },
    }),
  );
});

// Tapping a notification -> focus an existing window (and tell the SPA to open the
// deep-linked group without a reload), or open a new window at the deep link.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || BASE;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      const hit = cs.find((c) => c.url.includes(BASE));
      if (hit) {
        // Already-open SPA: message it to route to the group, and (best-effort) nudge
        // its URL so a reload would also land there. Then bring it to the front.
        hit.postMessage({ type: 'open-group', url });
        try {
          if (typeof hit.navigate === 'function') hit.navigate(url).catch(() => {});
        } catch {
          /* navigate() not allowed in this context — the postMessage handles routing */
        }
        return hit.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
