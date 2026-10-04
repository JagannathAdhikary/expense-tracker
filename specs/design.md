# Design — Expense Tracker

> **The "how."** This document describes the architecture, data model, and key
> algorithms that satisfy [`spec.md`](./spec.md). The build order lives in
> [`plan.md`](./plan.md).

---

## 1. Architecture overview

A **framework-free, vanilla-JS single-page PWA** built with Vite, backed by an
**optional** Supabase cloud.

```
┌─────────────────────────── Browser (PWA) ───────────────────────────┐
│  index.html  — single shell: every screen + modal as hidden nodes    │
│                                                                      │
│  src/ (ES modules)                                                   │
│   ├── views/      render + wire one screen each (DOM)                │
│   ├── features/   cross-cutting flows (auth, sync, push, groups…)    │
│   ├── pure logic  split · analytics · csv · upi · phone · friends…   │
│   ├── state.js    one mutable in-memory singleton                    │
│   ├── storage.js  localStorage persistence (personal data)           │
│   ├── supabase.js client singleton (anon key) — null if no env       │
│   └── sw.js       service worker: precache + Web Push                 │
└──────────────────────────────────────────────────────────────────────┘
            │ (only when signed in & cloudEnabled())
            ▼
┌──────────────────────────── Supabase ────────────────────────────────┐
│  Postgres + Row-Level Security   Realtime (postgres_changes)          │
│  Presence channels               Edge Functions (Deno) for Web Push    │
└───────────────────────────────────────────────────────────────────────┘
```

### Principles
- **Local-first.** The app boots and runs entirely from `localStorage`. Cloud features
  are gated behind `cloudEnabled()` and a signed-in user; when Supabase env vars are
  absent the client is `null` and group features simply don't appear.
- **Pure logic is isolated from the DOM.** All math and transforms (`split.js`,
  `analytics.js`, `csv.js`, `upi.js`, `phone.js`, `friends.js`, `format.js`) are pure and
  unit-tested; views only orchestrate them against the DOM.
- **Trust the database, not the client.** Every cloud mutation is re-validated by RLS;
  privileged fan-out (push) runs server-side in Edge Functions with the service-role key,
  never in the browser.

## 2. Module patterns (conventions)

- **`$ = document.getElementById`** (`src/dom.js`) — the one DOM accessor.
- **View/feature contract:** each module exports `init<X>()` (one-time event wiring,
  called once at boot from `main.js`) and `render<X>()` / `show<X>()` (idempotent,
  state-driven re-render). Views write `innerHTML` into fixed nodes in `index.html`.
- **Central state:** `src/state.js` is a single mutable singleton. ES module bindings are
  read-only, so runtime data is **mutated in place** (e.g. `state.recs.push(...)`), never
  reassigned.
- **Navigation:** `nav.js` keeps a screen stack with per-screen scroll restoration;
  `views/nav-render.js` dispatches re-renders after `navBack()` using **lazy dynamic
  imports** to break circular dependencies.
- **Graceful cloud gating:** anything touching Supabase first checks `cloudEnabled()`.

## 3. Data model

Personal data is local; cloud/group data lives in Postgres (canonical schema in
`supabase/schema.sql`). **All cloud tables are RLS-protected.**

### Local (localStorage)
- `state.recs` — personal expenses `{ id, amt, cat, pay, desc, date, updated, deleted }`.
  Keys: `xpns`, `xpns_cats`, `xpns_pays`, `xpns_prefs`.

### Cloud (Postgres)

| Table | Purpose | Key fields |
|---|---|---|
| **profiles** | 1:1 with `auth.users`, auto-created on signup | `id`, `email`, `display_name`, `avatar_url`, `phone`, `upi_id`, `upi_ids[]`, `sync_enabled` |
| **groups** | A splitting container | `id`, `name`, `invite_code` (unique secret), `icon`/`color`/`photo_url`, `retired_at`, `simplify_debts`, `is_direct`, `created_by` |
| **group_members** | Membership | PK `(group_id, user_id)`, `role` (owner/member) |
| **group_expenses** | A shared expense | `id`, `group_id`, `payer_id`, `amount`, `description`, `category`, `pay`, `spent_on`, `split_mode` |
| **expense_splits** | One debtor's share of an expense | `id`, `expense_id`, `debtor_id`, `share_amount`, `status` (pending/done), per-user `cat`/`pay`/`note`; unique `(expense_id, debtor_id)` |
| **settlements** | A real repayment (debts are **not** stored) | `id`, `group_id`, `from_user`, `to_user`, `amount`, `kind` (manual/simplified) |
| **group_messages** | Chat (immutable v1) | `id`, `group_id`, `sender_id`, `body` (1–2000), `created_at` |
| **personal_expenses** | Optional cloud mirror for sync | PK `(user_id, id)`, `amt`, `cat`, `pay`, `descr`, `spent_on`, `deleted` (tombstone), `updated_at` (LWW) |
| **push_subscriptions** | Web Push endpoints | `id`, `user_id`, `endpoint` (unique), `p256dh`, `auth` |

### Key database functions
- `is_group_member(gid)` — `SECURITY DEFINER`; used inside RLS policies to avoid
  recursive policy evaluation.
- `find_user_by_phone(p_phone)` — `SECURITY DEFINER`, granted to `authenticated` only;
  returns a **single exact** last-10-digit match (no enumeration).
- `handle_new_user()` — trigger that creates a `profiles` row on signup.

### Design decision: debts are derived, not stored
Storing balances invites drift. Instead, a member's position is computed live by
**netting pending `expense_splits`** and subtracting recorded `settlements`. Settlements
are the only persisted money event, so the ledger is always reconstructable and auditable.

## 4. Key algorithms

### Split math (`split.js`) — integer paise
All splitting runs in **integer paise** to guarantee reconciliation. `computeSplits`
handles four modes:
- **equal** — distribute evenly; remainder paise spread deterministically so the parts
  sum exactly to the total.
- **amount** — explicit per-person amounts (must sum to the total).
- **percent** — per-person percentages (must sum to 100).
- **shares** — weighted shares.

Supporting pure functions: `netForUser`, `pendingOwedByUser`, `netBetween(Paise)`,
`groupNetsPaise`, `simplifyTransfers`, `simplifiedForUser`.

### Debt netting & simplification
- **Netting** (`netBetween`): for any pair, pending shares cancel in both directions to a
  single signed balance.
- **Simplification** (`simplifyTransfers`): given all members' net positions in a group,
  produce the minimal set of transfers (greedy max-creditor/max-debtor matching). Enabled
  per group via `simplify_debts`.

### UPI deep link (`upi.js`)
`buildUpiLink` emits `upi://pay?pa=<vpa>&pn=<name>&cu=INR&am=<amount>&tn=<note>` after
validating the VPA. The app launches it; completion is **not** tracked (out of scope).

### Analytics (`analytics.js`)
Pure aggregations over a period's rows: `monthTotal`, `dailyBuckets`, `categoryTotals`,
`paymentTotals`, `weekdayBuckets`, `monthlySeries`, `rangeStats`. **Pending owed rows are
excluded from spend** (you spent what you paid, not what you owe). Rendered as
**hand-rolled inline SVG/CSS** charts in `views/analytics.js` — no chart library.

## 5. Cloud integration

### Row-Level Security (the trust boundary)
- `profiles`: visible to self + co-members.
- `groups`: selectable by members/creator **and** by anyone holding the invite code
  (the code is treated as a secret capability).
- `group_expenses`: insert only by the payer, who must be a member.
- `expense_splits`: updatable by the debtor (their own share) or the payer.
- `group_messages`: member-read, self-insert, **no update/delete policy** (immutable).
- `settlements`: insert/delete by `created_by`.
- `personal_expenses`, `push_subscriptions`: scoped to `user_id = auth.uid()`.

### Realtime
A single `group-changes` channel subscribes to `postgres_changes` (`*`) on
`group_expenses`, `expense_splits`, `settlements`, `groups`, `group_members`, and `INSERT`
on `group_messages`, triggering a **debounced reload**. Subscribe/unsubscribe lifecycle in
`features/groups.js`.

### Presence
Per-group chat presence channels `chat-presence-<gid>` track present member ids (join /
leave / sync). Presence gates push: an actively-present user isn't notified for messages
they're already watching.

### Edge Functions (Deno) — privileged push fan-out
| Function | Purpose | Auth |
|---|---|---|
| **notify-expense** | On a new group expense, push "X added ₹Y — you owe ₹Z" to other members | `verify_jwt=true`, re-verifies via service role |
| **notify-group** | Generalized push for all group activity (add/edit/delete expense, settle, membership, group lifecycle) with a deep-link URL | `verify_jwt=true` |
| **notify-broadcast** | Maintainer-only announcement to all subscribers | `--no-verify-jwt`, gated by `BROADCAST_SECRET` bearer |

Secrets (`VAPID_*`, service role) live only in the function environment. **The client
never calls `notify-broadcast` and never holds a service-role key.**

## 6. PWA / offline

- `vite-plugin-pwa` with `strategies: injectManifest`, `srcDir: src`, `filename: sw.js`.
- `src/sw.js`: Workbox `precacheAndRoute(self.__WB_MANIFEST)`, `skipWaiting` +
  `clients.claim`, and Web Push `push` / `notificationclick` handlers that deep-link into
  the right screen (`?join`, `?group`, `?exp`, `?whatsnew`).
- Manifest: standalone, portrait, theme `#1E3A5F`, 192/512 + maskable icons.
- Base path `/expense-tracker/`; `__APP_VERSION__` injected from `package.json`.

## 7. Testing strategy

All **business logic is DOM-free and unit-tested** with Vitest (9 files, ~106 cases):
`analytics`, `csv`, `upi`, `netting`, `split`, `phone`, `search`, `friends`, `simplify`.
Views and Supabase I/O are intentionally **not** unit-tested — correctness is pushed down
into the pure modules, and the DB enforces its own invariants via RLS and constraints.

## 8. Security & privacy posture

- Browser holds only the **anon** key; all authority is RLS + Edge Functions.
- No user directory: discovery is exact-phone-match (`find_user_by_phone`) or invite code.
- Chat is immutable; no delete surface to abuse.
- Phone is for matching only — never an auth factor (no OTP).
