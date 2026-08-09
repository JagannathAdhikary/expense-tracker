-- Migration: add phone to profiles (mobile number, format-validated only — not
-- OTP-verified). Run in the Supabase SQL Editor. Safe to re-run.

alter table public.profiles add column if not exists phone text;
