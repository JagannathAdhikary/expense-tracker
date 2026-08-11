-- Migration: "Split with friends" — direct (group-less) splits. When you split an
-- expense with friends who aren't in a group, we store it in a hidden container group
-- flagged is_direct=true. These are excluded from the Groups list + main page and shown
-- in a separate "Shared splits" section, but reuse all group machinery (splits,
-- settlements, netting, simplify). Run in the Supabase SQL Editor. Re-runnable.

alter table public.groups
  add column if not exists is_direct boolean not null default false;
