-- Migration: group retiring (archive).
-- Adds a nullable retired_at timestamp to groups. Null = active; a timestamp
-- means the group is retired (read-only: no new expenses, no settling), and
-- records when it happened. Run this in the Supabase SQL Editor if you set up
-- the project BEFORE retiring was added. Safe to re-run. (Also in schema.sql.)

alter table public.groups add column if not exists retired_at timestamptz;
