-- Bookshops — a buyer can decline a quote
--
-- WHAT IS ALREADY HERE
--
-- quotes.status already allows 'rejected':
--
--   CHECK (status in ('draft','sent','accepted','rejected','withdrawn','expired'))
--
-- and both quote UIs already render it as the word "Declined" —
-- hooks/useShopQuotes.ts maps rejected -> 'declined' for the buyer, and
-- hooks/useVendorQuotes.ts maps it the same way for the shop, which is
-- why the vendor's "Declined" tab exists. Nothing has ever written the
-- value, so that tab has always been empty.
--
-- So this migration adds NO new status. A second value meaning the same
-- thing as 'rejected' would guarantee that some query filters on one and
-- silently misses the other, and there is no query in the app that would
-- read them differently.
--
-- The division of labour, now that both sides can end a quote:
--   rejected   the BUYER said no
--   withdrawn  the SHOP pulled it back
--   expired    nobody acted in time
--
-- WHAT IT ADDS
--
--   1. quotes.decline_reason  — the buyer's optional sentence.
--   2. buyer_decline_quote()  — the only way a buyer may write to quotes.
--
-- WHY A FUNCTION AND NOT A POLICY
--
-- The obvious move is a buyer UPDATE policy on quotes. It is also a hole:
-- a row-level policy cannot restrict WHICH COLUMNS an update touches, so
-- any buyer allowed to set status='rejected' is equally allowed to set
-- total_price=1 and then accept it. Postgres has column privileges, but
-- they are granted per-role, not per-row, so they cannot express "this
-- buyer, this quote".
--
-- A security definer function is the only construct that grants exactly
-- one transition and nothing else. The buyer gets no UPDATE on quotes at
-- all; they get permission to call this, which does one specific thing.
--
-- Safe to run more than once.

begin;

-- ============================================================
-- 1. the reason
-- ============================================================
alter table public.quotes
  add column if not exists decline_reason text;

alter table public.quotes
  drop constraint if exists quotes_decline_reason_length;

-- Same 500-character ceiling as request_declines.reason, so the two
-- free-text fields in the quoting flow cannot disagree about what fits.
alter table public.quotes
  add constraint quotes_decline_reason_length
  check (decline_reason is null or length(decline_reason) <= 500);

comment on column public.quotes.decline_reason is
  'Optional sentence the buyer gave when declining. Null for every other '
  'status, and for a decline they chose not to explain.';

commit;


-- ============================================================
-- 2. the one transition a buyer may make
-- ============================================================
create or replace function public.buyer_decline_quote(
  p_quote_id uuid,
  p_reason   text default null
)
 returns void
 language plpgsql
 security definer
 -- Empty search_path, every object schema-qualified: a definer function
 -- that resolves names through the caller's path is the classic
 -- privilege-escalation hole.
 set search_path to ''
as $function$
declare
  v_owner   uuid;
  v_status  text;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  -- Ownership and current status in one lock. FOR UPDATE matters: two
  -- taps on a slow connection would otherwise both read 'sent' and both
  -- write, and the second would overwrite the first one's reason.
  select r.buyer_id, q.status
    into v_owner, v_status
    from public.quotes q
    join public.book_requests r on r.id = q.request_id
   where q.id = p_quote_id
   for update of q;

  if not found then
    raise exception 'That quote no longer exists.'
      using errcode = 'no_data_found';
  end if;

  -- Deliberately the same message as a wrong owner would get. Telling a
  -- stranger "that quote exists but is not yours" confirms the id is
  -- real, which is a little more than they need to know.
  if v_owner is distinct from auth.uid() then
    raise exception 'That quote no longer exists.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Only a live offer can be declined. An accepted quote has been paid
  -- for and belongs to an order; a withdrawn or expired one is already
  -- finished; a draft was never sent and is not the buyer's to see.
  if v_status <> 'sent' then
    raise exception 'This quote can no longer be declined — it is %.', v_status
      using errcode = 'invalid_parameter_value';
  end if;

  update public.quotes
     set status = 'rejected',
         decline_reason = v_reason,
         updated_at = now()
   where id = p_quote_id;

  -- The request is deliberately NOT touched. Declining one shop's offer
  -- does not un-quote the booklist: other shops may have quoted it too,
  -- and the buyer may still accept one of those. If this was the only
  -- quote the request simply sits at 'quoted' with nothing outstanding,
  -- which is true — it was quoted, and the buyer said no.
end;
$function$;

comment on function public.buyer_decline_quote(uuid, text) is
  'Lets the buyer who owns a request decline one sent quote against it. '
  'The only write a buyer may make to quotes: there is no buyer UPDATE '
  'policy, because a row policy cannot stop them editing total_price.';

revoke all on function public.buyer_decline_quote(uuid, text) from public;
grant execute on function public.buyer_decline_quote(uuid, text) to authenticated;

notify pgrst, 'reload schema';


-- ============================================================
-- 3. the shop needs to see it
-- ============================================================
-- hooks/useVendorQuotes.ts already maps 'rejected' onto its "Declined"
-- tab, so a declined quote lands in the right place the moment one
-- exists. What it cannot show is WHY, because vendor_quote_list() does
-- not return the reason — so the shop learns it lost the job and
-- nothing else, which is the one piece of information that would let
-- them price the next one better.
--
-- CREATE OR REPLACE cannot add a column to a RETURNS TABLE — Postgres
-- refuses to change an existing function's return type — so this drops
-- and recreates. Inside the transaction, so the function is never
-- missing from another session's point of view.
begin;

drop function if exists public.vendor_quote_list();

create function public.vendor_quote_list()
 returns table(
   quote_id uuid, request_id uuid, reference text, quote_status text,
   school_name text, class_level text, customer_name text, customer_phone text,
   total_price numeric, quoted_item_count bigint, requested_item_count bigint,
   unavailable_count bigint, order_id uuid, order_fulfillment_status text,
   is_targeted boolean, decline_reason text,
   created_at timestamp with time zone, updated_at timestamp with time zone
 )
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  me uuid := auth.uid();
  my_vendor uuid;
begin
  -- Not scoped to is_active, unlike the request queue. A shop that has
  -- paused trading still needs to see the quotes it has out; hiding them
  -- would look like the work had been lost.
  select v.id into my_vendor
    from public.vendors v
   where v.profile_id = me;

  if my_vendor is null then
    return;  -- not a vendor: empty list, no error
  end if;

  return query
  select q.id,
         r.id,
         'REQ-' || upper(substr(replace(r.id::text, '-', ''), 1, 6)),
         q.status,
         r.school_name,
         r.class_level,
         -- No engagement gate here: every row IS a quote this vendor
         -- wrote, which is the engagement vendor_request_queue() tests
         -- for. Withholding the name now would hide the customer from
         -- the shop already dealing with them.
         p.full_name,
         p.phone_number,
         q.total_price,
         -- Quoted vs requested: what this vendor priced against what the
         -- buyer asked for. They differ when a line was marked out of
         -- stock, which is the number a vendor most wants to see again.
         (select count(*) from public.quote_items qi
           where qi.quote_id = q.id and qi.is_available),
         (select count(*) from public.book_request_items i
           where i.request_id = r.id),
         (select count(*) from public.quote_items qi
           where qi.quote_id = q.id and not qi.is_available),
         o.id,
         o.fulfillment_status,
         (r.target_vendor_id = my_vendor),
         -- Only on a buyer decline. 'withdrawn' is the shop's own doing
         -- and 'expired' is nobody's, so neither carries a reason, and
         -- surfacing a stale one against them would be misleading.
         case when q.status = 'rejected' then q.decline_reason else null end,
         q.created_at,
         q.updated_at
    from public.quotes q
    join public.book_requests r on r.id = q.request_id
    join public.profiles p on p.id = r.buyer_id
    -- At most one order per quote in practice; left join so an unordered
    -- quote still returns a row.
    left join public.orders o on o.quote_id = q.id
   where q.vendor_id = my_vendor
   order by q.updated_at desc;
end;
$function$;

revoke all on function public.vendor_quote_list() from public;
grant execute on function public.vendor_quote_list() to authenticated;

commit;

notify pgrst, 'reload schema';
