-- Bookshops — the vendor's "My Booklists" page
--
-- A vendor needs to see the lists they have quoted on, with the
-- customer's name on each. They cannot get that from the client: the
-- only SELECT policies on `profiles` are profiles_select_own and
-- profiles_select_admin, so a vendor joining profiles gets null for
-- every row and the page renders nameless cards.
--
-- So the same shape as vendor_request_queue(): one SECURITY DEFINER
-- function with a fixed column list and an ownership check, rather than
-- a new policy opening `profiles` to any join a vendor cares to write.
--
-- Being definer also fixes a subtler case. requests_select_visible lets
-- a vendor read a request only while it is open_market or addressed to
-- them, so a buyer who re-routes a list to a different shop would erase
-- it from the first vendor's history — including quotes they had
-- already spent time preparing. History should not rewrite itself.
--
-- Creates one function. No table or policy changes.

create or replace function public.vendor_quote_list()
 returns table(
   quote_id uuid,
   request_id uuid,
   reference text,
   quote_status text,
   school_name text,
   class_level text,
   customer_name text,
   customer_phone text,
   total_price numeric,
   quoted_item_count bigint,
   requested_item_count bigint,
   unavailable_count bigint,
   order_id uuid,
   order_fulfillment_status text,
   is_targeted boolean,
   created_at timestamp with time zone,
   updated_at timestamp with time zone
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

comment on function public.vendor_quote_list() is
  'Every quote this vendor has written, with the customer and both item '
  'counts. SECURITY DEFINER because profiles has no vendor-facing SELECT '
  'policy; ownership is enforced by the vendor_id filter inside.';

-- Definer functions are executable by PUBLIC by default; be explicit
-- about who may call it. The body returns nothing for a non-vendor
-- anyway, but the grant should say so too.
revoke all on function public.vendor_quote_list() from public;
grant execute on function public.vendor_quote_list() to authenticated;

notify pgrst, 'reload schema';
