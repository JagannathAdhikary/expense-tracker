-- Migration: allow any existing group member to add others (add-by-friend), in
-- addition to self-join. Run in the Supabase SQL Editor. Safe to re-run.

drop policy if exists members_insert_self on public.group_members;
drop policy if exists members_insert on public.group_members;
create policy members_insert on public.group_members
  for insert with check (user_id = auth.uid() or public.is_group_member(group_id));
