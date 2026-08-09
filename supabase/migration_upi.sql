-- Migration: add upi_id to profiles so co-members can pay you via a UPI deep link.
-- Run in the Supabase SQL Editor. Safe to re-run. (Also in schema.sql.)
--
-- upi_id is an optional VPA like name@okaxis. It's readable by co-members (the
-- existing profiles_select policy already lets group members see each other's
-- profile) and writable only by the owner (profiles_update: id = auth.uid()).

alter table public.profiles add column if not exists upi_id text;
