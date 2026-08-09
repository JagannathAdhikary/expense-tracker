# Groups setup (redesign)

After the groups redesign, apply this once so add-by-number and group photos work.

## 1. Database migration
Run `supabase/migration_groups_redesign.sql` in the Supabase **SQL Editor**. It:
- adds `groups.photo_url`,
- creates the `find_user_by_phone(text)` RPC (exact 10-digit match, SECURITY
  DEFINER — it returns at most one user and can't be used to browse the directory).

## 2. Storage bucket for group photos
In the Dashboard → **Storage → New bucket**: name **`group-icons`**, **Public = ON**.
Then add upload/read policies (SQL Editor):
```sql
create policy "group-icons auth upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'group-icons');
create policy "group-icons public read" on storage.objects for select to public
  using (bucket_id = 'group-icons');
```

## What changed in the app
- **Join-by-code UI removed** — people join via the invite **link** (`?join=CODE`,
  still handled) or by being **added**. The code is still shown/shareable.
- **Groups popover** is an anchored dropdown: Active/Retired tabs, the group list,
  and a single **Create group** button.
- **Create group** opens a full-screen page: name, icon (emoji + color, or an
  uploaded **photo**), and add-members search.
- **Add members** by friend name, or by **exact mobile number** (any registered
  user, via the RPC). Not registered → share the invite link.
- Group **photos** render on tiles and the detail header (emoji+color is the
  fallback when no photo).

If the migration/bucket isn't applied: number-search for non-friends returns
nothing and photo upload fails with a toast — the rest works.
