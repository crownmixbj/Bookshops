-- ============================================================
-- FIX: "infinite recursion detected in policy for relation
--       profiles" when saving your profile.
--
-- Run this in the Supabase SQL editor. Safe to run twice.
--
-- WHAT WENT WRONG (my bug, from bookshops_fixes.sql)
--
-- The policy meant to stop you promoting yourself to admin was
-- written as:
--
--   with check (
--     auth.uid() = id
--     and role = (select p.role from profiles p where p.id = auth.uid())
--   )
--
-- That subquery reads `profiles` from inside a policy ON `profiles`.
-- Postgres evaluates the inner SELECT under RLS, which consults the
-- profiles policies again, which runs the subquery again. Postgres
-- notices the loop and aborts with the error you saw.
--
-- It fires on EVERY update, not just role changes: WITH CHECK is
-- evaluated against the whole resulting row, so editing your name
-- was enough to trigger it.
--
-- Note this is a different failure from a recursive helper function.
-- is_admin() and is_suspended() are SECURITY DEFINER, so they run as
-- the table owner and bypass RLS — they were never the problem, and
-- they are the pattern this fix uses.
--
-- THE FIX
--
-- Keep the guarantee, drop the subquery. A BEFORE UPDATE trigger can
-- see OLD.role directly — no query, so nothing to recurse into. The
-- policy goes back to the simple "this row is mine" test.
--
-- The guarantee is actually STRONGER than before: the old policy
-- rejected the write, so a client could detect the boundary; the
-- trigger silently holds the privileged columns at their old values,
-- and also protects suspended_at, which the old policy did not.
-- ============================================================

-- ---------- 1. the policy, without the self-reference -----------------

drop policy if exists profiles_update_own on public.profiles;

create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check (
    (select auth.uid()) = id
    -- SECURITY DEFINER, so this reads profiles as the owner and does
    -- not re-enter RLS. This is the safe way to consult the same
    -- table from its own policy.
    and not public.is_suspended()
  );

-- ---------- 2. privileged columns, held by trigger --------------------

create or replace function public.profiles_lock_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No JWT: the service key, or a trigger running inside a
  -- SECURITY DEFINER function. That path is already privileged, and
  -- it is how the first admin gets bootstrapped from the SQL editor.
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_admin() then
    -- Held, not rejected. The app sends a patch of the whole row on
    -- save, so raising here would break ordinary edits like changing
    -- your name — which is exactly the bug being fixed. Silently
    -- keeping the old values means an escalation attempt succeeds as
    -- a write and changes nothing.
    new.role             := old.role;
    new.suspended_at     := old.suspended_at;
    new.suspension_reason := old.suspension_reason;
  end if;

  return new;
end;
$$;

revoke all on function public.profiles_lock_privileged_columns() from public;

drop trigger if exists profiles_lock_privileged on public.profiles;

create trigger profiles_lock_privileged
  before update on public.profiles
  for each row
  execute function public.profiles_lock_privileged_columns();

comment on function public.profiles_lock_privileged_columns() is
  'Stops a person changing their own role or lifting their own suspension. Replaces a WITH CHECK subquery on profiles that caused infinite RLS recursion on every profile update.';

notify pgrst, 'reload schema';

-- ---------- 3. check it worked ----------------------------------------
--
-- Should return NO rows. Any row here is a policy that reads the table
-- it protects, which is the shape that recurses:
--
--   select tablename, policyname, cmd
--   from pg_policies
--   where schemaname = 'public'
--     and (coalesce(qual,'') || ' ' || coalesce(with_check,''))
--         ~* ('from\s+(public\.)?' || tablename || '(\s|$)');
--
-- Then edit your name in Settings. It should save.
