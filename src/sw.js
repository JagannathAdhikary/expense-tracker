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

// Tapping a notification -> focus an existing window or open one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || BASE;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      const hit = cs.find((c) => c.url.includes(BASE));
      return hit ? hit.focus() : self.clients.openWindow(url);
    }),
  );
});
