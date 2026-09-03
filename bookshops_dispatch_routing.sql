-- Bookshops — dispatch routing: open market vs direct to one shop
--
-- Today every published booklist goes to every active vendor.
-- target_vendor_id exists and is written by "Request a quote" on a shop
-- page, but it only sets an `is_targeted` badge — the request is still
-- in every other vendor's queue. A buyer who picks one shop still gets
-- quotes from strangers, which reads as a bug rather than a feature.
--
-- This makes the routing real. Four changes, and the last two are the
-- ones that actually enforce it:
--   1. dispatch_type on book_requests, with a CHECK.
--   2. a constraint tying dispatch_type and target_vendor_id together,
--      so the pair can never disagree.
--   3. vendor_request_queue() rewritten to exclude other vendors'
--      direct requests.
--   4. requests_select_visible tightened to match. Without this the RPC
--      hides a direct request while a plain SELECT still returns it —
--      the queue would be discreet rather than private.
--
-- Region is deliberately NOT a filter here. book_requests carries no
-- region, and no buyer profile currently sets default_delivery_city, so
-- a region predicate would route every open-market request to nobody.
-- The queue sorts same-city work first instead; make it a filter once
-- buyers actually have cities.
--
-- Safe to run as-is. Existing rows are backfilled to match the
-- behaviour they already had.

begin;

-- ============================================================
-- 1. dispatch_type
-- ============================================================
alter table public.book_requests
  add column if not exists dispatch_type text not null default 'open_market';

alter table public.book_requests
  drop constraint if exists book_requests_dispatch_type_check;

alter table public.book_requests
  add constraint book_requests_dispatch_type_check
  check (dispatch_type in ('open_market', 'direct'));

comment on column public.book_requests.dispatch_type is
  'open_market = every approved active vendor may quote it; '
  'direct = only target_vendor_id may see or quote it.';

-- Rows that already name a shop were addressed to it, so they become
-- direct. Everything else keeps the column default. Runs before the
-- constraint below, which would otherwise reject them.
update public.book_requests
   set dispatch_type = 'direct'
 where target_vendor_id is not null
   and dispatch_type <> 'direct';


-- ============================================================
-- 2. The two columns cannot disagree
-- ============================================================
-- A 'direct' row with no target is invisible to everyone including the
-- shop it was meant for; an 'open_market' row with a target is a
-- contradiction the queue would have to guess about. Neither is
-- recoverable at read time, so neither is allowed to exist.
alter table public.book_requests
  drop constraint if exists book_requests_dispatch_target_agree;

alter table public.book_requests
  add constraint book_requests_dispatch_target_agree
  check (
    (dispatch_type = 'direct' and target_vendor_id is not null)
    or (dispatch_type = 'open_market' and target_vendor_id is null)
  );

create index if not exists book_requests_dispatch_idx
  on public.book_requests (dispatch_type, status);

commit;


-- ============================================================
-- 3. The vendor queue
-- ============================================================
-- Same shape as before — the app reads the same columns — with one new
-- predicate and one new sort key.
create or replace function public.vendor_request_queue()
 returns table(
   request_id uuid, reference text, school_name text, class_level text,
   created_at timestamp with time zone, item_count bigint, is_targeted boolean,
   my_quote_id uuid, my_quote_status text, customer_name text, customer_phone text
 )
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
     and not exists (
       select 1 from public.request_declines d
        where d.request_id = r.id and d.vendor_id = my_vendor
     )
   -- Addressed to us first, then local work, then newest. City is a
   -- sort and not a filter on purpose: most vendors have no city set,
   -- and filtering on it would empty the queue rather than order it.
   order by (r.target_vendor_id = my_vendor) desc,
            (my_city is not null and p.default_delivery_city = my_city) desc,
            r.created_at desc;
end;
$function$;


-- ============================================================
-- 4. RLS, so the rule holds outside the RPC too
-- ============================================================
-- The queue function is SECURITY DEFINER and bypasses RLS, so on its own
-- it only decides what the queue SHOWS. This policy is what decides what
-- a vendor can READ — without it, `select * from book_requests` still
-- returns every buyer's direct requests to every vendor.
--
-- Buyers and admins are unchanged. Vendors lose only other shops' direct
-- requests.
drop policy if exists "requests_select_visible" on public.book_requests;

create policy "requests_select_visible"
  on public.book_requests for select
  to authenticated
  using (
    buyer_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'admin'
    )
    or (
      exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role = 'vendor'
      )
      and (
        dispatch_type = 'open_market'
        or target_vendor_id in (
          select v.id from public.vendors v where v.profile_id = (select auth.uid())
        )
      )
    )
  );

notify pgrst, 'reload schema';
