-- ============================================================================
-- Expense Tracker — group splitting schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: uses "if not exists" / "or replace" and drops policies first.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per authenticated user, mirroring auth.users. Populated by a trigger.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique,           -- short shareable code to join
  created_by  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member',   -- 'owner' | 'member'
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.group_expenses (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  payer_id    uuid not null references public.profiles(id) on delete cascade,
  amount      numeric(12,2) not null check (amount > 0),
  description text,
  category    text,
  spent_on    date not null default current_date,
  split_mode  text not null default 'equal' check (split_mode in ('equal','amount','percent')),
  created_at  timestamptz not null default now()
);

create table if not exists public.expense_splits (
  id           uuid primary key default gen_random_uuid(),
  expense_id   uuid not null references public.group_expenses(id) on delete cascade,
  debtor_id    uuid not null references public.profiles(id) on delete cascade,
  share_amount numeric(12,2) not null check (share_amount >= 0),
  status       text not null default 'pending' check (status in ('pending','done')),
  settled_at   timestamptz,
  unique (expense_id, debtor_id)
);

create index if not exists idx_group_members_user on public.group_members(user_id);
create index if not exists idx_group_expenses_group on public.group_expenses(group_id);
create index if not exists idx_expense_splits_debtor on public.expense_splits(debtor_id);
create index if not exists idx_expense_splits_expense on public.expense_splits(expense_id);

-- ---------------------------------------------------------------------------
-- Membership helper (SECURITY DEFINER avoids RLS recursion on group_members)
-- ---------------------------------------------------------------------------
create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Auto-create a profile row when a new auth user signs up
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.groups         enable row level security;
alter table public.group_members  enable row level security;
alter table public.group_expenses enable row level security;
alter table public.expense_splits enable row level security;

-- profiles ------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (
    id = auth.uid()
    -- co-members can see each other (needed to render names/avatars in a group)
    or exists (
      select 1 from public.group_members gm1
      join public.group_members gm2 on gm1.group_id = gm2.group_id
      where gm1.user_id = auth.uid() and gm2.user_id = profiles.id
    )
  );

drop policy if exists profiles_upsert on public.profiles;
create policy profiles_upsert on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid());

-- groups --------------------------------------------------------------------
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups
  for select using (public.is_group_member(id) or created_by = auth.uid());

drop policy if exists groups_insert on public.groups;
create policy groups_insert on public.groups
  for insert with check (created_by = auth.uid());

drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups
  for update using (created_by = auth.uid());

-- Allow looking up a group by invite code in order to join (read the row to get its id).
drop policy if exists groups_select_by_code on public.groups;
create policy groups_select_by_code on public.groups
  for select using (true);
-- NOTE: the above makes group rows discoverable; invite_code is a secret handle.
-- If you prefer stricter behavior, remove groups_select_by_code and use an RPC to join.

-- group_members -------------------------------------------------------------
drop policy if exists members_select on public.group_members;
create policy members_select on public.group_members
  for select using (public.is_group_member(group_id));

-- A user may add THEMSELVES to a group (join by code); owner adds self on create.
drop policy if exists members_insert_self on public.group_members;
create policy members_insert_self on public.group_members
  for insert with check (user_id = auth.uid());

drop policy if exists members_delete_self on public.group_members;
create policy members_delete_self on public.group_members
  for delete using (user_id = auth.uid());

-- group_expenses ------------------------------------------------------------
drop policy if exists expenses_select on public.group_expenses;
create policy expenses_select on public.group_expenses
  for select using (public.is_group_member(group_id));

-- Only a member acting as the payer may create the expense.
drop policy if exists expenses_insert on public.group_expenses;
create policy expenses_insert on public.group_expenses
  for insert with check (payer_id = auth.uid() and public.is_group_member(group_id));

drop policy if exists expenses_update on public.group_expenses;
create policy expenses_update on public.group_expenses
  for update using (payer_id = auth.uid());

drop policy if exists expenses_delete on public.group_expenses;
create policy expenses_delete on public.group_expenses
  for delete using (payer_id = auth.uid());

-- expense_splits ------------------------------------------------------------
drop policy if exists splits_select on public.expense_splits;
create policy splits_select on public.expense_splits
  for select using (
    exists (
      select 1 from public.group_expenses ge
      where ge.id = expense_splits.expense_id and public.is_group_member(ge.group_id)
    )
  );

-- The payer creates all split rows when recording the expense.
drop policy if exists splits_insert on public.expense_splits;
create policy splits_insert on public.expense_splits
  for insert with check (
    exists (
      select 1 from public.group_expenses ge
      where ge.id = expense_splits.expense_id and ge.payer_id = auth.uid()
    )
  );

-- A debtor may update THEIR OWN split (mark done); the payer may update any split in
-- their expense (e.g. corrections). Neither can touch other members' shares otherwise.
drop policy if exists splits_update on public.expense_splits;
create policy splits_update on public.expense_splits
  for update using (
    debtor_id = auth.uid()
    or exists (
      select 1 from public.group_expenses ge
      where ge.id = expense_splits.expense_id and ge.payer_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Realtime: broadcast changes so members see settlements live
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.group_expenses;
alter publication supabase_realtime add table public.expense_splits;
