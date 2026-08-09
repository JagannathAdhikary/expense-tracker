-- Migration: groups redesign — group photo + find-user-by-phone RPC.
-- Run in the Supabase SQL Editor. Safe to re-run.

-- 1. Optional uploaded group photo (URL). Icon/color remain as fallback.
alter table public.groups add column if not exists photo_url text;

-- 2. Exact-number user lookup for adding members. SECURITY DEFINER + single exact
-- match means the profiles table can't be browsed/enumerated by the client.
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

-- 3. Storage bucket for group photos (run once; ignore if it already exists).
--    In the Dashboard: Storage -> New bucket -> name "group-icons", Public = ON.
--    Then allow authenticated uploads:
-- insert into storage.buckets (id, name, public) values ('group-icons','group-icons', true)
--   on conflict (id) do nothing;
-- create policy "group-icons auth upload" on storage.objects for insert to authenticated
--   with check (bucket_id = 'group-icons');
-- create policy "group-icons public read" on storage.objects for select to public
--   using (bucket_id = 'group-icons');
