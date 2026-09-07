-- Verification harness for bookshops_escrow_checkout.sql
--
-- Runs the escrow flow against a throwaway local Postgres, so the money
-- paths are exercised before they ever meet a real card. Nothing here
-- touches your Supabase project.
--
--   initdb -D /tmp/pgdata -A trust
--   pg_ctl -D /tmp/pgdata -o '-p 5433' start
--   psql -p 5433 -d postgres -c 'create role authenticated; create role service_role;'
--   psql -p 5433 -d postgres -f bookshops_escrow_checkout.test.sql
--
-- Every step prints what it expects. A PASS notice means a refusal
-- happened that was supposed to happen.

-- ============ part 1: a stand-in for the live schema ============
-- Minimal stand-in for the live Bookshops schema, enough to compile and
-- exercise bookshops_escrow_checkout.sql.
create extension if not exists pgcrypto;

create schema if not exists auth;

-- Stubs for Supabase's auth helpers, driven by a session GUC so a test
-- can pretend to be a buyer or the service role.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated');
$$;

create table auth.users (id uuid primary key, email text);

create type user_role as enum ('buyer','vendor','admin');

create table public.profiles (
  id uuid primary key references auth.users(id),
  full_name text not null,
  role user_role not null default 'buyer',
  phone_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  default_delivery_address text,
  default_delivery_city text,
  default_delivery_phone text,
  notify_email_orders boolean not null default true,
  notify_email_quotes boolean not null default true,
  notify_push_orders boolean not null default true,
  notify_push_quotes boolean not null default false,
  notify_sms_orders boolean not null default false,
  notify_sms_quotes boolean not null default false,
  theme_preference text not null default 'system' check (theme_preference in ('light','dark','system')),
  preferred_currency text not null default 'NGN' check (preferred_currency = 'NGN'),
  suspended_at timestamptz,
  suspension_reason text check (suspension_reason is null or length(suspension_reason) <= 500)
);

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  store_name text not null,
  address text not null,
  city text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  phone text,
  email text,
  verified_at timestamptz,
  rating numeric,
  review_count integer not null default 0,
  completed_orders integer not null default 0,
  busy_mode boolean not null default false,
  busy_note text,
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_note text,
  featured boolean not null default false
);

create table public.book_requests (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id),
  school_name text not null,
  class_level text not null,
  image_url text,
  status text not null default 'pending_quote'
    check (status in ('draft','pending_quote','quoted','ordered','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  image_path text,
  target_vendor_id uuid references public.vendors(id)
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.book_requests(id),
  vendor_id uuid not null references public.vendors(id),
  total_price numeric not null default 0 check (total_price >= 0),
  item_breakdown jsonb not null default '[]'::jsonb check (jsonb_typeof(item_breakdown) = 'array'),
  status text not null default 'sent'
    check (status in ('draft','sent','accepted','rejected','withdrawn','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id),
  buyer_id uuid not null references public.profiles(id),
  payment_status text not null default 'pending'
    constraint orders_payment_status_check check (payment_status in ('pending','paid','failed','refunded')),
  fulfillment_status text not null default 'processing'
    check (fulfillment_status in ('processing','ready','dispatched','delivered','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  amount numeric(12,2) check (amount is null or amount >= 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  delivery_name text,
  delivery_phone text,
  delivery_address text,
  delivery_city text,
  delivery_notes text,
  placed_at timestamptz not null default now(),
  processing_at timestamptz,
  ready_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  tracking_carrier text,
  tracking_number text,
  tracking_url text check (tracking_url is null or tracking_url ~* '^https://')
);

create table public.payout_settings (
  id boolean primary key default true check (id),
  minimum_amount numeric not null default 5000 check (minimum_amount >= 0),
  commission_rate numeric not null default 0 check (commission_rate >= 0 and commission_rate < 1),
  updated_at timestamptz not null default now()
);
insert into public.payout_settings (id) values (true);

-- ============ part 2: the migration under test ============
\i bookshops_escrow_checkout.sql

-- ============ part 3: the checks ============

-- Fixtures -----------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'buyer@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'vendor@example.com');

insert into public.profiles (id, full_name, role, default_delivery_address, default_delivery_city)
values ('11111111-1111-1111-1111-111111111111', 'Bolaji Buyer', 'buyer', '12 Awolowo Road', 'Ikeja'),
       ('22222222-2222-2222-2222-222222222222', 'Rasmed Owner', 'vendor', null, null);

insert into public.vendors (id, profile_id, store_name, address, city, approval_status)
values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
        'Rasmed Bookshop', '9 Ring Road', 'Ibadan', 'approved');

insert into public.book_requests (id, buyer_id, school_name, class_level, status)
values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
        'Corona Secondary', 'JSS2', 'quoted');

insert into public.quotes (id, request_id, vendor_id, total_price, status) values
  ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444',
   '33333333-3333-3333-3333-333333333333', 57640, 'sent'),
  ('66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444',
   '33333333-3333-3333-3333-333333333333', 61000, 'sent');

\echo '--- 1. checkout_quote as the buyer: total must be 57640 + 1500 = 59140'
set test.uid = '11111111-1111-1111-1111-111111111111';
select store_name, items_total, delivery_fee, total, existing_order_id
from public.checkout_quote('55555555-5555-5555-5555-555555555555');

\echo '--- 2. checkout_quote as a stranger: must return no rows'
set test.uid = '22222222-2222-2222-2222-222222222222';
select count(*) as rows_for_stranger
from public.checkout_quote('55555555-5555-5555-5555-555555555555');

\echo '--- 3. begin_escrow_checkout without service_role: must be refused'
set test.role = 'authenticated';
do $$ begin
  perform public.begin_escrow_checkout(
    '11111111-1111-1111-1111-111111111111','55555555-5555-5555-5555-555555555555',
    'Bolaji','08031234567','12 Awolowo Road','Ikeja');
  raise exception 'SHOULD NOT REACH — authenticated was allowed to open a charge';
exception when insufficient_privilege then
  raise notice 'PASS refused for non-service-role';
end $$;

\echo '--- 4. begin_escrow_checkout as service_role'
set test.role = 'service_role';
select order_id, payment_reference, amount, currency
from public.begin_escrow_checkout(
  '11111111-1111-1111-1111-111111111111','55555555-5555-5555-5555-555555555555',
  'Bolaji','08031234567','12 Awolowo Road','Ikeja','Lagos','Blue gate') \gset first_

\echo '--- 5. calling it again must RESUME, not create a second order'
select order_id = :'first_order_id' as same_order,
       payment_reference = :'first_payment_reference' as same_reference
from public.begin_escrow_checkout(
  '11111111-1111-1111-1111-111111111111','55555555-5555-5555-5555-555555555555',
  'Bolaji','08031234567','12 Awolowo Road','Ikeja','Lagos','Blue gate');
select count(*) as orders_for_quote from public.orders
where quote_id = '55555555-5555-5555-5555-555555555555';

\echo '--- 6. underpayment must be refused'
do $$ begin
  perform public.finalize_escrow_order(
    (select payment_reference from public.orders limit 1), 'ps_1', 100);
  raise exception 'SHOULD NOT REACH — an underpayment was accepted';
exception when sqlstate '22023' then
  raise notice 'PASS underpayment refused';
end $$;

\echo '--- 7. correct payment settles it'
select order_id, already_finalized
from public.finalize_escrow_order(:'first_payment_reference', 'ps_9001', 59140);

\echo '--- 8. the webhook arriving second must be a no-op'
select already_finalized as second_call_is_noop
from public.finalize_escrow_order(:'first_payment_reference', 'ps_9001', 59140);

\echo '--- 9. state afterwards: order escrow_held, quote accepted, sibling rejected, request ordered'
select o.payment_status, o.fulfillment_status, o.amount, o.delivery_fee,
       o.delivery_state, o.gateway_reference, (o.paid_at is not null) as stamped
from public.orders o where o.id = :'first_order_id';
select id, status from public.quotes order by id;
select status as request_status from public.book_requests;

\echo '--- 10. a second charge against a paid quote must be refused'
do $$ begin
  perform public.begin_escrow_checkout(
    '11111111-1111-1111-1111-111111111111','55555555-5555-5555-5555-555555555555',
    'Bolaji','08031234567','12 Awolowo Road','Ikeja');
  raise exception 'SHOULD NOT REACH — double payment allowed';
exception when unique_violation then
  raise notice 'PASS double payment refused';
end $$;

\echo '--- 11. checkout_quote now reports the existing order'
set test.uid = '11111111-1111-1111-1111-111111111111';
select existing_payment_status from public.checkout_quote('55555555-5555-5555-5555-555555555555');

\echo '--- 12. simulate_escrow_payment is off by default'
insert into public.book_requests (id, buyer_id, school_name, class_level, status)
values ('77777777-7777-7777-7777-777777777777','11111111-1111-1111-1111-111111111111','Greensprings','JSS1','quoted');
insert into public.quotes (id, request_id, vendor_id, total_price, status)
values ('88888888-8888-8888-8888-888888888888','77777777-7777-7777-7777-777777777777',
        '33333333-3333-3333-3333-333333333333', 20000, 'sent');
do $$ begin
  perform public.simulate_escrow_payment(
    '88888888-8888-8888-8888-888888888888','Bolaji','08031234567','12 Awolowo Road','Ikeja');
  raise exception 'SHOULD NOT REACH — test payment allowed while switched off';
exception when insufficient_privilege then
  raise notice 'PASS test payment refused while off';
end $$;

\echo '--- 13. switched on, it works'
update public.payout_settings set allow_test_payments = true;
select public.simulate_escrow_payment(
  '88888888-8888-8888-8888-888888888888','Bolaji','08031234567','12 Awolowo Road','Ikeja','Lagos',null)
  is not null as test_order_created;
select payment_status, payment_provider, amount from public.orders
where quote_id = '88888888-8888-8888-8888-888888888888';
