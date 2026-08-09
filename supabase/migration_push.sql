-- Migration: Web Push subscriptions table. Run in the Supabase SQL Editor to
-- enable group push notifications. Safe to re-run. (Also in schema.sql.)

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_subs_user on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subs_all on public.push_subscriptions;
create policy push_subs_all on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
