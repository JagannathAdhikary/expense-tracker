// Edge Function: notify-expense (Web Push only — no email).
//
// When a member records a group expense, push a notification to the OTHER members:
//   "<payer> added ₹<amount> to <group> — you owe ₹<their share>"
// Invoked by the client (saveGroupExpense) with the user's bearer token
// (verify_jwt=true). Uses the service_role key to read across users, so it
// re-verifies the caller is the payer/member before sending anything.
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

const rupees = (n: number) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: 'push not configured' }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const authHeader = req.headers.get('Authorization') ?? '';
  const { data: userData, error: userErr } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
  if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);
  const callerId = userData.user.id;

  let payload: { expenseId?: string; groupId?: string; payerName?: string; amount?: number };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const { expenseId, groupId, payerName, amount } = payload;
  if (!groupId || !expenseId) return json({ error: 'missing groupId/expenseId' }, 400);

  // Re-verify: caller must be the payer of this expense in this group.
  const { data: exp, error: expErr } = await admin.from('group_expenses').select('id, group_id, payer_id').eq('id', expenseId).single();
  if (expErr || !exp || exp.group_id !== groupId || exp.payer_id !== callerId) return json({ error: 'forbidden' }, 403);

  const { data: grp } = await admin.from('groups').select('name').eq('id', groupId).single();
  const groupName = grp?.name || 'Group';

  // Each other member's share for this expense (for the "you owe ₹X" line).
  const { data: splits } = await admin.from('expense_splits').select('debtor_id, share_amount').eq('expense_id', expenseId);
  const shareByUser: Record<string, number> = {};
  for (const s of splits ?? []) shareByUser[s.debtor_id] = Number(s.share_amount);

  // Recipients = group members except the payer.
  const { data: members } = await admin.from('group_members').select('user_id').eq('group_id', groupId);
  const recipientIds = (members ?? []).map((m) => m.user_id).filter((id) => id !== callerId);
  if (!recipientIds.length) return json({ sent: 0 });

  const { data: subs } = await admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', recipientIds);
  if (!subs?.length) return json({ sent: 0 });

  const who = payerName || 'Someone';
  let sent = 0;
  const stale: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      const share = shareByUser[s.user_id];
      const body = `${who} added ${rupees(Number(amount) || 0)} to ${groupName}` + (share > 0 ? ` — you owe ${rupees(share)}` : '');
      const notif = JSON.stringify({ title: groupName, body, url: '/expense-tracker/', tag: `grp-${groupId}` });
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
