-- Bookshops — account settings: default delivery address, notification
-- preferences, and app preferences.
--
-- All of these hang off `profiles` rather than new tables: there is one
-- of each per person, they are read together on one screen, and
-- `profiles_update_own` already lets someone edit their own row. A
-- separate table would add joins and policies for no benefit.
--
-- Safe to run: adds nullable columns and columns with defaults. No
-- existing rows change meaning.

begin;

-- ============================================================
-- 1. Default delivery address
-- ============================================================
-- Orders capture their own delivery address on purpose, so editing this
-- later never rewrites where past orders actually went. These fields are
-- only the default that checkout prefills from.
alter table public.profiles
  add column if not exists default_delivery_address text,
  add column if not exists default_delivery_city    text,
  add column if not exists default_delivery_phone   text;

comment on column public.profiles.default_delivery_address is
  'Prefills checkout only. orders.delivery_address is the record of where an order actually went — never read this for historical orders.';

-- ============================================================
-- 2. Notification preferences
-- ============================================================
-- Granular per channel and per event, which is what makes them useful:
-- most people want an email when an order ships but not when a fourth
-- vendor quotes a booklist.
alter table public.profiles
  add column if not exists notify_email_orders boolean not null default true,
  add column if not exists notify_email_quotes boolean not null default true,
  add column if not exists notify_push_orders  boolean not null default true,
  add column if not exists notify_push_quotes  boolean not null default false,
  add column if not exists notify_sms_orders   boolean not null default false,
  add column if not exists notify_sms_quotes   boolean not null default false;

comment on column public.profiles.notify_email_orders is
  'Read by whatever sends notifications. NOTHING SENDS ANY YET — these columns record intent so the preference survives until a notification service exists.';

-- SMS defaults to off deliberately: it costs money per message and
-- needs a verified phone number, so it should be opted into.

-- ============================================================
-- 3. App preferences
-- ============================================================
alter table public.profiles
  add column if not exists theme_preference text not null default 'system'
    check (theme_preference in ('light', 'dark', 'system')),
  add column if not exists preferred_currency text not null default 'NGN'
    check (preferred_currency = 'NGN');

comment on column public.profiles.theme_preference is
  'Stored but not yet applied — the app renders light-only until theme.js becomes a provider. Kept so the choice survives that change.';
comment on column public.profiles.preferred_currency is
  'Constrained to NGN. The column exists so multi-currency is a constraint change rather than a schema migration; orders.currency has the same restriction.';

commit;

notify pgrst, 'reload schema';
