# CLAUDE.md

Working guide for Claude Code in this repo. Describes **how to work here**, not what the
product is — architecture, data model, and requirements live in [`specs/`](./specs/).
Setup/env is in [`SETUP.md`](./SETUP.md).

## Commands

```bash
npm run dev        # Vite dev server
npm test           # Vitest (run mode) — 9 pure-logic suites
npm run build      # production build (vite-plugin-pwa injectManifest)
npm run preview    # serve the build
```

Run `npm test` and `npm run build` before considering any change done.

## What this is

Framework-free **vanilla-JS PWA** (Vite). One runtime dependency: `@supabase/supabase-js`.
**Local-first** — personal tracking works signed-out and offline from `localStorage`;
Supabase (Postgres + RLS + Realtime + Presence + Edge Functions + Web Push) is **optional**
and only engages when signed in. Charts are hand-rolled SVG/CSS — no chart library.

## Module contract (follow it — the codebase is consistent)

- **`$` = `document.getElementById`** (`src/dom.js`) — the one DOM accessor.
- Each view/feature exports **`init<X>()`** (one-time event wiring, called once at boot
  from `main.js`) + **`render<X>()` / `show<X>()`** (idempotent, state-driven). Views write
  `innerHTML` into fixed nodes in `index.html`.
- **`src/state.js` is a single mutable singleton** — mutate in place
  (`state.recs.push(...)`), never reassign the import binding.
- Navigation is a screen stack (`nav.js`); `views/nav-render.js` re-renders after
  `navBack()` using **lazy dynamic imports** to break circular deps.
- Anything touching Supabase first checks **`cloudEnabled()`** (returns `null` client when
  env vars are absent) — the app must stay fully usable without it.
- **Pure logic is DOM-free and unit-tested** (`split`, `netting`, `analytics`, `csv`, `upi`,
  `phone`, `search`, `friends`, `simplify`). New business logic goes in a pure module with a
  test — not inline in a view.

## Do not touch (unless the task is explicitly about it)

- **`src/upi.js` / BHIM deep-link logic** — settlement links are load-bearing.
- **Split / settlement / netting math** (`split.js`) — exact integer-paise; changes must
  keep totals reconciling and the suites green.
- **CSV import/export** (`csv.js`) — import is idempotent by `id`; don't break round-trip.
- **User category colors** (`state.CATS` `{n,e,c}`) — this is user data shown on every row;
  never repaint it. (See the dataviz note in `specs/` on why the donut/bars are legal only
  with the legend + labels + gaps already present.)
- **Debts are derived, not stored** — computed live by netting pending `expense_splits`
  minus `settlements`. Don't add a stored-balance table.

## Security

- The browser holds only the Supabase **anon** key. Never paste a service-role key or any
  secret into chat, a commit, or `CLAUDE.md`.
- Privileged push fan-out runs in **Edge Functions**. `notify-broadcast` is service-role /
  `BROADCAST_SECRET`-gated and **never client-callable** — don't wire it to the client.
- Member discovery is exact-phone-match or invite code only — no enumeration/directory.

## PR workflow

Branch → commit → push → open & merge via the **`gh` CLI**:

```bash
gh pr create --fill
gh pr merge --squash --delete-branch
```

The GitHub MCP `create_pull_request` returns 403 on this token (missing PR-write scope) —
use the CLI. Commit/push only when asked.

## More

- Product spec, design, and build plan → [`specs/`](./specs/)
- Environment & Supabase setup → [`SETUP.md`](./SETUP.md)
