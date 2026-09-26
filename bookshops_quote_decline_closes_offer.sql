-- BookShops: a quote the buyer declined stays closed
--
-- Run once in the Supabase SQL editor, AFTER bookshops_buyer_decline_quote.sql.
-- Safe to re-run.
--
-- The bug
--   buyer_decline_quote() sets the quote to 'rejected' and, on purpose,
--   leaves the request at 'quoted' (other shops may still win it). But
--   vendor_request_queue() lists every 'pending_quote' / 'quoted' request
--   the shop has not declined ITSELF, so the declined shop got the
--   request straight back in its incoming queue, badged "New Request" or
--   "Pending Quote", as if there were something to do. Opening it and
--   pressing Save would have flipped the rejected quote back to 'sent':
--   nothing on the server stopped a shop updating its own rejected quote.
--
-- The fix
--   1. The queue leaves out any request where this shop's quote was
--      rejected. The quote lives on in vendor_quote_list(), under the
--      Declined tab, with the buyer's reason.
--   2. A rejected quote is final for app users: no update to the quote
--      row...
--   3. ...and no change to its lines.
--
--   "App users" means requests signed in as a buyer or shop (JWT role
--   'authenticated'). The server-side payment flow (service role) and
--   the SQL editor are not blocked, for one real case: a buyer who
--   starts paying, declines, and then completes payment on the Paystack
--   page anyway. finalize_escrow_order() must still be able to record
--   that order; refusing it would leave money taken and no order.
--
--   Nothing about the REQUEST changes. Other shops keep seeing it, and
--   the buyer can still accept another shop's quote.

begin;

-- 1. Queue ------------------------------------------------------------------
create or replace function public.vendor_request_queue()
 returns table(request_id uuid, reference text, school_name text, class_level text,
               created_at timestamp with time zone, item_count bigint, is_targeted boolean,
               my_quote_id uuid, my_quote_status text, customer_name text, customer_phone text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  me uuid := auth.uid();
  my_vendor uuid;
  my_city text;
begin
  select v.id, v.city into my_vendor, my_city
    from public.vendors v
   where v.profile_id = me and v.is_active;

  if my_vendor is null then
    return;  -- not an active vendor: empty queue, no error
  end if;

  return query
  select r.id,
         'REQ-' || upper(substr(replace(r.id::text, '-', ''), 1, 6)),
         r.school_name,
         r.class_level,
         r.created_at,
         (select count(*) from public.book_request_items i where i.request_id = r.id),
         (r.target_vendor_id = my_vendor),
         q.id,
         q.status,
         -- Engagement gate: a quote of ours, or addressed to us.
         case when q.id is not null or r.target_vendor_id = my_vendor
              then p.full_name else null end,
         case when q.id is not null or r.target_vendor_id = my_vendor
              then p.phone_number else null end
    from public.book_requests r
    join public.profiles p on p.id = r.buyer_id
    left join public.quotes q
           on q.request_id = r.id and q.vendor_id = my_vendor
   where r.status in ('pending_quote', 'quoted')
     -- THE routing rule. An open-market request is everyone's; a direct
     -- one belongs to exactly one shop.
     and (r.dispatch_type = 'open_market' or r.target_vendor_id = my_vendor)
     -- The shop turned the request down itself.
     and not exists (
       select 1 from public.request_declines d
        where d.request_id = r.id and d.vendor_id = my_vendor
     )
     -- The buyer turned this shop's quote down. That offer is finished;
     -- it lives on in vendor_quote_list() under Declined, not here.
     and (q.id is null or q.status <> 'rejected')
   -- Addressed to us first, then local work, then newest. City is a
   -- sort and not a filter on purpose: most vendors have no city set,
   -- and filtering on it would empty the queue rather than order it.
   order by (r.target_vendor_id = my_vendor) desc,
            (my_city is not null and p.default_delivery_city = my_city) desc,
            r.created_at desc;
end;
$function$;

-- 2. A rejected quote cannot be edited, re-sent or re-opened -----------------
-- A separate trigger from guard_lump_sum_quote on purpose: this rule is
-- about every quote, not only single-total ones.
create or replace function public.lock_rejected_quote()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if old.status = 'rejected'
     and coalesce(auth.role(), '') in ('authenticated', 'anon')
  then
    raise exception 'The customer declined this quote, so it is closed and can no longer be changed.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists lock_rejected_quote on public.quotes;
create trigger lock_rejected_quote
  before update on public.quotes
  for each row execute function public.lock_rejected_quote();

-- 3. ...nor can its lines ---------------------------------------------------
-- A quote being deleted outright takes its lines with it by cascade; by
-- then the parent row is gone, so this check does not block that.
create or replace function public.lock_rejected_quote_items()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and exists (
       select 1 from public.quotes q
        where q.id in (new.quote_id, old.quote_id)
          and q.status = 'rejected'
     )
  then
    raise exception 'The customer declined this quote, so it is closed and can no longer be changed.'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists lock_rejected_quote_items on public.quote_items;
create trigger lock_rejected_quote_items
  before insert or update or delete on public.quote_items
  for each row execute function public.lock_rejected_quote_items();

commit;

notify pgrst, 'reload schema';
