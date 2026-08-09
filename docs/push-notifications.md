# Push notifications setup (Web Push, no email)

Group members get a push notification when someone adds a group expense — even
with the app closed — e.g. *"Rahul added ₹500 to Trip Goa — you owe ₹250"*. It's
on by default (asks permission once after login); a menu toggle turns it off.

## 1. Generate VAPID keys
```
npx web-push generate-vapid-keys
```
Copy the Public and Private keys.

## 2. Client env var (public key)
- Local `.env`: `VITE_VAPID_PUBLIC_KEY=<public key>`
- Production: add `VITE_VAPID_PUBLIC_KEY` to the repo's GitHub Actions secrets
  (the deploy workflow passes it through).

## 3. Database table
Run `supabase/migration_push.sql` in the Supabase SQL Editor (creates
`push_subscriptions` + RLS). Also included in `schema.sql`.

## 4. Supabase CLI + Edge Function
```
brew install supabase/tap/supabase          # if not installed
supabase login
supabase link --project-ref <your-project-ref>
supabase secrets set \
  VAPID_PUBLIC_KEY=<public key> \
  VAPID_PRIVATE_KEY=<private key> \
  VAPID_SUBJECT=mailto:you@example.com
supabase functions deploy notify-expense
```
(`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

## 5. Try it
- Sign in → after login the browser asks "Allow notifications?" → Allow. A row
  appears in `push_subscriptions`. (Menu → "Group notifications" toggles it.)
- With a second account in the same group, add a group expense from account A →
  account B (app backgrounded/closed) gets the banner. Tapping it opens the app.

## How it fits together
- `src/sw.js` — custom service worker (injectManifest) with `push` /
  `notificationclick` handlers.
- `src/features/push.js` — auto-ask + subscribe/unsubscribe, menu toggle logic.
- `src/features/groups.js` `saveGroupExpense` — best-effort
  `functions.invoke('notify-expense')` after saving (never blocks the save).
- `supabase/functions/notify-expense/index.ts` — verifies the caller, computes
  each recipient's share, pushes to the other members, prunes dead (404/410) subs.

## Notes
- **Android:** works when the PWA is installed to the home screen.
- **iOS:** only works as an installed PWA (Add to Home Screen, iOS 16.4+); the
  permission prompt needs a user gesture, so on iOS use the menu toggle to enable.
- **Desktop browsers:** works when notifications are allowed.
- If `VITE_VAPID_PUBLIC_KEY` is unset, the feature is inert and the app behaves as
  before — it degrades cleanly.
