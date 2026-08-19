// Edge Function: notify-group (Web Push only — no email).
//
// Generalises notify-expense to ALL major group activities: expense add/edit/delete,
// settle-up, member add/leave, and group create/rename/delete. The CLIENT composes
// the human-readable `body` text and passes a `type`; this function just fans that
// body out as a push to the group's OTHER members and adds a deep-link URL so tapping
// the notification opens the relevant group (and expense, when applicable).
//
// Invoked by the client with the user's bearer token (verify_jwt=true). Uses the
// service_role key to read across users, so it re-verifies the caller is a member of
// the group before sending anything.
//
// Recipient resolution:
//   - Normally: read group_members, verify the caller is a member (403 otherwise),
//     recipients = members − caller.
//   - settle: same membership check, but when the client supplies `recipientIds` the
//     recipients are narrowed to the INTERSECTION of that list with the real member
//     set (minus the caller). A settle concerns only the counterparty, so the client
//     names them; intersecting with real membership keeps this from being usable to
//     push to arbitrary users. Omitting recipientIds falls back to all other members.
//   - group_delete: the group row (and its group_members) are already gone by the time
//     this is called, so membership cannot be re-verified. In that ONE case the client
//     passes the pre-delete member ids as `recipientIds` and we trust the JWT-
//     authenticated caller. Worst case: an authenticated caller could name arbitrary
//     user ids to push to (only those who have a push subscription would receive it) —
//     a minor, bounded abuse surface, accepted deliberately for this event type only.
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

// The event types the client may send. group_delete is the only one that relies on
// caller-supplied recipientIds (the group is gone, so membership can't be re-read).
const KNOWN_TYPES = new Set([
  'expense_add',
  'expense_edit',
  'expense_delete',
  'settle',
  'member_add',
  'member_leave',
  'group_create',
  'group_rename',
  'group_delete',
]);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: 'push not configured' }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const authHeader = req.headers.get('Authorization') ?? '';
  const { data: userData, error: userErr } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
  if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);
  const callerId = userData.user.id;

  let payload: {
    type?: string;
    groupId?: string;
    title?: string;
    body?: string;
    expId?: string;
    recipientIds?: string[];
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const { type, groupId, title, body, expId, recipientIds } = payload;
  if (!type || !KNOWN_TYPES.has(type)) return json({ error: 'unknown type' }, 400);
  if (!groupId || !body) return json({ error: 'missing groupId/body' }, 400);

  // Resolve recipients.
  let recipients: string[];
  if (type === 'group_delete') {
    // Group is gone — trust the caller-supplied ids (see header note).
    recipients = (recipientIds ?? []).filter((id) => id && id !== callerId);
  } else {
    const { data: members } = await admin.from('group_members').select('user_id').eq('group_id', groupId);
    const ids = (members ?? []).map((m) => m.user_id);
    // Re-verify the caller actually belongs to this group before pushing to it.
    if (!ids.includes(callerId)) return json({ error: 'forbidden' }, 403);
    const others = ids.filter((id) => id !== callerId);
    // A settle may narrow the audience to the counterparty. Intersect with the real
    // member set so a caller can never push to someone outside the group.
    if (Array.isArray(recipientIds) && recipientIds.length) {
      const wanted = new Set(recipientIds);
      recipients = others.filter((id) => wanted.has(id));
    } else {
      recipients = others;
    }
  }
  if (!recipients.length) return json({ sent: 0 });

  // Group name for the title — tolerate a missing row (e.g. just-deleted group) by
  // falling back to a client-supplied title.
  const { data: grp } = await admin.from('groups').select('name').eq('id', groupId).maybeSingle();
  const groupName = grp?.name || title || 'Group';

  const { data: subs } = await admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', recipients);
  if (!subs?.length) return json({ sent: 0 });

  // Deep link: open the app on this group (and expense, when relevant). The SW turns
  // this into focus+navigate for an open app, or openWindow for a closed one.
  const url = '/expense-tracker/?group=' + encodeURIComponent(groupId) + (expId ? '&exp=' + encodeURIComponent(expId) : '');

  let sent = 0;
  const stale: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      const notif = JSON.stringify({ title: groupName, body, url, tag: `grp-${groupId}` });
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
