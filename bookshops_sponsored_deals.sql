-- Bookshops — sponsored deals: the dashboard's promo slot
--
-- The right-hand column of the buyer dashboard is a permanent promo
-- slot. Its first choice is one paid placement from a bookshop ("15% off JSS1–JSS3
-- booklists this week"). This file is where those placements live.
--
-- Three rules this schema exists to keep:
--
--   1. A deal is always labelled as sponsored. The badge text comes from
--      `badge` and can only be one of the two honest labels.
--   2. A deal is only shown inside its own window (starts_at..ends_at) and
--      only for a shop a buyer could actually order from — approved and
--      active. A suspended shop's paid slot goes dark with the shop.
--   3. Only an admin creates or edits deals. Buyers and vendors read the
--      one current deal through current_sponsored_deal() and nothing else.
--
-- Nothing is seeded. With no live deal the slot falls back, in order, to
-- a top-rated shop (top_organic_shop, shown unlabelled because nobody paid
-- for it) and then to LOCI's own cards — never to an invented sponsor.
-- An example insert is at the bottom, commented out.
--
-- Safe to run more than once.

begin;

create table if not exists public.sponsored_deals (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references public.vendors(id) on delete cascade,
  badge         text not null default 'SPONSORED'
                  check (badge in ('SPONSORED', 'FEATURED DEAL')),
  -- The offer itself, e.g. "15% OFF JSS1–JSS3 booklists this week!"
  headline      text not null check (length(btrim(headline)) between 4 and 90),
  -- Optional small print: what it applies to, how to claim it.
  details       text check (details is null or length(details) <= 240),
  -- Optional https image (shop front or logo). Vendors have no logo
  -- column yet, so the card falls back to the shop's initial.
  image_url     text check (image_url is null or image_url ~* '^https://'),
  -- Optional: shown as a pill ("JSS1–JSS3"); purely descriptive.
  audience      text check (audience is null or length(audience) <= 40),
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz not null,
  -- Higher wins when several deals are live at once; ties rotate.
  priority      integer not null default 0,
  is_active     boolean not null default true,
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint sponsored_deals_window check (ends_at > starts_at)
);

comment on table public.sponsored_deals is
  'Paid promo placements for the buyer dashboard. Admin-managed; read through current_sponsored_deal().';

create index if not exists sponsored_deals_live_idx
  on public.sponsored_deals (ends_at, starts_at) where is_active;

alter table public.sponsored_deals enable row level security;

-- Admins manage everything. No buyer/vendor policies: the RPC below is
-- the only read path for them, so a deal scheduled for next week cannot
-- be listed early by querying the table.
drop policy if exists sponsored_deals_admin_all on public.sponsored_deals;
create policy sponsored_deals_admin_all on public.sponsored_deals
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop trigger if exists touch_sponsored_deals on public.sponsored_deals;
create trigger touch_sponsored_deals before update on public.sponsored_deals
  for each row execute function public.touch_updated_at();

-- The one deal to show right now, with the shop's public card details.
-- Definer-rights so guests (anon) see it too: vendors_select_active is
-- authenticated-only, and a promo slot that only signed-in buyers can
-- see would miss the people most worth reaching.
create or replace function public.current_sponsored_deal()
returns table (
  deal_id      uuid,
  badge        text,
  headline     text,
  details      text,
  image_url    text,
  audience     text,
  ends_at      timestamptz,
  vendor_id    uuid,
  store_name   text,
  city         text,
  rating       numeric,
  review_count integer,
  verified     boolean
)
language sql
volatile   -- random() for rotation between equal-priority deals
security definer
set search_path = ''
as $$
  select
    d.id, d.badge, d.headline, d.details, d.image_url, d.audience, d.ends_at,
    v.id, v.store_name, v.city, v.rating, v.review_count, v.verified_at is not null
  from public.sponsored_deals d
  join public.vendors v on v.id = d.vendor_id
  where d.is_active
    and now() >= d.starts_at
    and now() <  d.ends_at
    and v.is_active
    and v.approval_status = 'approved'
  order by d.priority desc, random()
  limit 1;
$$;

revoke all on function public.current_sponsored_deal() from public;
grant execute on function public.current_sponsored_deal() to anon, authenticated;

-- The fallback when nothing is booked: one well-performing shop, shown
-- WITHOUT a sponsored label, because nobody paid for it. "Well-performing"
-- means buyers have rated it at least 4.0, or it has completed at least
-- five orders; beyond that, rating then volume decides. p_exclude lets the
-- dashboard skip the shop already shown in its "Featured Shops" card, so
-- the page never shows the same shop twice. Nothing qualifying -> no row,
-- and the app shows its own platform card instead.
create or replace function public.top_organic_shop(p_exclude uuid default null)
returns table (
  vendor_id        uuid,
  store_name       text,
  city             text,
  rating           numeric,
  review_count     integer,
  completed_orders integer,
  verified         boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.store_name, v.city, v.rating, v.review_count, v.completed_orders,
         v.verified_at is not null
  from public.vendors v
  where v.is_active
    and v.approval_status = 'approved'
    and (p_exclude is null or v.id <> p_exclude)
    and (coalesce(v.rating, 0) >= 4.0 or coalesce(v.completed_orders, 0) >= 5)
  order by v.rating desc nulls last, v.completed_orders desc nulls last, v.review_count desc nulls last
  limit 1;
$$;

revoke all on function public.top_organic_shop(uuid) from public;
grant execute on function public.top_organic_shop(uuid) to anon, authenticated;

commit;

notify pgrst, 'reload schema';

-- Example (run as an admin in the SQL editor, with a real vendor id):
--
-- insert into public.sponsored_deals (vendor_id, headline, details, audience, ends_at, priority)
-- values (
--   '<vendor uuid>',
--   '15% OFF JSS1–JSS3 booklists this week!',
--   'Applies to textbooks on lists sent directly to this shop. Discount is shown on the quote.',
--   'JSS1–JSS3',
--   now() + interval '7 days',
--   10
-- );
