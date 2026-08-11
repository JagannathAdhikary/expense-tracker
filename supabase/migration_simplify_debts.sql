-- Migration: "Simplify group debts" — a GROUP-WIDE toggle that minimizes the number
-- of repayments needed to settle the group (Splitwise-style). Everyone in the group
-- sees the same simplified set of payments. Run in the Supabase SQL Editor. Re-runnable.

-- 1) Group-wide toggle (lives on the group so all members share one consistent view).
alter table public.groups
  add column if not exists simplify_debts boolean not null default false;

-- 2) Allow settlements created by a re-routed (simplified) payment to be tagged.
--    The settlements table is created with `check (kind in ('manual'))`; widen it.
do $$
begin
  alter table public.settlements drop constraint if exists settlements_kind_check;
  alter table public.settlements
    add constraint settlements_kind_check check (kind in ('manual','simplified'));
end $$;

-- 3) Clean up the earlier PER-USER attempt, if it was applied: the flag + policy are
--    no longer used now that the setting is group-wide. groups_update already lets any
--    member update the group, so no new members policy is needed. Safe if absent.
drop policy if exists members_update_self on public.group_members;
alter table public.group_members drop column if exists simplify_debts;

-- 4) Broadcast groups + group_members changes over realtime so a toggle (and member
--    add/remove/retire) reflects on other members' screens live, not just on refresh.
do $$
declare t text;
begin
  foreach t in array array['groups','group_members'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

