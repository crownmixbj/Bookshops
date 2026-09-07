-- Bookshops — vendor fulfilment
--
-- `orders` has a SELECT policy and an INSERT policy and nothing else.
-- There is no UPDATE policy at all, for anybody. So a vendor screen
-- doing
--
--     supabase.from('orders').update({ fulfillment_status: 'dispatched' })
--
-- matches zero rows and returns no error: the button animates, the list
-- refreshes, nothing has changed, and the shop believes it has told the
-- buyer their books are on the way.
--
-- The fix is not a broad UPDATE policy. Fulfilment is a state machine
-- with money attached, and RLS is a filter, not a state machine — a
-- policy can say "this vendor owns this row" but it is awkward at
-- saying "and delivered may not go back to processing". So the writes
-- go through definer-rights functions that own the rules.
--
-- Safe to run more than once. Creates functions only.
-- Requires bookshops_escrow_checkout.sql.

begin;

-- ============================================================
-- 1. Is this order mine to touch?
-- ============================================================
-- The vendor is two joins away from the order: orders -> quotes ->
-- vendors -> profiles. Written once here so the three functions below
-- cannot drift apart on the question that actually matters.
create or replace function public.vendor_owns_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.orders o
    join public.quotes q  on q.id = o.quote_id
    join public.vendors v on v.id = q.vendor_id
    where o.id = p_order_id
      and v.profile_id = auth.uid()
  );
$$;

revoke all on function public.vendor_owns_order(uuid) from public;
grant execute on function public.vendor_owns_order(uuid) to authenticated;

-- ============================================================
-- 2. Moving an order forward
-- ============================================================
-- One function for both steps a shop can take, because the guards are
-- identical and duplicating them is how they end up different.
--
-- The transitions allowed:
--     processing -> ready       ("packed, waiting for the courier")
--     processing -> dispatched  (packed and handed over in one go)
--     ready      -> dispatched
--
-- Everything else is refused, including the two that matter: nothing
-- moves backwards out of delivered, and nothing is dispatched against
-- an order that was never paid for.
create or replace function public.vendor_advance_fulfillment(
  p_order_id         uuid,
  p_next             text,
  p_tracking_carrier text default null,
  p_tracking_number  text default null,
  p_tracking_url     text default null
)
returns table (order_id uuid, fulfillment_status text, dispatched_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  if not public.vendor_owns_order(p_order_id) then
    -- Deliberately the same message whether the order belongs to another
    -- shop or does not exist. Distinguishing them would let any vendor
    -- probe for the existence of other shops' orders.
    raise exception 'That order is not yours' using errcode = '42501';
  end if;

  if p_next not in ('ready', 'dispatched') then
    raise exception 'A shop can only mark an order ready or dispatched, not %', p_next
      using errcode = '22023';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;

  -- Money first. Dispatching an unpaid order is how a shop gives books
  -- away, and the escrow promise is the only reason it is safe to pack
  -- before being paid out.
  if v_order.payment_status not in ('escrow_held', 'escrow_released', 'paid') then
    raise exception 'This order has not been paid for yet (payment is %)', v_order.payment_status
      using errcode = '42501',
            hint = 'Wait for the buyer''s payment to clear into escrow before dispatching.';
  end if;

  if v_order.fulfillment_status = p_next then
    -- Idempotent: a double tap on a slow connection is not an error.
    order_id := v_order.id;
    fulfillment_status := v_order.fulfillment_status;
    dispatched_at := v_order.dispatched_at;
    return next;
    return;
  end if;

  if v_order.fulfillment_status not in ('processing', 'ready')
     or (p_next = 'ready' and v_order.fulfillment_status <> 'processing') then
    raise exception 'An order that is % cannot be marked %',
      v_order.fulfillment_status, p_next
      using errcode = '22023';
  end if;

  -- tracking_url has a CHECK requiring https. Blanking whitespace here
  -- rather than letting an empty string hit that constraint, because a
  -- vendor leaving the field alone should not produce an error about a
  -- regular expression.
  update public.orders o set
    fulfillment_status = p_next,
    tracking_carrier   = coalesce(nullif(btrim(p_tracking_carrier), ''), o.tracking_carrier),
    tracking_number    = coalesce(nullif(btrim(p_tracking_number), ''), o.tracking_number),
    tracking_url       = coalesce(nullif(btrim(p_tracking_url), ''), o.tracking_url),
    updated_at         = now()
  where o.id = p_order_id;

  -- dispatched_at / ready_at are stamped by the stamp_order_fulfillment
  -- trigger from bookshops_orders.sql, not here. One writer for those.
  select o.id, o.fulfillment_status, o.dispatched_at
    into order_id, fulfillment_status, dispatched_at
  from public.orders o where o.id = p_order_id;

  return next;
end;
$$;

revoke all on function public.vendor_advance_fulfillment(uuid, text, text, text, text) from public;
grant execute on function public.vendor_advance_fulfillment(uuid, text, text, text, text) to authenticated;

-- ============================================================
-- 3. What is on this order
-- ============================================================
-- A vendor cannot read a buyer's `profiles` row — profiles_select_own
-- and profiles_select_admin are the only SELECT policies, and that is
-- correct: a shop has no business reading a customer's account.
--
-- It does not need to. orders.delivery_* snapshots the name, phone and
-- address the buyer actually typed at checkout, which is both what the
-- courier needs and a more honest record than a profile that may have
-- been edited since.
--
-- This function exists so the screen gets its lines in one round trip
-- with the ownership check applied once, rather than fanning out a
-- query per order card.
create or replace function public.vendor_order_items(p_order_ids uuid[])
returns table (
  order_id      uuid,
  item_id       uuid,
  title         text,
  quantity      integer,
  unit_price    numeric,
  is_available  boolean,
  -- Not `position`: that is a reserved word (POSITION(x IN y)) and
  -- Postgres rejects it unquoted in a RETURNS TABLE list. Quoting it
  -- would work and would then need quoting forever after.
  item_position integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.id,
    qi.id,
    qi.title,
    qi.quantity,
    qi.unit_price,
    qi.is_available,
    qi.position
  from public.orders o
  join public.quotes q       on q.id = o.quote_id
  join public.vendors v      on v.id = q.vendor_id
  join public.quote_items qi on qi.quote_id = q.id
  where o.id = any(p_order_ids)
    and v.profile_id = auth.uid()
  order by o.id, qi.position, qi.title;
$$;

revoke all on function public.vendor_order_items(uuid[]) from public;
grant execute on function public.vendor_order_items(uuid[]) to authenticated;

commit;
