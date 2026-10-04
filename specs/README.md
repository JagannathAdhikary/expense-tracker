# Specs — Spec-Driven Development

This folder documents **Expense Tracker** the way it would have been built under
spec-driven development: define the requirements, derive a design, sequence a plan — then
implement against them. The three documents answer three different questions and should be
read in order.

| Doc | Question it answers | Contains |
|---|---|---|
| [`spec.md`](./spec.md) | **What & why** | Problem, users, user stories, functional (`FR-#`) + non-functional requirements, scope, acceptance criteria. Implementation-free. |
| [`design.md`](./design.md) | **How** | Architecture, module patterns, data model + RLS, key algorithms (paise-exact splits, debt netting/simplification, UPI links, analytics), cloud integration (Realtime, Presence, Edge Functions, Web Push), PWA, testing strategy. |
| [`plan.md`](./plan.md) | **In what order** | Phased build sequence, each mapping back to `FR-#`/`NFR`, with primary files, exit tests, and a dependency graph. |

## How they connect
`spec.md` is the contract. `design.md` is one valid way to satisfy it. `plan.md` turns the
design into shippable phases, each tied to the requirements it closes and the tests that
prove it.

## Snapshot of the implementation these describe
- **Stack:** vanilla JS, Vite, Supabase (Postgres + RLS + Realtime + Presence + Edge
  Functions/Deno), Web Push, Vitest. One runtime dependency; charts hand-rolled in SVG.
- **Shape:** local-first PWA (works signed-out, offline) with optional cloud group
  splitting, UPI settlement, real-time chat, and push notifications.
- **Tests:** 9 pure-logic test files, ~106 cases.
