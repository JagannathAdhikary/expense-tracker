// Edge Function: notify-broadcast (Web Push to ALL subscribed users — maintainer-only).
//
// Unlike notify-group (which is JWT-gated and fans out to a single group's members),
// this sends one announcement to EVERY row in push_subscriptions. That power must never
// be client-callable, so this function is PRIVILEGED: it requires the caller to present
// the project's SERVICE_ROLE key as the bearer token. Deploy it with verify_jwt=false
// (otherwise the platform would reject the service-role token as a non-user JWT):
//
//   supabase functions deploy notify-broadcast --no-verify-jwt
//
// Trigger it manually, only when you want to announce something — e.g.:
//
//   curl -i -X POST "$SUPABASE_URL/functions/v1/notify-broadcast" \
//     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
//     -H "Content-Type: application/json" \
//     -d '{"title":"Expense Tracker","body":"New: group chat + CSV import. Open to see what'"'"'s new.","url":"/expense-tracker/?whatsnew=1"}'
//
// Users who turned notifications off have had their subscription row deleted
// (see disablePush in src/features/push.js), so they receive nothing — opt-out is honored.
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@x).
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'https://esm.sh/web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BASE = '/expense-tracker/';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: 'push not configured' }, 500);

  // Privileged gate: only a caller holding the service_role key may broadcast. This is
  // a constant-length-ish compare on the bearer token; there is no user-JWT path here.
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!SERVICE_ROLE || token !== SERVICE_ROLE) return json({ error: 'forbidden' }, 403);

  let payload: { title?: string; body?: string; url?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const { title, body, url } = payload;
  if (!body) return json({ error: 'missing body' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Every subscription across all users — the one place we read the whole table.
  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth');
  if (!subs?.length) return json({ sent: 0 });

  const notif = JSON.stringify({
    title: title || 'Expense Tracker',
    body,
    url: url || BASE,
    tag: 'broadcast',
  });

  let sent = 0;
  const stale: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, notif);
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) stale.push(s.id);
        else console.error('push send failed', code, err);
      }
    }),
  );
  if (stale.length) await admin.from('push_subscriptions').delete().in('id', stale);

  return json({ sent, removed: stale.length });
});
