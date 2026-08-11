-- Migration: add upi_ids (text[]) to profiles so a user can store multiple VPAs
-- and pick one primary. Run in the Supabase SQL Editor. Safe to re-run.
--
-- upi_id stays the PRIMARY VPA that co-members pay to (unchanged meaning). The new
-- upi_ids array holds all of the user's VPAs; the client keeps upi_id as one of them
-- (or null when the list is empty). Readable by co-members via the existing
-- profiles_select policy; writable only by the owner (profiles_update: id = auth.uid()).

alter table public.profiles add column if not exists upi_ids text[] not null default '{}';

-- Backfill: seed the list from any existing single upi_id so nothing is lost.
update public.profiles
   set upi_ids = array[upi_id]
 where upi_id is not null
   and (upi_ids is null or cardinality(upi_ids) = 0);
