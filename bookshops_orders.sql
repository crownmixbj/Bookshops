-- Bookshops — order tracking, delivery, and vendor contact
--
-- Gives `orders` the things a real order record needs and currently
-- lacks: what it cost, where it is going, where it has got to, and how
-- to track it. Also gives `vendors` a business phone and email, so a
-- buyer can contact the shop without the app loosening RLS on
-- `profiles` (a vendor's personal profile stays private; the shop's
-- business contact details are a different thing and are meant to be
-- shared).
--
-- Safe to run: adds columns and one trigger, modifies no existing rows.
-- `orders` has 0 rows at time of writing, so the amount backfill at the
-- bottom is a no-op for you — it is included for when it isn't.

begin;

-- ============================================================
-- 1. What the order cost
-- ============================================================
-- Until now the only money figure lived on quotes.total_price, which the
-- vendor can still edit. An order must snapshot what was actually agreed
-- or a receipt printed next month will not match what was paid.
alter table public.orders
  add column if not exists amount    numeric(12,2) check (amount is null or amount >= 0),
  add column if not exists currency  text not null default 'NGN' check (currency = 'NGN');

comment on column public.orders.amount is
  'Price agreed when the order was placed. Snapshotted from the accepted quote on purpose — quotes.total_price can change afterwards.';

-- ============================================================
-- 2. Where it is going
-- ============================================================
alter table public.orders
  add column if not exists delivery_name    text,
  add column if not exists delivery_phone   text,
  add column if not exists delivery_address text,
  add column if not exists delivery_city    text,
  add column if not exists delivery_notes   text;

comment on column public.orders.delivery_address is
  'Captured per order rather than from a saved address book, so editing a saved address later never rewrites the history of past deliveries.';

-- ============================================================
-- 3. Where it has got to
-- ============================================================
-- fulfillment_status says the current step but not when each was
-- reached, so a tracker could not show a timeline. One nullable
-- timestamp per step, stamped by the trigger below.
alter table public.orders
  add column if not exists placed_at     timestamptz not null default now(),
  add column if not exists processing_at timestamptz,
  add column if not exists ready_at      timestamptz,
  add column if not exists dispatched_at timestamptz,
  add column if not exists delivered_at  timestamptz,
  add column if not exists cancelled_at  timestamptz;

-- ============================================================
-- 4. How to track it
-- ============================================================
alter table public.orders
  add column if not exists tracking_carrier text,
  add column if not exists tracking_number  text,
  add column if not exists tracking_url     text
    check (tracking_url is null or tracking_url ~* '^https://');

comment on column public.orders.tracking_url is
  'Must be https. The app opens this in an external browser, so an http or javascript: value would be a real hazard.';

-- Stamp the timestamp for whichever step the order just moved into.
-- Doing this in the database means it is correct no matter who writes
-- the status — the app, an admin, or a courier webhook.
create or replace function public.stamp_order_fulfillment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fulfillment_status is distinct from old.fulfillment_status then
    case new.fulfillment_status
      when 'processing' then new.processing_at := coalesce(new.processing_at, now());
      when 'ready'      then new.ready_at      := coalesce(new.ready_at, now());
      when 'dispatched' then new.dispatched_at := coalesce(new.dispatched_at, now());
      when 'delivered'  then new.delivered_at  := coalesce(new.delivered_at, now());
      when 'cancelled'  then new.cancelled_at  := coalesce(new.cancelled_at, now());
      else null;
    end case;
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_order_fulfillment on public.orders;
create trigger stamp_order_fulfillment
  before update on public.orders
  for each row execute function public.stamp_order_fulfillment();

-- ============================================================
-- 5. Vendor business contact
-- ============================================================
-- A buyer cannot read a vendor's row in `profiles` — profiles_select_own
-- restricts that to the owner, and it should stay that way. These are
-- the shop's published contact details, which is a different thing, and
-- vendors_select_active already lets any signed-in user read an active
-- vendor row.
alter table public.vendors
  add column if not exists phone text,
  add column if not exists email text
    check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

comment on column public.vendors.phone is
  'Published business contact, visible to buyers. Not the owner''s personal number from profiles.';

-- ============================================================
-- 6. Indexes
-- ============================================================
create index if not exists orders_buyer_created_idx
  on public.orders (buyer_id, created_at desc);
create index if not exists orders_fulfillment_idx
  on public.orders (fulfillment_status);

-- ============================================================
-- 7. Backfill amount for any orders placed before this migration
-- ============================================================
update public.orders o
   set amount = q.total_price
  from public.quotes q
 where q.id = o.quote_id
   and o.amount is null;

commit;

-- NOTE ON WRITES
-- There is still deliberately no UPDATE policy on `orders`. Payment and
-- fulfilment status, tracking details and amounts must be written by a
-- webhook or an admin using the service key — never by the buyer's
-- browser, which could otherwise mark its own order paid or delivered.
-- The buyer supplies delivery details at insert time, which
-- orders_insert_own already permits.

notify pgrst, 'reload schema';
