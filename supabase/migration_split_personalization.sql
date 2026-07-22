-- Migration: per-user personalization of group expenses.
-- Adds category/payment/note columns to expense_splits so a member can label
-- their own share (does not affect other members). Run in the Supabase SQL editor.
-- Safe to re-run. (Also included in schema.sql.)

alter table public.expense_splits add column if not exists cat text;
alter table public.expense_splits add column if not exists pay text;
alter table public.expense_splits add column if not exists note text;

-- Payment method on the group expense itself (payer's chosen method).
alter table public.group_expenses add column if not exists pay text;

-- Allow the payer to delete their expense's splits (needed to re-split on edit).
drop policy if exists splits_delete on public.expense_splits;
create policy splits_delete on public.expense_splits
  for delete using (
    exists (
      select 1 from public.group_expenses ge
      where ge.id = expense_splits.expense_id and ge.payer_id = auth.uid()
    )
  );

-- Allow the group creator/owner to delete the whole group (cascades to members,
-- expenses, and splits via ON DELETE CASCADE foreign keys).
drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups
  for delete using (created_by = auth.uid());

-- Group icon + color (emoji + hex tile), editable by any member.
alter table public.groups add column if not exists icon text;
alter table public.groups add column if not exists color text;
drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups
  for update using (public.is_group_member(id) or created_by = auth.uid());
