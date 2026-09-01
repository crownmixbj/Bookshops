-- Bookshops — saved shops, browsing history, and earned vendor reputation
--
-- Adds what the Saved Shops page needs, and does the reputation part
-- properly: a vendor's rating comes from buyers who actually received an
-- order, and the completed-order count is maintained by the database
-- rather than typed in by hand.
--
-- The counter columns exist for a specific reason. `orders_select_own`
-- restricts a buyer to their own orders, so a buyer genuinely cannot
-- count a vendor's deliveries across all buyers — the aggregate has to
-- be maintained by a trigger and stored on the vendor row, where
-- `vendors_select_active` already makes it readable.
--
-- Safe to run: new tables, new nullable columns, new triggers. The
-- backfills at the end are no-ops on empty tables.

begin;

-- ============================================================
-- 1. Saved shops
-- ============================================================
create table if not exists public.saved_shops (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  vendor_id  uuid not null references public.vendors (id)  on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, vendor_id)
);

comment on table public.saved_shops is
  'A buyer''s bookmarked vendors. Composite primary key makes saving twice a no-op rather than a duplicate.';

create index if not exists saved_shops_profile_idx
  on public.saved_shops (profile_id, created_at desc);

alter table public.saved_shops enable row level security;

-- A person may only see and change their own bookmarks. Note this is
-- deliberately NOT readable by vendors: which buyers have saved a shop
-- is the buyer's business.
create policy "saved_shops_select_own" on public.saved_shops for select
  to authenticated using (profile_id = (select auth.uid()));
create policy "saved_shops_insert_own" on public.saved_shops for insert
  to authenticated with check (profile_id = (select auth.uid()));
create policy "saved_shops_delete_own" on public.saved_shops for delete
  to authenticated using (profile_id = (select auth.uid()));


-- ============================================================
-- 2. Recently viewed
-- ============================================================
create table if not exists public.recently_viewed_shops (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  vendor_id  uuid not null references public.vendors (id)  on delete cascade,
  viewed_at  timestamptz not null default now(),
  primary key (profile_id, vendor_id)
);

comment on table public.recently_viewed_shops is
  'Browsing history, one row per vendor per person. Upsert on view so revisiting moves it to the top instead of growing the table.';

create index if not exists recently_viewed_profile_idx
  on public.recently_viewed_shops (profile_id, viewed_at desc);

alter table public.recently_viewed_shops enable row level security;

create policy "recently_viewed_select_own" on public.recently_viewed_shops for select
  to authenticated using (profile_id = (select auth.uid()));
create policy "recently_viewed_upsert_own" on public.recently_viewed_shops for insert
  to authenticated with check (profile_id = (select auth.uid()));
create policy "recently_viewed_update_own" on public.recently_viewed_shops for update
  to authenticated using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));
create policy "recently_viewed_delete_own" on public.recently_viewed_shops for delete
  to authenticated using (profile_id = (select auth.uid()));


-- ============================================================
-- 3. Vendor reputation columns
-- ============================================================
alter table public.vendors
  add column if not exists verified_at      timestamptz,
  add column if not exists rating           numeric(2,1) check (rating is null or (rating >= 1 and rating <= 5)),
  add column if not exists review_count     integer not null default 0 check (review_count >= 0),
  add column if not exists completed_orders integer not null default 0 check (completed_orders >= 0);

comment on column public.vendors.verified_at is
  'Set by an administrator once the shop''s identity and address are checked. Null means unverified — it is not the same as is_active.';
comment on column public.vendors.rating is
  'Derived from vendor_reviews by trigger. Never write this directly.';
comment on column public.vendors.completed_orders is
  'Maintained by trigger when an order reaches delivered. Stored because RLS stops a buyer counting other buyers'' orders.';


-- ============================================================
-- 4. Reviews — a rating has to be earned
-- ============================================================
create table if not exists public.vendor_reviews (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null unique references public.orders (id) on delete cascade,
  vendor_id  uuid not null references public.vendors (id) on delete cascade,
  buyer_id   uuid not null references public.profiles (id) on delete cascade,
  rating     integer not null check (rating between 1 and 5),
  comment    text check (comment is null or length(comment) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.vendor_reviews is
  'One review per order. The unique constraint on order_id is what stops a buyer inflating a rating by reviewing the same order repeatedly.';

create index if not exists vendor_reviews_vendor_idx on public.vendor_reviews (vendor_id);

alter table public.vendor_reviews enable row level security;

-- Ratings are public to signed-in users: they are the point of a rating.
create policy "vendor_reviews_select_all" on public.vendor_reviews for select
  to authenticated using (true);

-- A buyer may review only an order that is theirs AND was delivered.
-- Checking this in the policy means the rule holds even if the app
-- forgets to, which is the whole reason to put it here.
create policy "vendor_reviews_insert_delivered_own" on public.vendor_reviews for insert
  to authenticated
  with check (
    buyer_id = (select auth.uid())
    and exists (
      select 1
        from public.orders o
        join public.quotes q on q.id = o.quote_id
       where o.id = vendor_reviews.order_id
         and o.buyer_id = (select auth.uid())
         and o.fulfillment_status = 'delivered'
         and q.vendor_id = vendor_reviews.vendor_id
    )
  );

create policy "vendor_reviews_update_own" on public.vendor_reviews for update
  to authenticated
  using (buyer_id = (select auth.uid()))
  with check (buyer_id = (select auth.uid()));

drop trigger if exists touch_vendor_reviews on public.vendor_reviews;
create trigger touch_vendor_reviews
  before update on public.vendor_reviews
  for each row execute function public.touch_updated_at();


-- ============================================================
-- 5. Keep the aggregates correct
-- ============================================================
-- SECURITY DEFINER because the person triggering these has no rights to
-- UPDATE a vendor row — vendors_update_own restricts that to the owner.
-- Recomputing from scratch rather than incrementing keeps the figure
-- right even after an edit or a delete.
create or replace function public.refresh_vendor_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := coalesce(new.vendor_id, old.vendor_id);
begin
  update public.vendors v
     set rating = sub.avg_rating,
         review_count = sub.n
    from (
      select round(avg(rating)::numeric, 1) as avg_rating, count(*) as n
        from public.vendor_reviews
       where vendor_id = target
    ) sub
   where v.id = target;
  return null;
end;
$$;

drop trigger if exists refresh_vendor_rating on public.vendor_reviews;
create trigger refresh_vendor_rating
  after insert or update or delete on public.vendor_reviews
  for each row execute function public.refresh_vendor_rating();

create or replace function public.bump_vendor_completed_orders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  -- Only on the transition INTO delivered, so re-saving a delivered
  -- order never double-counts.
  if new.fulfillment_status = 'delivered'
     and old.fulfillment_status is distinct from 'delivered' then
    select q.vendor_id into target
      from public.quotes q where q.id = new.quote_id;
    if target is not null then
      update public.vendors set completed_orders = completed_orders + 1 where id = target;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists bump_vendor_completed_orders on public.orders;
create trigger bump_vendor_completed_orders
  after update on public.orders
  for each row execute function public.bump_vendor_completed_orders();


-- ============================================================
-- 6. Sending a booklist to a specific shop
-- ============================================================
-- "Request Quote" on a saved shop needs the request to name the vendor
-- it was sent to. Nullable: an open request with no target is still the
-- normal case, and every active vendor can already see it.
alter table public.book_requests
  add column if not exists target_vendor_id uuid references public.vendors (id) on delete set null;

create index if not exists book_requests_target_vendor_idx
  on public.book_requests (target_vendor_id) where target_vendor_id is not null;

comment on column public.book_requests.target_vendor_id is
  'Set when a buyer sends a booklist to one shop from Saved Shops. Null means an open request to the whole marketplace.';


-- ============================================================
-- 7. Backfill (no-ops on empty tables)
-- ============================================================
update public.vendors v
   set completed_orders = coalesce(sub.n, 0)
  from (
    select q.vendor_id, count(*) as n
      from public.orders o
      join public.quotes q on q.id = o.quote_id
     where o.fulfillment_status = 'delivered'
     group by q.vendor_id
  ) sub
 where v.id = sub.vendor_id;

commit;

notify pgrst, 'reload schema';
