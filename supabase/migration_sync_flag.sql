-- Migration: server-authoritative personal-sync flag.
-- Adds sync_enabled to profiles so the "Sync personal expenses" choice lives on
-- the server (one row per user) instead of only in a device's localStorage.
-- Every device reads this on login and obeys it, so turning sync off on one
-- device turns it off everywhere. Run this in the Supabase SQL Editor if you set
-- up the project before this was added. Safe to re-run. (Also in schema.sql.)

alter table public.profiles add column if not exists sync_enabled boolean not null default false;
