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
  sync_enabled boolean not null default false,   -- server-authoritative personal-sync switch
  upi_id       text,                              -- PRIMARY VPA (name@provider) co-members pay to
  upi_ids      text[] not null default '{}',      -- all the user's VPAs; upi_id is one of these
  phone        text,                              -- mobile number (format-validated only; not OTP-verified)
  created_at   timestamptz not null default now()
);
-- For projects created before these columns were added:
alter table public.profiles add column if not exists sync_enabled boolean not null default false;
alter table public.profiles add column if not exists upi_id text;
alter table public.profiles add column if not exists upi_ids text[] not null default '{}';
alter table public.profiles add column if not exists phone text;

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique,           -- short shareable code to join
  icon        text,                            -- emoji shown as the group's icon
  color       text,                            -- hex tile background for the icon
  retired_at  timestamptz,                     -- when the group was retired (null = active)
  created_by  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);
-- For projects created before group icon/color were added:
alter table public.groups add column if not exists icon text;
alter table public.groups add column if not exists color text;
-- For projects created before group retiring (archive) was added:
alter table public.groups add column if not exists retired_at timestamptz;
-- For projects created before group photos were added (URL of an uploaded image):
alter table public.groups add column if not exists photo_url text;

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
  pay         text,
  spent_on    date not null default current_date,
  split_mode  text not null default 'equal' check (split_mode in ('equal','amount','percent')),
  created_at  timestamptz not null default now()
);
-- For projects created before payment method was added:
alter table public.group_expenses add column if not exists pay text;

create table if not exists public.expense_splits (
  id           uuid primary key default gen_random_uuid(),
  expense_id   uuid not null references public.group_expenses(id) on delete cascade,
  debtor_id    uuid not null references public.profiles(id) on delete cascade,
  share_amount numeric(12,2) not null check (share_amount >= 0),
  status       text not null default 'pending' check (status in ('pending','done')),
  settled_at   timestamptz,
  -- Per-user personalization of a group expense (does not affect other members):
  cat          text,
  pay          text,
  note         text,
  unique (expense_id, debtor_id)
);
-- For projects created before personalization was added:
alter table public.expense_splits add column if not exists cat text;
alter table public.expense_splits add column if not exists pay text;
alter table public.expense_splits add column if not exists note text;

-- Settlement log: records a real "Settle up" payment that discharges the net debt
-- between two members. Debts themselves are NOT stored here — they are computed
-- live by netting pending expense_splits in both directions (see netBetween in
-- src/split.js), so opposing expenses cancel automatically and deleting an expense
-- reverts the net for free. A settlement only records money actually paid back.
-- Direction: `from_user` (who owed) paid `to_user` (who was owed).
create table if not exists public.settlements (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  from_user  uuid not null references public.profiles(id) on delete cascade,
  to_user    uuid not null references public.profiles(id) on delete cascade,
  amount     numeric(12,2) not null check (amount > 0),
  kind       text not null default 'manual' check (kind in ('manual')),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_settlements_group on public.settlements(group_id);

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

-- Find a registered user by EXACT mobile number (last 10 digits), for adding to a
-- group. SECURITY DEFINER so it can read profiles without exposing the whole table
-- to the client — it only ever returns a single exact match, so the directory
-- can't be browsed/enumerated. Returns nothing if no one has that number.
create or replace function public.find_user_by_phone(p_phone text)
returns table(id uuid, display_name text, avatar_url text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.display_name, p.avatar_url
  from public.profiles p
  where p.phone is not null
    and length(regexp_replace(p_phone, '\D', '', 'g')) >= 10
    and right(regexp_replace(p.phone, '\D', '', 'g'), 10) = right(regexp_replace(p_phone, '\D', '', 'g'), 10)
    and p.id <> auth.uid()
  limit 1;
$$;
revoke all on function public.find_user_by_phone(text) from public, anon;
grant execute on function public.find_user_by_phone(text) to authenticated;

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
alter table public.settlements    enable row level security;

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

-- Any member may update the group (e.g. its icon/color). Renaming/other edits
-- are still member-level; deletion remains creator-only.
drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups
  for update using (public.is_group_member(id) or created_by = auth.uid());

-- Only the creator/owner may delete the group (cascades to members/expenses/splits).
drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups
  for delete using (created_by = auth.uid());

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

-- A user may add THEMSELVES (join by code), and any existing member may add
-- others to a group they belong to (add-by-friend). The added user_id must be a
-- real profile (FK enforces that); the search UI only surfaces the adder's friends.
drop policy if exists members_insert_self on public.group_members;
drop policy if exists members_insert on public.group_members;
create policy members_insert on public.group_members
  for insert with check (user_id = auth.uid() or public.is_group_member(group_id));

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

-- The payer may delete their expense's splits (needed when re-splitting on edit).
drop policy if exists splits_delete on public.expense_splits;
create policy splits_delete on public.expense_splits
  for delete using (
    exists (
      select 1 from public.group_expenses ge
      where ge.id = expense_splits.expense_id and ge.payer_id = auth.uid()
    )
  );

-- settlements ---------------------------------------------------------------
drop policy if exists settlements_select on public.settlements;
create policy settlements_select on public.settlements
  for select using (public.is_group_member(group_id));

-- The settling member records their own payment.
drop policy if exists settlements_insert on public.settlements;
create policy settlements_insert on public.settlements
  for insert with check (created_by = auth.uid() and public.is_group_member(group_id));

-- A settlement is deletable only by whoever recorded it (to undo a mistaken settle-up).
drop policy if exists settlements_delete on public.settlements;
create policy settlements_delete on public.settlements
  for delete using (created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- Realtime: broadcast changes so members see settlements live.
-- Guarded so re-applying the schema doesn't error on already-published tables.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['group_expenses','expense_splits','settlements'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ============================================================================
-- Personal expense cloud sync (optional, per-user).
-- Each row mirrors a local record; `id` is the app's numeric record id, unique
-- per user. Soft-deletes via `deleted` so removals propagate across devices;
-- `updated_at` drives last-write-wins merging.
-- ============================================================================
create table if not exists public.personal_expenses (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  id         bigint not null,               -- app record id (Date.now()-based)
  amt        numeric(12,2) not null,
  cat        text,
  pay        text,
  descr      text,
  spent_on   date not null,
  deleted    boolean not null default false,
  updated_at bigint not null,               -- client ms timestamp for LWW
  primary key (user_id, id)
);

alter table public.personal_expenses enable row level security;

drop policy if exists personal_all on public.personal_expenses;
create policy personal_all on public.personal_expenses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- Web Push subscriptions. One row per browser/device a user opted in from. The
-- notify-expense Edge Function reads these with the service_role key (bypasses
-- RLS) to push to a group's other members; users only touch their own rows.
-- ============================================================================
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
