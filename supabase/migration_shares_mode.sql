-- Migration: add the 'shares' (ratio) split mode. A member's cut is
-- weight / sum(weights) × total (e.g. A=2, B=3 of 500 → 200 / 300). Run in the
-- Supabase SQL Editor. Re-runnable.
--
-- group_expenses.split_mode has a CHECK constraint; widen it to allow 'shares'.
do $$
begin
  alter table public.group_expenses drop constraint if exists group_expenses_split_mode_check;
  alter table public.group_expenses
    add constraint group_expenses_split_mode_check check (split_mode in ('equal','amount','percent','shares'));
end $$;
