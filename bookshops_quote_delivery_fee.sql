-- Bookshops — the shop quotes its own delivery cost
--
-- Until now delivery was one flat platform rate (payout_settings.
-- delivery_fee, ₦1,500), added at checkout. A shop across the road and a
-- shop across Lagos charged a parent the same, and the shop had no say
-- in what it cost to get the books to them.
--
-- From here each quote carries its own delivery_fee, set by the shop
-- next to the books, and the buyer sees both before paying:
--
--     Items total    ₦45,000     quotes.total_price   (unchanged meaning)
--     Delivery fee    ₦2,000     quotes.delivery_fee  (new)
--     Total          ₦47,000     what checkout charges
--
-- What this file changes:
--   1. quotes.delivery_fee. Nullable while a quote is a draft; required
--      (0 or more — 0 means free delivery) before it can be sent. Every
--      quote already sent or accepted is backfilled with the flat rate
--      that was in force, so NOTHING already quoted changes price.
--   2. Every function that prices a checkout now reads the quote's own
--      fee instead of the flat rate: checkout_quote, begin_escrow_checkout,
--      simulate_escrow_payment, and bundle_lines (which the three bundle
--      functions all price through).
--   3. The buyer's "new quote" / "quote revised" alerts quote the full
--      amount, and a change to the delivery fee alone counts as a revision.
--
-- Bundles keep their existing rule — one delivery per shop per bundle,
-- because lists from the same shop travel together — but that one
-- delivery is now the HIGHEST fee that shop quoted across the lists in
-- the bundle, charged once, not the flat rate.
--
-- payout_settings.delivery_fee is left in place but no longer read by
-- checkout. It is only the backfill value below.
--
-- Safe to run more than once. Requires bookshops_escrow_checkout.sql and
-- bookshops_buyer_portal.sql.

begin;

-- ============================================================
-- 1. The column
-- ============================================================
alter table public.quotes
  add column if not exists delivery_fee numeric(12,2)
    check (delivery_fee is null or (delivery_fee >= 0 and delivery_fee <= 100000));

comment on column public.quotes.delivery_fee is
  'The shop''s delivery charge for this quote, separate from total_price (the items). 0 = free delivery. Required before the quote is sent; checkout charges total_price + delivery_fee.';

-- Backfill live quotes at the rate they were shown under, before the
-- constraint below would reject them.
update public.quotes q
   set delivery_fee = coalesce((select s.delivery_fee from public.payout_settings s where s.id), 0)
 where q.delivery_fee is null
   and q.status <> 'draft';

alter table public.quotes drop constraint if exists quotes_delivery_fee_when_sent;
alter table public.quotes
  add constraint quotes_delivery_fee_when_sent
  check (status = 'draft' or delivery_fee is not null);

-- ============================================================
-- 2. Checkout, single quote
-- ============================================================
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
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  return query
  select
    q.id,
    q.request_id,
    q.vendor_id,
    v.store_name,
    r.school_name,
    q.status,
    q.total_price,
    coalesce(q.delivery_fee, 0),
    q.total_price + coalesce(q.delivery_fee, 0),
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

  -- Items and delivery both come from the quote — never from the caller.
  select q.total_price, coalesce(q.delivery_fee, 0) into v_items_total, v_fee
  from public.quotes q
  join public.book_requests r on r.id = q.request_id
  where q.id = p_quote_id
    and r.buyer_id = p_buyer_id
    and q.status in ('sent', 'accepted');

  if v_items_total is null then
    raise exception 'Quote % is not open to this buyer', p_quote_id using errcode = '42501';
  end if;

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

  select s.allow_test_payments into v_allowed
  from public.payout_settings s where s.id;

  if not coalesce(v_allowed, false) then
    raise exception 'Test payments are switched off for this project'
      using errcode = '42501',
            hint = 'update public.payout_settings set allow_test_payments = true;';
  end if;

  select q.total_price, coalesce(q.delivery_fee, 0), q.request_id into v_items, v_fee, v_request
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

-- ============================================================
-- 3. Checkout, bundle
-- ============================================================
-- checkout_bundle, begin_escrow_bundle and simulate_escrow_bundle all
-- price through this one function, so this is the only bundle change.
-- Unchanged except the `fees` step: the shop's first valid line carries
-- the highest delivery fee that shop quoted on any valid line in the
-- bundle; its other lines carry 0.
create or replace function public.bundle_lines(p_buyer uuid, p_quote_ids uuid[])
returns table (
  quote_id    uuid,
  request_id  uuid,
  vendor_id   uuid,
  store_name  text,
  school_name text,
  class_level text,
  child_name  text,
  items_total numeric,
  delivery_fee numeric,
  line_total  numeric,
  problem     text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  with wanted as (
    select distinct on (w.qid) w.qid, w.ord
    from unnest(p_quote_ids) with ordinality as w(qid, ord)
    order by w.qid, w.ord
  ),
  base as (
    select
      w.ord,
      q.id            as qid,
      q.request_id    as rid,
      q.vendor_id     as vid,
      v.store_name    as store,
      r.school_name   as school,
      r.class_level   as klass,
      c.full_name     as child,
      q.total_price   as items,
      coalesce(q.delivery_fee, 0) as dfee,
      case
        when q.id is null or r.buyer_id is distinct from p_buyer then 'not_found'
        when q.status not in ('sent', 'accepted') then 'not_open'
        when exists (
          select 1 from public.orders o
          where o.quote_id = q.id
            and o.payment_status in ('escrow_held', 'escrow_released', 'paid')
        ) then 'already_paid'
        when exists (
          select 1 from public.orders o
          join public.quotes q2 on q2.id = o.quote_id
          where q2.request_id = q.request_id
            and o.payment_status in ('escrow_held', 'escrow_released', 'paid')
        ) then 'booklist_ordered'
        else null
      end as problem,
      -- Two quotes for the same booklist cannot both be bought.
      row_number() over (partition by q.request_id order by w.ord) as nth_for_list
    from wanted w
    left join public.quotes q        on q.id = w.qid
    left join public.book_requests r on r.id = q.request_id
    left join public.vendors v       on v.id = q.vendor_id
    left join public.children c      on c.id = r.child_id
  ),
  checked as (
    select b.*,
      coalesce(b.problem, case when b.nth_for_list > 1 then 'duplicate_booklist' end) as final_problem
    from base b
  ),
  fees as (
    select ch.*,
      case
        when ch.final_problem is null
         and row_number() over (partition by ch.vid, (ch.final_problem is null) order by ch.ord) = 1
        then max(case when ch.final_problem is null then ch.dfee end) over (partition by ch.vid)
        else 0
      end as fee
    from checked ch
  )
  select
    f.qid, f.rid, f.vid, f.store, f.school, f.klass, f.child,
    coalesce(f.items, 0),
    coalesce(f.fee, 0),
    coalesce(f.items, 0) + coalesce(f.fee, 0),
    f.final_problem
  from fees f
  order by f.ord;
end;
$$;

revoke all on function public.bundle_lines(uuid, uuid[]) from public;

-- ============================================================
-- 4. The buyer's quote alerts quote the full amount
-- ============================================================
-- As in bookshops_buyer_portal.sql, but the amount in the alert is items
-- plus delivery (what the buyer will actually pay), and a change to the
-- delivery fee alone is a revision worth telling them about.
create or replace function public.notify_quote_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer  uuid;
  v_school text;
  v_store  text;
  v_what   text;
  v_amount text := '₦' || to_char(coalesce(new.total_price, 0) + coalesce(new.delivery_fee, 0), 'FM999,999,999,990');
  v_split  text := case
                     when coalesce(new.delivery_fee, 0) = 0 then ' incl. free delivery'
                     else ' incl. ₦' || to_char(new.delivery_fee, 'FM999,999,999,990') || ' delivery'
                   end;
begin
  select r.buyer_id, r.school_name into v_buyer, v_school
  from public.book_requests r where r.id = new.request_id;
  select v.store_name into v_store from public.vendors v where v.id = new.vendor_id;

  v_what := coalesce(nullif(v_school, ''), 'your booklist');

  if tg_op = 'INSERT' then
    if new.status = 'sent' then
      perform public.push_notification(
        v_buyer, 'quote_received',
        'New quote from ' || coalesce(v_store, 'a bookshop'),
        v_what || ' — ' || v_amount || v_split,
        '/quotes/' || new.id, new.id, null, new.request_id, false);
    end if;
    return null;
  end if;

  if new.status = 'sent' and old.status is distinct from 'sent' then
    perform public.push_notification(
      v_buyer, 'quote_received',
      'New quote from ' || coalesce(v_store, 'a bookshop'),
      v_what || ' — ' || v_amount || v_split,
      '/quotes/' || new.id, new.id, null, new.request_id, false);

  elsif old.status = 'sent' and new.status = 'sent'
        and (new.total_price is distinct from old.total_price
             or new.delivery_fee is distinct from old.delivery_fee) then
    perform public.push_notification(
      v_buyer, 'quote_updated',
      coalesce(v_store, 'A bookshop') || ' revised their quote',
      v_what || ' — now ' || v_amount || v_split,
      '/quotes/' || new.id, new.id, null, new.request_id, true);

  elsif old.status = 'sent' and new.status = 'withdrawn' then
    perform public.push_notification(
      v_buyer, 'quote_withdrawn',
      coalesce(v_store, 'A bookshop') || ' withdrew their quote',
      v_what, '/booklists/' || new.request_id, new.id, null, new.request_id, false);
  end if;

  return null;
end;
$$;

drop trigger if exists notify_quote_change on public.quotes;
create trigger notify_quote_change
  after insert or update of status, total_price, delivery_fee on public.quotes
  for each row execute function public.notify_quote_change();

commit;

notify pgrst, 'reload schema';
