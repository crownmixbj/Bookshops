-- ============================================================
-- LOCI-BOOK — admin user directory
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- WHY THIS EXISTS
--
-- public.profiles has no email column. Addresses live in auth.users,
-- which PostgREST does not expose and RLS cannot reach — so the admin
-- console could show a user's name and phone but not the address they
-- actually sign in with. You cannot run a marketplace that way: support
-- requests arrive by email, and matching one to an account needs the
-- address.
--
-- WHAT IT EXPOSES, AND THE CARE THAT NEEDS
--
-- This is the only place in the app where auth.users is readable, and
-- reading it means reading everyone's email. So:
--
--   * is_admin() is checked FIRST and the function raises otherwise.
--     A SECURITY DEFINER function without that check would hand the
--     whole directory to any signed-in user who guessed the name.
--   * It returns id, email, confirmation and last-sign-in only. Not
--     encrypted_password, not the recovery tokens, not raw_app_meta_data
--     — none of which an admin screen has any use for.
--   * EXECUTE is granted to authenticated (so the gate above is what
--     actually decides), and revoked from public.
--
-- If you ever want an admin who can moderate but NOT see addresses,
-- that is a second function with the email column dropped, not a flag
-- on this one.
-- ============================================================

create or replace function public.admin_user_directory()
returns table (
  id                 uuid,
  email              text,
  email_confirmed_at timestamptz,
  last_sign_in_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrators only.' using errcode = '42501';
  end if;

  return query
  select u.id, u.email::text, u.email_confirmed_at, u.last_sign_in_at
  from auth.users u;
end;
$$;

revoke all on function public.admin_user_directory() from public;
grant execute on function public.admin_user_directory() to authenticated;

comment on function public.admin_user_directory() is
  'Admin-only view of auth.users: id, email, confirmation and last sign-in. The is_admin() check is the access control — do not remove it.';

notify pgrst, 'reload schema';

-- ---------- check ------------------------------------------------------
-- As an admin this returns a row per account. Signed in as a buyer or a
-- vendor it should raise "Administrators only.":
--
--   select * from public.admin_user_directory();
