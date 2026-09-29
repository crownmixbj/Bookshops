-- Bookshops — where a booklist is being delivered to
--
-- Run once in the Supabase SQL editor, AFTER
-- bookshops_quote_claims_and_limits.sql and bookshops_buyer_portal.sql
-- (delivery_addresses). Safe to re-run.
--
-- Shops already quote a delivery fee (bookshops_quote_delivery_fee.sql),
-- but until now they were pricing delivery blind: nothing on a booklist
-- said where it was going. This stores the destination with the list.
--
--   book_request_delivery   one row per booklist: a snapshot of the
--                           address (copied, not linked, so editing an
--                           address in Settings later cannot move a
--                           delivery a shop has already priced), plus
--                           the saved address it came from, if any.
--
-- Who can see it:
--   * the buyer, always;
--   * a shop, only once the list is actually its work: sent directly to
--     it, claimed by it from the open pool, or already quoted by it.
--     Before that, the queue shows the AREA only (vendor_request_queue's
--     new delivery_area column) — enough to decide whether to take the
--     job, without handing every shop in the pool a parent's street
--     address and phone number.
--
-- Who can change it: the buyer, while the list is a draft or waiting for
-- its first quote. Once a shop has quoted, its delivery fee was priced
-- to this address, so it is fixed from then on.
--
-- Lists sent without an address (sent from My Booklists, or by an older
-- app build) get the buyer's default saved address copied in as they go
-- out, so a shop is not left guessing whenever one exists.

begin;

-- ============================================================
-- 1. The table
-- ============================================================
create table if not exists public.book_request_delivery (
  request_id     uuid primary key references public.book_requests (id) on delete cascade,
  -- The saved address this was copied from. Null for a one-off address.
  address_id     uuid references public.delivery_addresses (id) on delete set null,
  -- True when the buyer chose "Deliver to a different address".
  is_alternate   boolean not null default false,
  recipient_name text check (recipient_name is null or length(recipient_name) <= 120),
  phone          text check (phone is null or length(phone) <= 40),
  address        text not null check (length(btrim(address)) between 3 and 300),
  city           text not null check (length(btrim(city)) between 2 and 80),
  state          text check (state is null or length(state) <= 80),
  landmark       text check (landmark is null or length(landmark) <= 200),
  notes          text check (notes is null or length(notes) <= 300),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.book_request_delivery is
  'Where a booklist is to be delivered. A snapshot, so shops price delivery to a fixed destination.';

drop trigger if exists touch_book_request_delivery on public.book_request_delivery;
create trigger touch_book_request_delivery before update on public.book_request_delivery
  for each row execute function public.touch_updated_at();

alter table public.book_request_delivery enable row level security;
grant select, insert, update, delete on public.book_request_delivery to authenticated;
revoke all on public.book_request_delivery from anon;


-- ============================================================
-- 2. Access rules
-- ============================================================
-- A shop may see the full address once the list is its work.
create or replace function public.vendor_can_see_request_delivery(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.vendors v
      join public.book_requests r on r.id = p_request_id
     where v.profile_id = auth.uid()
       and (
         r.target_vendor_id = v.id
         or public.request_claim_holder(r.id) = v.id
         or exists (select 1 from public.quotes q
                     where q.request_id = r.id and q.vendor_id = v.id)
       )
  );
$$;

revoke all on function public.vendor_can_see_request_delivery(uuid) from public, anon;
grant execute on function public.vendor_can_see_request_delivery(uuid) to authenticated;

-- The buyer may change it only before any shop has priced it.
create or replace function public.buyer_can_edit_request_delivery(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.book_requests r
     where r.id = p_request_id
       and r.buyer_id = auth.uid()
       and r.status in ('draft', 'pending_quote')
  );
$$;

revoke all on function public.buyer_can_edit_request_delivery(uuid) from public, anon;
grant execute on function public.buyer_can_edit_request_delivery(uuid) to authenticated;

drop policy if exists book_request_delivery_select on public.book_request_delivery;
create policy book_request_delivery_select on public.book_request_delivery
  for select to authenticated
  using (
    exists (select 1 from public.book_requests r
             where r.id = request_id and r.buyer_id = (select auth.uid()))
    or public.vendor_can_see_request_delivery(request_id)
    or public.is_admin()
  );

drop policy if exists book_request_delivery_insert on public.book_request_delivery;
create policy book_request_delivery_insert on public.book_request_delivery
  for insert to authenticated
  with check (public.buyer_can_edit_request_delivery(request_id));

drop policy if exists book_request_delivery_update on public.book_request_delivery;
create policy book_request_delivery_update on public.book_request_delivery
  for update to authenticated
  using (public.buyer_can_edit_request_delivery(request_id))
  with check (public.buyer_can_edit_request_delivery(request_id));

drop policy if exists book_request_delivery_delete on public.book_request_delivery;
create policy book_request_delivery_delete on public.book_request_delivery
  for delete to authenticated
  using (public.buyer_can_edit_request_delivery(request_id));

-- A saved address may only be referenced by its owner.
create or replace function public.guard_request_delivery_address()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.address_id is not null and not exists (
    select 1 from public.delivery_addresses a
      join public.book_requests r on r.id = new.request_id
     where a.id = new.address_id and a.profile_id = r.buyer_id
  ) then
    new.address_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_request_delivery_address on public.book_request_delivery;
create trigger guard_request_delivery_address
  before insert or update of address_id on public.book_request_delivery
  for each row execute function public.guard_request_delivery_address();


-- ============================================================
-- 3. Fallback: the default address, as a list goes out
-- ============================================================
create or replace function public.fill_request_delivery_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status not in ('pending_quote', 'quoted') then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status in ('pending_quote', 'quoted') then
    return null;  -- was already out; nothing new to fill
  end if;
  if exists (select 1 from public.book_request_delivery d where d.request_id = new.id) then
    return null;
  end if;

  insert into public.book_request_delivery
    (request_id, address_id, recipient_name, phone, address, city, state, landmark)
  select new.id, a.id, a.recipient_name, a.phone, a.address, a.city, a.state, a.landmark
    from public.delivery_addresses a
   where a.profile_id = new.buyer_id
     and length(btrim(coalesce(a.address, ''))) >= 3
     and length(btrim(coalesce(a.city, ''))) >= 2
   order by a.is_default desc, a.updated_at desc
   limit 1
  on conflict (request_id) do nothing;

  return null;
end;
$$;

drop trigger if exists fill_request_delivery_default on public.book_requests;
create trigger fill_request_delivery_default
  after insert or update of status on public.book_requests
  for each row execute function public.fill_request_delivery_default();

-- Lists already waiting for quotes get the same treatment now.
insert into public.book_request_delivery
  (request_id, address_id, recipient_name, phone, address, city, state, landmark)
select distinct on (r.id) r.id, a.id, a.recipient_name, a.phone, a.address, a.city, a.state, a.landmark
  from public.book_requests r
  join public.delivery_addresses a on a.profile_id = r.buyer_id
 where r.status in ('pending_quote', 'quoted')
   and length(btrim(coalesce(a.address, ''))) >= 3
   and length(btrim(coalesce(a.city, ''))) >= 2
 order by r.id, a.is_default desc, a.updated_at desc
on conflict (request_id) do nothing;


-- ============================================================
-- 4. The vendor queue: the delivery AREA for every row
-- ============================================================
-- One new column, delivery_area, so the old signature must go first.
drop function if exists public.vendor_request_queue();

create function public.vendor_request_queue()
 returns table(request_id uuid, reference text, school_name text, class_level text,
               created_at timestamp with time zone, item_count bigint, is_targeted boolean,
               my_quote_id uuid, my_quote_status text, customer_name text, customer_phone text,
               claimed_by_me boolean, claim_expires_at timestamp with time zone,
               delivery_area text)
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
         -- Engagement gate: a quote of ours, addressed to us, or claimed by us.
         case when q.id is not null or r.target_vendor_id = my_vendor or c.holder = my_vendor
              then p.full_name else null end,
         case when q.id is not null or r.target_vendor_id = my_vendor or c.holder = my_vendor
              then p.phone_number else null end,
         (c.holder = my_vendor),
         case when c.holder = my_vendor and coalesce(q.status, '') not in ('sent', 'accepted')
              then r.claimed_at + interval '24 hours' else null end,
         -- Area only (city, state) — never the street — for every row.
         nullif(concat_ws(', ', nullif(btrim(d.city), ''), nullif(btrim(d.state), '')), '')
    from public.book_requests r
    join public.profiles p on p.id = r.buyer_id
    left join public.quotes q
           on q.request_id = r.id and q.vendor_id = my_vendor
    left join public.book_request_delivery d on d.request_id = r.id
    cross join lateral (select public.request_claim_holder(r.id) as holder) c
   where r.status in ('pending_quote', 'quoted')
     and (r.dispatch_type = 'open_market' or r.target_vendor_id = my_vendor)
     and not exists (
       select 1 from public.request_declines dd
        where dd.request_id = r.id and dd.vendor_id = my_vendor
     )
     and (q.id is null or q.status <> 'rejected')
     and (
       r.dispatch_type <> 'open_market'
       or c.holder is null
       or c.holder = my_vendor
       or q.status in ('sent', 'accepted')
     )
   order by (r.target_vendor_id = my_vendor) desc,
            (c.holder = my_vendor) desc,
            -- Local work first, now judged by where the books are going.
            (my_city is not null
               and lower(btrim(coalesce(d.city, p.default_delivery_city, ''))) = lower(btrim(my_city))) desc,
            r.created_at desc;
end;
$function$;

revoke all on function public.vendor_request_queue() from public, anon;
grant execute on function public.vendor_request_queue() to authenticated;

commit;

notify pgrst, 'reload schema';
