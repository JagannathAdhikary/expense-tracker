-- Migration: "Simplify group debts" — per-user preference that re-routes a member's
-- own balances into fewer repayments (view + settle routing only; no split rewrite).
-- Run in the Supabase SQL Editor. Safe to re-run.

-- 1) Per-user, per-group toggle. Lives on the membership row so it syncs across the
--    user's devices and only affects that user's own view.
alter table public.group_members
  add column if not exists simplify_debts boolean not null default false;

-- 2) Allow settlements created by a re-routed (simplified) payment to be tagged, so
--    they're distinguishable from normal manual settle-ups. The settlements table is
--    created with `check (kind in ('manual'))`; widen it. Constraint names are the
--    Postgres default `<table>_<col>_check`.
do $$
begin
  alter table public.settlements drop constraint if exists settlements_kind_check;
  alter table public.settlements
    add constraint settlements_kind_check check (kind in ('manual','simplified'));
end $$;
