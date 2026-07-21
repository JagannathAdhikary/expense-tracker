# Group Splitting — Supabase setup

The app works **fully offline for personal expenses with no setup** — everything stays in
`localStorage`. The **Groups / split-expense** feature needs a free Supabase backend. Follow
these one-time steps to turn it on.

## 1. Create a Supabase project (free)

1. Go to <https://supabase.com>, sign up, and create a new project (free tier).
2. Once it's provisioned, open **Project Settings → API** and copy:
   - **Project URL** (e.g. `https://abcd1234.supabase.co`)
   - **anon public** key
3. In the repo, copy `.env.example` to `.env` and paste the values:
   ```
   VITE_SUPABASE_URL=https://abcd1234.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key...
   ```
   > The anon key is meant to be public/shipped to the browser. Row-Level Security (RLS)
   > in the database is what actually protects data — see step 3.

## 2. Enable Google sign-in (free)

1. Create a Google OAuth client: <https://console.cloud.google.com> → APIs & Services →
   Credentials → **Create OAuth client ID** → *Web application*.
2. Under **Authorized redirect URIs**, add your Supabase callback (shown in the Supabase
   dashboard, step below) — it looks like:
   `https://abcd1234.supabase.co/auth/v1/callback`
3. In Supabase → **Authentication → Providers → Google**: paste the Google **Client ID**
   and **Client Secret**, and enable it.
4. In Supabase → **Authentication → URL Configuration**, add your app URLs to the allowed
   redirect list:
   - `http://localhost:5173/expense-tracker/` (local dev)
   - your deployed URL, e.g. `https://<you>.github.io/expense-tracker/`

## 3. Create the database schema + security rules

1. In Supabase → **SQL Editor → New query**.
2. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql) and **Run**.
   This creates the tables (`profiles`, `groups`, `group_members`, `group_expenses`,
   `expense_splits`), the profile-creation trigger, all Row-Level Security policies, and
   enables realtime. It is safe to re-run.

## 4. Run it

```bash
npm install
npm run dev      # http://localhost:5173/expense-tracker/
```

Open **Options (⋮) → Sign in with Google**, then **Options → Groups** to create or join a
group. Add an expense and pick a group under **Split with group** to split it.

## How the split works
- Say A pays ₹300 and tags a group {A, B, C}, equal split → ₹100 each.
- A's list shows the ₹300 they fronted; B and C each see a pending **−₹100** "you owe" row,
  which is **excluded from their spent total** until settled.
- When B and C tap **✓ / Mark done**, their ₹100 counts as their real spend and A's
  effective spend rebalances down to ₹100. Changes sync live via Supabase realtime.
- **"Mark done" is a status flag only** — no real money moves; settle up however you like.

## Personal expense cloud sync (optional)

Personal expenses live in `localStorage` by default. After signing in, the app offers a
**one-time prompt** to upload them to the cloud, and the menu has a **Cloud sync** toggle you
can flip anytime. When on, every add/edit/delete is mirrored to a private `personal_expenses`
table (row-level-secured to you), and on login the cloud copy is pulled and merged — newest
change wins, deletes propagate. This is what makes your expenses appear on a second device.
The `personal_expenses` table is created by the same `supabase/schema.sql`.

## Notes

- Free Supabase projects **pause after 1 week of inactivity**; restore with one click in the
  dashboard.
- Phone/SMS login is **not** free on Supabase, so Google sign-in is used.
- `npm test` runs the split-math unit tests (`test/split.test.js`).
- For deployment, provide `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` as build-time
  environment variables on your host (e.g. GitHub Actions secrets for GitHub Pages).
