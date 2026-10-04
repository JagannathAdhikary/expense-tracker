# Implementation Plan — Expense Tracker

> **The "in what order."** This plan sequences [`spec.md`](./spec.md) into buildable
> phases, each independently shippable and testable. _How_ each piece works is in
> [`design.md`](./design.md).

Each phase lists the requirements it satisfies (`FR-#` / `NFR`), the primary files, and an
exit test. The ordering front-loads a usable local-only app, then layers cloud, then
polish — so there is always a working product.

---

## Phase 0 — Project scaffold & conventions
**Satisfies:** NFR (performance, no heavy deps), build/PWA baseline.

- Vite project, ES modules, base path `/expense-tracker/`, `__APP_VERSION__` define.
- Establish the module pattern: `dom.js` (`$`), `state.js` (singleton), `storage.js`,
  the `init<X>()` / `render<X>()` view contract, `nav.js` stack.
- `index.html` shell with hidden screen/modal nodes.
- Vitest wired (`npm test`).

**Files:** `vite.config.js`, `index.html`, `src/{dom,state,storage,nav,constants}.js`.
**Exit:** `npm run dev` serves a blank-but-navigable shell; `npm test` runs (empty ok).

---

## Phase 1 — Personal expense tracking (local-first, no account)
**Satisfies:** FR-1, FR-2, FR-3, FR-12 (export), NFR offline.

- Expense model + `localStorage` persistence (`storage.js`).
- Add/edit/delete screen with category + payment chips (`views/addEdit.js`).
- Home: month summary + date-grouped recent list (`views/home.js`, `views/list.js`).
- Default + custom categories & payment methods (`features/categories.js`,
  `features/payments.js`, `constants.js`).
- Formatting helpers (`format.js`): `fmt` (₹ en-IN), `isoDay`, `friendlyDate`.

**Exit:** add → see it in the list and month total; reload persists; works offline.
**Tests:** `format` behavior exercised indirectly; list/day totals exclude pending.

---

## Phase 2 — Filtering, search & CSV
**Satisfies:** FR-11 scoping inputs, FR-12 (idempotent import).

- Filter bar: scope (all/personal/group), categories, payments, free text
  (`features/filter.js`, `format.applyFilter`).
- CSV pure helpers (`csv.js`): `toCsv`, `templateCsv`, `parseCsv`, `headerMap`,
  `buildRecordFromRow`, `reportCsv`. Fixed header `id,date,amount,category,payment,description`.
- Backup UI (`features/backup.js`).

**Exit:** export a file, re-import it → **no duplicates** (matched by id); search filters live.
**Tests:** `csv.test.js` (22), `search.test.js` (6).

---

## Phase 3 — Analytics
**Satisfies:** FR-11, NFR (no chart lib).

- Pure period aggregations (`analytics.js`): `rangeStats`, `monthlySeries`,
  `categoryTotals`, `paymentTotals`, `weekdayBuckets`, `dailyBuckets`, `monthTotal`.
- Period toggle (Month / 3M / 6M / 12M / All) + hand-rolled inline-SVG charts
  (`views/analytics.js`, `views/category.js`).
- **Pending owed excluded from spend.**

**Exit:** every chart rescopes on toggle; "This month" total == home month total.
**Tests:** `analytics.test.js` (24).

---

## Phase 4 — Auth, profile & cloud client
**Satisfies:** FR-13, FR-14 (profile), NFR security (anon key, graceful gating).

- Supabase client singleton from env; `cloudEnabled()` → `null` when absent (`supabase.js`).
- Google sign-in (`features/auth.js`); signed-out users keep all personal features.
- `profiles` table + `handle_new_user()` trigger; profile editor for name/phone/UPI IDs
  (`features/profile.js`); onboarding wizard (`features/onboarding.js`).
- Phone helpers (`phone.js`), UPI helpers (`upi.js`).

**Exit:** sign in → profile row exists; app still fully works signed out / without env.
**Tests:** `phone.test.js` (7), `upi.test.js` (18).

---

## Phase 5 — Groups & splitting
**Satisfies:** FR-4 (exact split), FR-5 (live balances), FR-6 (simplification),
FR-14 (discovery).

- Schema: `groups`, `group_members`, `group_expenses`, `expense_splits`, `settlements`
  + **RLS policies** and `is_group_member()`, `find_user_by_phone()`.
- Split math in paise (`split.js`): `computeSplits` (equal/amount/percent/shares),
  `netBetween`, `groupNetsPaise`, `simplifyTransfers`, `simplifiedForUser`.
- Group create/join (invite code, friend, exact phone), cover/icon editor
  (`features/groups.js`, `views/newGroup.js`, `views/groups.js`).
- Group expense add via `computeSplits`; shared rows surfaced in the list (`cloudrows.js`).
- **Direct split** container for two friends (`is_direct`).

**Exit:** split totals reconcile to the paise; group balances == pending splits − settlements;
simplification yields minimal transfers.
**Tests:** `split.test.js` (9), `netting.test.js` (11), `simplify.test.js` (4),
`friends.test.js` (5).

---

## Phase 6 — Settlement over UPI
**Satisfies:** FR-5 (settlements), FR-7.

- `settlements` table (manual/simplified); settle-up flows
  (`settleUpWithMember`, `settleAllMyDebts` in `views/groups.js`).
- Payment-method picker (`confirm.js` `pickSettlePayment`); UPI deep link (`upi.js`).
- "Mark my share done" on `expense_splits`.

**Exit:** "Settle up" launches a prefilled `upi://pay`; recording a settlement updates
live balances everywhere.

---

## Phase 7 — Real-time sync & chat
**Satisfies:** FR-8, FR-9.

- Realtime: one `group-changes` channel on all group tables → debounced reload
  (`features/groups.js`).
- `group_messages` (immutable) + chat tab, unread tracking (`state.chatUnread`),
  presence channels `chat-presence-<gid>`.

**Exit:** a second member sees new expenses/messages without refresh; chat shows presence
and unread counts.

---

## Phase 8 — Push notifications
**Satisfies:** FR-10, NFR security.

- `push_subscriptions` table; subscribe on login + menu toggle (`features/push.js`).
- Service-worker `push` / `notificationclick` with deep-links (`sw.js`).
- Edge Functions: `notify-expense`, `notify-group` (`verify_jwt`), `notify-broadcast`
  (`--no-verify-jwt`, `BROADCAST_SECRET`). **Presence-gated** so active users aren't spammed.

**Exit:** adding an expense pushes "you owe ₹Z" to absent members; tapping deep-links in.

---

## Phase 9 — Optional personal cloud sync
**Satisfies:** cross-device personal sync.

- `personal_expenses` mirror (PK `(user_id, id)`), two-way **last-write-wins** via
  `updated_at`, soft-delete **tombstones** (`features/sync.js`).

**Exit:** toggling sync replicates personal expenses across devices; deletes propagate.

---

## Phase 10 — PWA polish & onboarding
**Satisfies:** NFR offline/installable; UX.

- `vite-plugin-pwa` injectManifest, manifest, icons; precache + autoupdate.
- "What's new" version-gated carousel (`features/whatsnew.js`, `version.js`),
  coach-marks (`coachmark.js`), toasts (`toast.js`), confirm modal (`confirm.js`).

**Exit:** installs to home screen, launches standalone/offline; first-run tutorial shows.

---

## Cross-phase: definition of done
- Pure logic has unit tests; `npm test` green (**9 files, ~106 cases**).
- `npm run build` clean; service worker precaches.
- No secrets in the client; every cloud table has RLS; privileged work is server-side.
- The app remains fully usable **signed out and offline**.

## Dependency graph (summary)
```
0 ─▶ 1 ─▶ 2
     └──▶ 3
     └──▶ 4 ─▶ 5 ─▶ 6
               └──▶ 7 ─▶ 8
               └──▶ 9
0 ─▶ 10 (polish, after a usable core)
```
Phases 1–3 ship a complete local-only app. Phases 4–9 add cloud group features. Phase 10
is continuous polish once a usable core exists.
