-- Bookshops — Paystack checkout and escrow-held payments
--
-- The checkout screen needs four things the schema does not currently
-- give it, and none of them are cosmetic:
--
--   1. Somewhere to put the gateway's reference. Without it a charge in
--      Paystack's dashboard cannot be matched to an order here, which is
--      the first thing anyone asks when a buyer says they paid.
--   2. An escrow state. payment_status only knows pending/paid/failed/
--      refunded, and 'paid' is a lie while the money is still ours to
--      refund. Escrow is the product promise; it needs its own value.
--   3. A way to accept a quote. quotes_update_own_vendor is the only
--      UPDATE policy on quotes, so a buyer setting status='accepted'
--      from the client updates zero rows and reports no error. That is
--      the worst kind of bug: the order exists, the quote still says
--      'sent', and nothing anywhere says why.
--   4. A price the client cannot choose. If the amount is computed in
--      JavaScript then the amount is whatever the buyer's devtools say
--      it is.
--
-- The functions below are the answer to 3 and 4: they run as their owner
-- so they can cross the RLS boundary the buyer cannot, and they compute
-- money from the quote rather than from an argument.
--
-- Safe to run more than once. Adds columns, widens one CHECK, and
-- creates functions. Modifies no existing rows.

begin;

-- ============================================================
-- 1. Escrow as a payment state
-- ============================================================
-- 'paid' is kept rather than replaced: older code paths and the invoice
-- template already read it, and a refunded escrow order still needs
-- somewhere to land. The two new values sit between pending and paid —
-- money taken, money not yet the vendor's.
alter table public.orders drop constraint if exists orders_payment_status_check;

alter table public.orders
  add constraint orders_payment_status_check
  check (payment_status in (
    'pending',          -- initialised, buyer has not completed the charge
    'escrow_held',      -- charged and verified; LOCI is holding the money
    'escrow_released',  -- released to the vendor after the buyer confirmed receipt
    'paid',             -- legacy / direct settlement
    'failed',
    'refunded'
  ));

comment on column public.orders.payment_status is
  'escrow_held means the charge succeeded and the money is held by LOCI, not the vendor. Only finalize_escrow_order() sets it, and only after Paystack has been asked to verify the reference server-side.';

-- ============================================================
-- 2. What the gateway called it
-- ============================================================
-- payment_reference is OURS and is generated before the charge, so the
-- row can be found again when a webhook arrives for a session the app
-- never got to report on. gateway_reference is Paystack's own id, which
-- is what support will ask for.
alter table public.orders
  add column if not exists payment_reference  text,
  add column if not exists payment_provider   text
    check (payment_provider is null or payment_provider in ('paystack', 'test')),
  add column if not exists gateway_reference  text,
  add column if not exists paid_at            timestamptz,
  add column if not exists escrow_released_at timestamptz;

-- Unique, not just indexed: the reference is the idempotency key. The
-- webhook and the app's own verify call race each other on every single
-- successful payment, and this is what makes the loser a no-op instead
-- of a second order.
create unique index if not exists orders_payment_reference_key
  on public.orders (payment_reference)
  where payment_reference is not null;

comment on column public.orders.payment_reference is
  'Our reference, generated at initialise. The idempotency key for finalisation — the app callback and the webhook both finalise through it and exactly one wins.';

-- ============================================================
-- 3. Delivery: the fee, and the state
-- ============================================================
-- delivery_fee is snapshotted per order for the same reason `amount` is:
-- the flat rate will change, and a receipt printed next year must still
-- add up.
alter table public.orders
  add column if not exists delivery_fee   numeric(12,2) not null default 0
    check (delivery_fee >= 0),
  add column if not exists delivery_state text;

comment on column public.orders.delivery_fee is
  'Snapshot of the delivery rate charged. `amount` is the total including this, not the item subtotal.';

-- profiles gained a state column in bookshops_delivery_address.sql,
-- which this database has not run. Checkout prefills from it when it is
-- there, so add it here rather than making the screen depend on a
-- migration order.
alter table public.profiles
  add column if not exists default_delivery_state text;

-- ============================================================
-- 4. The delivery rate, and the test-payment switch
-- ============================================================
alter table public.payout_settings
  add column if not exists delivery_fee numeric(12,2) not null default 1500
    check (delivery_fee >= 0),
  add column if not exists allow_test_payments boolean not null default false;

comment on column public.payout_settings.allow_test_payments is
  'Off by default and deliberately not an env var. simulate_escrow_payment() refuses while this is false, so a leaked anon key cannot mint escrow_held orders against production. Turn it on for a dev project only.';

comment on column public.payout_settings.delivery_fee is
  'Flat national rate. Lives in data so changing it is an UPDATE, not a deploy. checkout_quote() is the only thing the client reads it through, so the screen and the charge can never disagree.';

insert into public.payout_settings (id) values (true) on conflict (id) do nothing;

-- ============================================================
-- 5. What the buyer is about to pay for
-- ============================================================
-- The screen must display exactly the number the server will charge. The
-- only way to guarantee that is for both to come from here.
--
-- Also returns existing_order_id, which is what stops a buyer paying
-- twice for the same quote by reopening the checkout link.
create or replace function public.checkout_quote(p_quote_id uuid)
returns table (
  quote_id         uuid,
  request_id       uuid,
  vendor_id        uuid,
  store_name       text,
  school_name      text,
  quote_status     text,
  items_total      numeric,
  delivery_fee     numeric,
  total            numeric,
  existing_order_id uuid,
  existing_payment_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_fee numeric;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select s.delivery_fee into v_fee from public.payout_settings s where s.id;

  return query
  select
    q.id,
    q.request_id,
    q.vendor_id,
    v.store_name,
    r.school_name,
    q.status,
    q.total_price,
    coalesce(v_fee, 0),
    q.total_price + coalesce(v_fee, 0),
    o.id,
    o.payment_status
  from public.quotes q
  join public.book_requests r on r.id = q.request_id
  join public.vendors v       on v.id = q.vendor_id
  -- Any order already standing against this quote, whoever placed it.
  -- Ordered so a real payment wins over an abandoned pending row.
  left join lateral (
    select o2.id, o2.payment_status
    from public.orders o2
    where o2.quote_id = q.id
    order by (o2.payment_status <> 'pending') desc, o2.created_at desc
    limit 1
  ) o on true
  -- The security boundary. Not RLS: this function is definer-rights, so
  -- it is on us to prove the caller owns the request behind the quote.
  where q.id = p_quote_id
    and r.buyer_id = v_uid
    and q.status <> 'draft';
end;
$$;

revoke all on function public.checkout_quote(uuid) from public;
grant execute on function public.checkout_quote(uuid) to authenticated;

-- ============================================================
-- 6. Opening a charge
-- ============================================================
-- Service role only. The amount is read from the quote, never taken as
-- an argument, so there is no number here the client could have chosen.
--
-- Returns an existing pending row when one is already open for the
-- quote: a buyer who abandons Paystack and comes back should resume,
-- not accumulate orphan orders.
create or replace function public.begin_escrow_checkout(
  p_buyer_id         uuid,
  p_quote_id         uuid,
  p_delivery_name    text,
  p_delivery_phone   text,
  p_delivery_address text,
  p_delivery_city    text,
  p_delivery_state   text default null,
  p_delivery_notes   text default null
)
returns table (order_id uuid, payment_reference text, amount numeric, currency text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_items_total numeric;
  v_fee         numeric;
  v_total       numeric;
  v_order       public.orders%rowtype;
  v_reference   text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'begin_escrow_checkout is service-role only' using errcode = '42501';
  end if;

  select q.total_price into v_items_total
  from public.quotes q
  join public.book_requests r on r.id = q.request_id
  where q.id = p_quote_id
    and r.buyer_id = p_buyer_id
    and q.status in ('sent', 'accepted');

  if v_items_total is null then
    raise exception 'Quote % is not open to this buyer', p_quote_id using errcode = '42501';
  end if;

  select s.delivery_fee into v_fee from public.payout_settings s where s.id;
  v_fee   := coalesce(v_fee, 0);
  v_total := v_items_total + v_fee;

  -- Already settled? Say so rather than opening a second charge.
  select * into v_order
  from public.orders o
  where o.quote_id = p_quote_id and o.payment_status in ('escrow_held', 'escrow_released', 'paid')
  limit 1;

  if found then
    raise exception 'Quote % has already been paid for (order %)', p_quote_id, v_order.id
      using errcode = '23505';
  end if;

  -- Resume an abandoned attempt.
  select * into v_order
  from public.orders o
  where o.quote_id = p_quote_id and o.buyer_id = p_buyer_id and o.payment_status = 'pending'
  order by o.created_at desc
  limit 1;

  if found then
    update public.orders o set
      amount           = v_total,
      delivery_fee     = v_fee,
      delivery_name    = p_delivery_name,
      delivery_phone   = p_delivery_phone,
      delivery_address = p_delivery_address,
      delivery_city    = p_delivery_city,
      delivery_state   = p_delivery_state,
      delivery_notes   = p_delivery_notes,
      updated_at       = now()
    where o.id = v_order.id
    returning o.id, o.payment_reference into order_id, payment_reference;
  else
    -- Reference is generated here, not by the caller, so it is unique by
    -- construction and cannot collide with a replayed request.
    v_reference := 'LOCI-' || upper(replace(gen_random_uuid()::text, '-', ''))::text;
    v_reference := left(v_reference, 21);

    insert into public.orders (
      quote_id, buyer_id, amount, delivery_fee, currency,
      payment_status, fulfillment_status, payment_provider, payment_reference,
      delivery_name, delivery_phone, delivery_address, delivery_city, delivery_state, delivery_notes
    ) values (
      p_quote_id, p_buyer_id, v_total, v_fee, 'NGN',
      'pending', 'processing', 'paystack', v_reference,
      p_delivery_name, p_delivery_phone, p_delivery_address, p_delivery_city, p_delivery_state, p_delivery_notes
    )
    returning public.orders.id, public.orders.payment_reference into order_id, payment_reference;
  end if;

  amount   := v_total;
  currency := 'NGN';
  return next;
end;
$$;

revoke all on function public.begin_escrow_checkout(uuid, uuid, text, text, text, text, text, text) from public;

-- ============================================================
-- 7. Settling it
-- ============================================================
-- Idempotent by design. The app's verify call and Paystack's webhook
-- both land here for every successful payment, usually within a second
-- of each other; whichever arrives second must find the work done and
-- return quietly.
--
-- This is also the only place a quote is accepted, which is the point:
-- it happens in the same transaction as the payment record, so there is
-- no window where money is held against a quote that still says 'sent'.
create or replace function public.finalize_escrow_order(
  p_payment_reference text,
  p_gateway_reference text,
  p_amount_paid       numeric,
  p_provider          text default 'paystack'
)
returns table (order_id uuid, already_finalized boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order   public.orders%rowtype;
  v_request uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'finalize_escrow_order is service-role only' using errcode = '42501';
  end if;

  -- Lock it: the webhook and the callback genuinely do arrive together.
  select * into v_order
  from public.orders o
  where o.payment_reference = p_payment_reference
  for update;

  if not found then
    raise exception 'No order for reference %', p_payment_reference using errcode = 'P0002';
  end if;

  if v_order.payment_status in ('escrow_held', 'escrow_released', 'paid') then
    order_id := v_order.id;
    already_finalized := true;
    return next;
    return;
  end if;

  -- Underpayment is a refusal, not a rounding note. Paystack settles in
  -- kobo, so compare with a kobo of slack and nothing more.
  if p_amount_paid + 0.01 < coalesce(v_order.amount, 0) then
    raise exception 'Paid % is short of the % owed on %',
      p_amount_paid, v_order.amount, p_payment_reference
      using errcode = '22023';
  end if;

  update public.orders o set
    payment_status    = 'escrow_held',
    payment_provider  = p_provider,
    gateway_reference = p_gateway_reference,
    paid_at           = now(),
    updated_at        = now()
  where o.id = v_order.id;

  -- The quote the buyer chose.
  update public.quotes q
     set status = 'accepted', updated_at = now()
   where q.id = v_order.quote_id
  returning q.request_id into v_request;

  -- Its siblings. A vendor whose quote was not taken should stop seeing
  -- it in a pending queue; leaving them 'sent' forever is how a shop
  -- ends up chasing an order that was placed elsewhere weeks ago.
  update public.quotes q
     set status = 'rejected', updated_at = now()
   where q.request_id = v_request
     and q.id <> v_order.quote_id
     and q.status = 'sent';

  update public.book_requests r
     set status = 'ordered', updated_at = now()
   where r.id = v_request;

  order_id := v_order.id;
  already_finalized := false;
  return next;
end;
$$;

revoke all on function public.finalize_escrow_order(text, text, numeric, text) from public;

-- ============================================================
-- 8. Test payments, off by default
-- ============================================================
-- The development shortcut, gated in the database rather than on the
-- absence of a client-side env var. An env var is a property of the
-- build; this is a property of the project. A production build pointed
-- at a dev database can use it, and a dev build pointed at production
-- cannot — which is the way round you want it.
create or replace function public.simulate_escrow_payment(
  p_quote_id         uuid,
  p_delivery_name    text,
  p_delivery_phone   text,
  p_delivery_address text,
  p_delivery_city    text,
  p_delivery_state   text default null,
  p_delivery_notes   text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_allowed   boolean;
  v_items     numeric;
  v_fee       numeric;
  v_total     numeric;
  v_order_id  uuid;
  v_request   uuid;
  v_reference text;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select s.allow_test_payments, s.delivery_fee into v_allowed, v_fee
  from public.payout_settings s where s.id;

  if not coalesce(v_allowed, false) then
    raise exception 'Test payments are switched off for this project'
      using errcode = '42501',
            hint = 'update public.payout_settings set allow_test_payments = true;';
  end if;

  select q.total_price, q.request_id into v_items, v_request
  from public.quotes q
  join public.book_requests r on r.id = q.request_id
  where q.id = p_quote_id and r.buyer_id = v_uid and q.status in ('sent', 'accepted');

  if v_items is null then
    raise exception 'Quote % is not open to you', p_quote_id using errcode = '42501';
  end if;

  if exists (
    select 1 from public.orders o
    where o.quote_id = p_quote_id
      and o.payment_status in ('escrow_held', 'escrow_released', 'paid')
  ) then
    raise exception 'That quote has already been paid for' using errcode = '23505';
  end if;

  v_fee       := coalesce(v_fee, 0);
  v_total     := v_items + v_fee;
  v_reference := left('TEST-' || upper(replace(gen_random_uuid()::text, '-', '')), 21);

  insert into public.orders (
    quote_id, buyer_id, amount, delivery_fee, currency,
    payment_status, fulfillment_status, payment_provider,
    payment_reference, gateway_reference, paid_at,
    delivery_name, delivery_phone, delivery_address, delivery_city, delivery_state, delivery_notes
  ) values (
    p_quote_id, v_uid, v_total, v_fee, 'NGN',
    'escrow_held', 'processing', 'test',
    v_reference, v_reference, now(),
    p_delivery_name, p_delivery_phone, p_delivery_address, p_delivery_city, p_delivery_state, p_delivery_notes
  )
  returning id into v_order_id;

  update public.quotes q set status = 'accepted', updated_at = now() where q.id = p_quote_id;
  update public.quotes q set status = 'rejected', updated_at = now()
   where q.request_id = v_request and q.id <> p_quote_id and q.status = 'sent';
  update public.book_requests r set status = 'ordered', updated_at = now() where r.id = v_request;

  return v_order_id;
end;
$$;

revoke all on function public.simulate_escrow_payment(uuid, text, text, text, text, text, text) from public;
grant execute on function public.simulate_escrow_payment(uuid, text, text, text, text, text, text) to authenticated;

commit;
