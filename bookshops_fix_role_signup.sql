-- Bookshops — allow vendor self-signup, keep admin locked.
--
-- Why: app/auth/signup.js offers a Buyer / Vendor picker and sends the
-- choice in user metadata, but the handle_new_user trigger written during
-- the RLS remediation ignored it and forced every account to 'buyer'.
-- Picking "Vendor" therefore did nothing — silently.
--
-- The original reason for ignoring metadata still stands for ONE value:
-- raw_user_meta_data is written by the client, so a crafted signup could
-- ask for 'admin'. Buyer and vendor are safe to self-select (a vendor is
-- gated by approval before trading); admin is not, ever.
--
-- Safe to run on the live project: it replaces one function, touches no
-- rows, and existing profiles are unaffected.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested text := new.raw_user_meta_data ->> 'role';
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), ''),
    case
      when requested in ('buyer', 'vendor') then requested::public.user_role
      else 'buyer'::public.user_role      -- includes a spoofed 'admin'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Your existing account signed up before this fix and is a buyer. If you
-- want it to be a vendor for testing, set it explicitly here — the
-- profiles_update_own policy deliberately blocks the app from doing this:
--
--   update public.profiles
--      set role = 'vendor'
--    where id = '29d5a95a-96ae-48b9-b1c4-eb1c3ff93886';
