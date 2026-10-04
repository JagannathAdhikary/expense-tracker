# Specification — Expense Tracker

> **The "what" and "why."** This document defines the problem, the users, and the
> requirements. It is deliberately implementation-free: _how_ we build it lives in
> [`design.md`](./design.md); _in what order_ lives in [`plan.md`](./plan.md).

---

## 1. Problem statement

People track personal spending in scattered places (notes apps, bank SMS, memory) and
split group expenses over chat threads that devolve into "who owes whom" confusion.
Existing apps are either heavyweight, account-gated from the first screen, or built for
Western payment rails rather than Indian UPI.

We want **one lightweight app** that:

- works **instantly and offline** for personal expense tracking, with no login required;
- optionally layers on **cloud group-splitting** (Splitwise-style) when a user signs in;
- settles group debts over **UPI/BHIM** — the payment rail people in India actually use;
- stays small, fast, and installable as a **PWA** on any phone.

## 2. Goals & non-goals

### Goals
- Zero-friction personal tracking: open the app → add an expense → see the month total.
- Accurate, auditable group splitting (equal / by amount / by percent / by shares).
- Make settling up trivial: show live net balances and launch a prefilled UPI payment.
- Reduce the number of repayments between members via **debt simplification**.
- Keep group members in sync in **real time** (expenses, settlements, chat).
- Rich, honest **analytics** without shipping a heavy chart library.

### Non-goals (v1)
- No in-app money movement or payment processing — we hand off to UPI apps; we do not
  confirm that a transfer succeeded.
- No OTP / phone-number verification (phone is used for matching only, never auth).
- No multi-currency — the app is **INR (₹)** only.
- No editing or deleting of chat messages (messages are immutable in v1).
- No web-only "directory" of users — a person is found only by an **exact** phone match
  or by an invite code they were given.

## 3. Users & personas

| Persona | Needs |
|---|---|
| **Solo tracker** | Add/categorize expenses fast, offline, no account. See where money goes. |
| **Trip/flat organizer** | Create a group, add expenses paid by anyone, split fairly, see who owes what. |
| **Group member** | Get notified of new expenses, know their share, pay it back over UPI in a tap. |
| **Two friends** | Split a one-off cost without ceremony (a "direct split", no visible group). |

## 4. User stories

### Personal (no account)
- As a solo tracker, I can **add an expense** with amount, category, payment method,
  description, and date — and it is saved locally and works offline.
- I can **edit or delete** any expense.
- I can see a **month summary** and a date-grouped **recent list**.
- I can **filter/search** by category, payment method, scope, or free text.
- I can **import/export CSV** so my data is portable and restorable.
- I can view **analytics** — trends, category and payment breakdowns, weekday patterns —
  over a selectable period (This month / 3M / 6M / 12M / All).

### Groups (signed in)
- As an organizer, I can **create a group** with a name and a cover, and invite members
  by **invite code**, by **friend name**, or by **exact phone number**.
- I can **add a group expense** paid by any member and choose a **split mode** (equal,
  by amount, by percent, by shares).
- As a member, I can see **my net balance** in each group and the **per-member breakdown**
  of who owes whom.
- I can **mark my share done** and **settle up** — launching a prefilled **UPI payment**
  to the person I owe.
- I benefit from **debt simplification**: the app nets everyone's balances so the group
  settles in the fewest possible transfers.
- Two friends can do a **direct split** without creating a named, visible group.
- I can **chat** with the group in real time, see who is present, and get a **push
  notification** when something happens while I'm away.
- I get **real-time updates** — a new expense or settlement by anyone appears without a
  manual refresh.

### Cross-cutting
- As any signed-in user, I can set my **display name, phone, and UPI IDs** in a profile.
- I can optionally enable **cloud sync** of my personal expenses across devices.
- I can **install** the app to my home screen and launch it full-screen, offline.

## 5. Functional requirements

1. **Local-first personal store.** Personal expenses persist to `localStorage`; the app
   is fully usable with no network and no account.
2. **Expense model.** An expense has: amount, category, payment method, description, date.
3. **Categories & payment methods.** Ship sensible defaults; let users add custom ones
   with a color/emoji.
4. **Split math is exact.** Splits are computed in integer paise so totals always
   reconcile to the expense amount (no rounding drift).
5. **Live balances.** Group debts are **not stored**; they are derived at read time by
   netting pending splits. Only real repayments (settlements) are persisted.
6. **Debt simplification** is a per-group toggle; when on, net balances are reduced to the
   minimum set of transfers.
7. **UPI settlement.** The app builds a valid `upi://pay` deep link (payee VPA, name, INR
   amount, note) to hand off to any UPI app. It does not verify completion.
8. **Real-time group sync** for expenses, splits, settlements, membership, and chat.
9. **Chat** is per-group, text-only, immutable, with presence and unread tracking.
10. **Push notifications** for group activity (new expense, settlement, membership, etc.),
    gated so a present/active user isn't spammed.
11. **Analytics** are period-scoped and exclude amounts a user merely _owes_ (pending
    shares) from their _spend_.
12. **CSV import is idempotent** — re-importing the same file (matched by id) restores
    rather than duplicates.
13. **Auth** is Google sign-in; signed-out users get full personal features.
14. **Member discovery is privacy-safe** — only exact phone match or invite code; no
    enumeration.

## 6. Non-functional requirements

- **Performance:** instant cold start; no blocking network on launch.
- **Offline / PWA:** installable, standalone display, service-worker precache.
- **Security:** every cloud table protected by Row-Level Security; the client only ever
  holds the Supabase **anon** key; privileged actions run in Edge Functions.
- **Privacy:** no user directory; phone used for matching, not identity proof.
- **Portability:** data exportable/importable as CSV.
- **Testability:** all business logic (split, netting, analytics, CSV, UPI, phone,
  search, friends) lives in pure, DOM-free modules with unit tests.
- **No heavy dependencies:** a single runtime dependency (`@supabase/supabase-js`);
  charts hand-rolled in SVG/CSS.
- **Market fit:** INR formatting (`en-IN`), Indian mobile number handling, UPI.

## 7. Constraints & assumptions

- Single currency: **INR**.
- Target platform: modern mobile browsers (PWA); desktop supported but mobile-first.
- Cloud is **optional** — the app degrades gracefully to local-only when Supabase env
  vars are absent (`cloudEnabled() === false`).
- Chat messages are 1–2000 chars and immutable in v1.

## 8. Acceptance criteria (high level)

- A new user can add and see a personal expense **without logging in**, offline.
- Split totals **always equal** the original expense amount to the paise.
- A group's displayed balances match the sum of pending splits minus settlements.
- "Settle up" opens a UPI app prefilled with the correct payee and amount.
- A second signed-in member sees a new expense **without refreshing**.
- Analytics "This month" total equals the home-screen month total.
- Re-importing an exported CSV produces **no duplicates**.
- The full logic suite (**9 test files, ~106 cases**) passes on `npm test`.
