-- Bookshops — vendor analytics
--
-- One function, one round trip, one JSON document: the totals, the same
-- totals for the period before (so a card can say "up 12%"), a daily
-- series, how this period's quotes turned out, the schools that paid,
-- and where won orders currently sit in fulfilment.
--
-- Definitions, because an analytics page is only as honest as these:
--
--   quotes sent     non-draft quotes CREATED in the period. There is no
--                   separate sent_at, so a draft saved on the 1st and
--                   sent on the 5th counts on the 1st.
--   orders won      orders whose payment actually cleared (escrow_held,
--                   escrow_released or paid), dated by paid_at. A pending
--                   checkout is not a win; a refunded one is not either.
--   revenue         amount minus delivery_fee on those orders — the value
--                   of the books, not the courier charge the buyer paid
--                   on top. Before commission.
--   conversion      of the quotes sent in the period, the share that
--                   became a paid order (at any time since). A cohort,
--                   not orders ÷ quotes: dividing this month's orders by
--                   this month's quotes mixes two different sets of
--                   quotes and can exceed 100%.
--
-- Days are Lagos days. A sale at 00:30 WAT belongs to the day the shop
-- was open, not the UTC day before.
--
-- Safe to run more than once. Creates one function.

begin;

create or replace function public.vendor_analytics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  my_vendor   uuid;
  v_days      integer := least(greatest(coalesce(p_days, 30), 7), 365);
  v_today     date    := (now() at time zone 'Africa/Lagos')::date;
  v_from_date date;
  v_from      timestamptz;
  v_prev_from timestamptz;
  v_result    jsonb;
begin
  select v.id into my_vendor from public.vendors v where v.profile_id = auth.uid();
  if my_vendor is null then
    return null;  -- not a vendor: nothing to report, not an error
  end if;

  v_from_date := v_today - (v_days - 1);
  v_from      := v_from_date::timestamp at time zone 'Africa/Lagos';
  v_prev_from := (v_from_date - v_days)::timestamp at time zone 'Africa/Lagos';

  with
  sent as (
    select q.id, q.status, q.created_at
    from public.quotes q
    where q.vendor_id = my_vendor
      and q.status <> 'draft'
      and q.created_at >= v_prev_from
  ),
  won_all as (
    select
      o.id,
      o.quote_id,
      greatest(coalesce(o.amount, 0) - coalesce(o.delivery_fee, 0), 0) as value,
      coalesce(o.paid_at, o.placed_at) as at,
      o.fulfillment_status,
      r.school_name
    from public.orders o
    join public.quotes q        on q.id = o.quote_id
    join public.book_requests r on r.id = q.request_id
    where q.vendor_id = my_vendor
      and o.payment_status in ('escrow_held', 'escrow_released', 'paid')
  ),
  won_quote as (select distinct quote_id from won_all),
  cur_sent  as (select * from sent where created_at >= v_from),
  prev_sent as (select * from sent where created_at <  v_from),
  cur_won   as (select * from won_all where at >= v_from),
  prev_won  as (select * from won_all where at >= v_prev_from and at < v_from),
  days as (
    select d::date as day
    from generate_series(v_from_date, v_today, interval '1 day') d
  ),
  daily as (
    select
      d.day,
      (select count(*) from cur_sent s
        where (s.created_at at time zone 'Africa/Lagos')::date = d.day) as quotes,
      (select count(*) from cur_won w
        where (w.at at time zone 'Africa/Lagos')::date = d.day) as orders,
      (select coalesce(sum(w.value), 0) from cur_won w
        where (w.at at time zone 'Africa/Lagos')::date = d.day) as revenue
    from days d
  )
  select jsonb_build_object(
    'period_days', v_days,
    'from', v_from_date,
    'to', v_today,

    'totals', jsonb_build_object(
      'quotes_sent', (select count(*) from cur_sent),
      'orders_won',  (select count(*) from cur_won),
      'revenue',     (select coalesce(sum(value), 0) from cur_won),
      'avg_order_value',
        (select case when count(*) = 0 then 0 else round(sum(value) / count(*), 2) end from cur_won),
      'conversion_rate',
        (select case when count(*) = 0 then null
                else round(count(*) filter (where s.id in (select quote_id from won_quote))::numeric
                           / count(*), 4) end
           from cur_sent s)
    ),

    'previous', jsonb_build_object(
      'quotes_sent', (select count(*) from prev_sent),
      'orders_won',  (select count(*) from prev_won),
      'revenue',     (select coalesce(sum(value), 0) from prev_won),
      'conversion_rate',
        (select case when count(*) = 0 then null
                else round(count(*) filter (where s.id in (select quote_id from won_quote))::numeric
                           / count(*), 4) end
           from prev_sent s)
    ),

    -- How this period's quotes have turned out so far. Every quote lands
    -- in exactly one bucket, so the three add up to quotes_sent.
    'outcomes', (
      select jsonb_build_object(
        'won',      count(*) filter (where s.id in (select quote_id from won_quote)),
        'awaiting', count(*) filter (where s.id not in (select quote_id from won_quote)
                                       and s.status in ('sent', 'accepted')),
        'declined', count(*) filter (where s.id not in (select quote_id from won_quote)
                                       and s.status in ('rejected', 'withdrawn', 'expired'))
      )
      from cur_sent s
    ),

    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day', d.day, 'quotes', d.quotes, 'orders', d.orders, 'revenue', d.revenue
             ) order by d.day), '[]'::jsonb)
      from daily d
    ),

    'top_schools', (
      select coalesce(jsonb_agg(t order by t.revenue desc), '[]'::jsonb)
      from (
        select coalesce(nullif(btrim(school_name), ''), 'Unnamed school') as school_name,
               count(*) as orders,
               sum(value) as revenue
        from cur_won
        group by 1
        order by sum(value) desc
        limit 5
      ) t
    ),

    -- All-time, not the period: "3 orders still to pack" is true now
    -- regardless of which range the shop is looking at.
    'fulfillment', (
      select jsonb_build_object(
        'to_pack',    count(*) filter (where fulfillment_status in ('processing', 'ready')),
        'in_transit', count(*) filter (where fulfillment_status = 'dispatched'),
        'delivered',  count(*) filter (where fulfillment_status = 'delivered')
      )
      from won_all
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.vendor_analytics(integer) from public;
grant execute on function public.vendor_analytics(integer) to authenticated;

commit;

notify pgrst, 'reload schema';
