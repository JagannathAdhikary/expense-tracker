-- Migration: personal expense cloud sync table.
-- Run this in the Supabase SQL Editor if you set up the project BEFORE cloud sync
-- was added. Safe to re-run. (It is also included in schema.sql.)

create table if not exists public.personal_expenses (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  id         bigint not null,               -- app record id (Date.now()-based)
  amt        numeric(12,2) not null,
  cat        text,
  pay        text,
  descr      text,
  spent_on   date not null,
  deleted    boolean not null default false,
  updated_at bigint not null,               -- client ms timestamp for last-write-wins
  primary key (user_id, id)
);

alter table public.personal_expenses enable row level security;

drop policy if exists personal_all on public.personal_expenses;
create policy personal_all on public.personal_expenses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
