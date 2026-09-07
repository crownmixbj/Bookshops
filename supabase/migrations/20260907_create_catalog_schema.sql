-- Bookshops — product catalogue: categories, products, shop listings
--
-- Until now the schema modelled only the ASK side of the marketplace:
-- what a buyer requests (book_requests / book_request_items) and what a
-- shop quotes back (quotes / quote_items). Nothing recorded what a shop
-- actually sells, so "browse Stationery" had no query behind it and the
-- four category tiles on the hub were hard-coded in lib/mockData.js.
--
-- This adds the SELL side:
--
--   categories     the browsable groupings (seeded below)
--   products       a canonical title, one row per book or item
--   shop_listings  what one shop charges for one product, and whether
--                  it is in stock — the join that makes a catalogue
--
-- products is deliberately shop-agnostic. Two shops stocking "New
-- General Mathematics" point at ONE product row, which is what lets the
-- app answer "who sells this, and for how much" — the question free-text
-- titles on book_request_items and quote_items cannot answer today.
--
-- Safe to run more than once: every object is guarded, and the seed is
-- ON CONFLICT DO NOTHING.

begin;

-- ============================================================
-- 1. categories
-- ============================================================
create table if not exists public.categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 1 and 120),
  -- The URL segment: /categories/stationery. Lower-case, hyphenated,
  -- and checked, because a slug with a space in it is a broken route
  -- rather than a tidy-up job for later.
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description   text,
  image_url     text,
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.categories is
  'Browsable groupings for the buyer catalogue. Ordered by display_order, then name.';

create index if not exists categories_order_idx
  on public.categories (display_order, name);

-- ============================================================
-- 2. products
-- ============================================================
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  -- set null, not cascade: deleting a category must not delete the
  -- books filed under it. An uncategorised product is still a product.
  category_id uuid references public.categories (id) on delete set null,
  title       text not null check (length(trim(title)) between 1 and 300),
  description text,
  author      text,
  publisher   text,
  isbn        text,
  image_url   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.products is
  'Canonical catalogue entries. One row per distinct book or item, shared by every shop that stocks it.';

create index if not exists products_category_idx on public.products (category_id);

-- One row per real ISBN. Partial, so the many products without one are
-- unaffected — a school uniform has no ISBN and never will.
create unique index if not exists products_isbn_key
  on public.products (isbn)
  where isbn is not null and length(trim(isbn)) > 0;

-- Backs "search the catalogue" without a separate search service.
create index if not exists products_title_search_idx
  on public.products using gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(author, '')));

-- ============================================================
-- 3. shop_listings
-- ============================================================
-- The shop table in this schema is `vendors`; there is no `shops`.
create table if not exists public.shop_listings (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.vendors (id) on delete cascade,
  product_id     uuid not null references public.products (id) on delete cascade,
  -- Naira, to the kobo. Matches quotes.total_price / quote_items.unit_price.
  price          numeric(10,2) not null check (price >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  is_available   boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- A shop lists a product once. Without this the same book appears
  -- twice at two prices and there is no answer to "what does this shop
  -- charge for it".
  unique (shop_id, product_id)
);

comment on table public.shop_listings is
  'What one shop charges for one product. Unique per (shop, product).';

create index if not exists shop_listings_product_idx on public.shop_listings (product_id);
create index if not exists shop_listings_shop_idx on public.shop_listings (shop_id);

-- The buyer-facing query is "available listings for this product,
-- cheapest first". Partial so it stays small as dead stock accumulates.
create index if not exists shop_listings_available_idx
  on public.shop_listings (product_id, price)
  where is_available;

-- ============================================================
-- 4. updated_at triggers
-- ============================================================
drop trigger if exists touch_categories on public.categories;
create trigger touch_categories
  before update on public.categories
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_products on public.products;
create trigger touch_products
  before update on public.products
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_shop_listings on public.shop_listings;
create trigger touch_shop_listings
  before update on public.shop_listings
  for each row execute function public.touch_updated_at();

-- ============================================================
-- 5. Row Level Security
-- ============================================================
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.shop_listings enable row level security;

-- ---- categories: readable by anyone, writable by admins -----
drop policy if exists categories_select_public on public.categories;
create policy categories_select_public
  on public.categories for select
  to public
  using (true);

drop policy if exists categories_write_admin on public.categories;
create policy categories_write_admin
  on public.categories for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---- products: readable by anyone, writable by admins -------
-- Admin-only on purpose. products is the CANONICAL list: if every
-- vendor could add rows freely you get six spellings of "New General
-- Mathematics" and the shared-product model — the whole point of the
-- table — stops working. Vendor-proposed products belong behind a
-- review queue, which is a later migration, not an open INSERT.
drop policy if exists products_select_public on public.products;
create policy products_select_public
  on public.products for select
  to public
  using (true);

drop policy if exists products_write_admin on public.products;
create policy products_write_admin
  on public.products for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---- shop_listings ------------------------------------------
-- Public read is narrower than "all rows". A listing is visible only
-- when the shop has marked it available AND the shop itself is one a
-- buyer may see — the same test vendors_select_active applies. Without
-- the vendor clause a buyer would be shown prices from shops that are
-- deactivated or not yet approved, and could not open the shop behind
-- the price.
drop policy if exists shop_listings_select_public on public.shop_listings;
create policy shop_listings_select_public
  on public.shop_listings for select
  to public
  using (
    is_available
    and exists (
      select 1 from public.vendors v
       where v.id = shop_listings.shop_id
         and v.is_active
         and v.approval_status = 'approved'
    )
  );

-- A shop sees and edits its own listings, available or not — otherwise
-- unticking "in stock" would hide the row from the shop that owns it
-- and they could never tick it back.
drop policy if exists shop_listings_all_own_vendor on public.shop_listings;
create policy shop_listings_all_own_vendor
  on public.shop_listings for all
  to authenticated
  using (
    exists (
      select 1 from public.vendors v
       where v.id = shop_listings.shop_id
         and v.profile_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.vendors v
       where v.id = shop_listings.shop_id
         and v.profile_id = (select auth.uid())
    )
  );

drop policy if exists shop_listings_select_admin on public.shop_listings;
create policy shop_listings_select_admin
  on public.shop_listings for select
  to authenticated
  using (public.is_admin());

-- ============================================================
-- 6. Seed: the four categories the hub already shows
-- ============================================================
-- Same names, slugs and order as lib/mockData.js, so the tiles do not
-- move or rename when the app switches from the built-in list to these
-- rows. image_url is left null deliberately: the card falls back to a
-- tinted block and an Ionicons glyph, which is honest, and a stock
-- photograph of somebody else's stationery is not.
insert into public.categories (name, slug, description, display_order)
values
  ('Stationery',   'stationery',   'Pens, notebooks, sets',    1),
  ('Uniforms',     'uniforms',     'By school and size',       2),
  ('School Shoes', 'school-shoes', 'Black leather, sandals',   3),
  ('New Arrivals', 'new-arrivals', 'Fresh this term',          4)
on conflict (slug) do nothing;

commit;

-- PostgREST caches the schema; without this the new tables are reported
-- as "Could not find the table 'public.categories' in the schema cache"
-- until the next restart.
notify pgrst, 'reload schema';
