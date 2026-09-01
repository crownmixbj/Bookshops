-- Bookshops — vendor quoting: draft quotes, itemised pricing, declines,
-- busy mode, and a privacy-preserving request queue.
--
-- Three things here matter more than the rest, so read them before running:
--
--  1. DRAFTS MUST NOT LEAK. "Save as Draft" is only safe if a buyer
--     cannot see a draft. The existing quotes_select_own_side policy
--     shows a buyer every quote on their request, drafts included, so it
--     is replaced below.
--  2. VENDORS DO NOT GET A DIRECTORY OF PARENTS. Customer names are
--     returned by one security-definer function, and only for requests
--     the vendor has actually engaged with. A vendor merely browsing the
--     queue sees a reference code.
--  3. VENDORS NEVER WRITE book_request_items. Those rows are the buyer's
--     statement of what they want. A vendor's prices live in quote_items,
--     which is why competing quotes can differ without fighting over the
--     same column.

begin;

-- ============================================================
-- 1. Draft quotes
-- ============================================================
alter table public.quotes drop constraint if exists quotes_status_check;
alter table public.quotes
  add constraint quotes_status_check
  check (status in ('draft', 'sent', 'accepted', 'rejected', 'withdrawn', 'expired'));

-- A draft starts unpriced, so the old "> 0" check would reject it.
alter table public.quotes drop constraint if exists quotes_total_price_positive;
alter table public.quotes
  alter column total_price set default 0,
  add constraint quotes_total_price_non_negative check (total_price >= 0);

-- item_breakdown is superseded by quote_items but kept so nothing that
-- reads it breaks; it is no longer the source of truth.
comment on column public.quotes.item_breakdown is
  'LEGACY. Superseded by public.quote_items. Kept only so older readers do not break.';

-- ============================================================
-- 2. quote_items — the vendor's priced lines
-- ============================================================
create table if not exists public.quote_items (
  id              uuid primary key default gen_random_uuid(),
  quote_id        uuid not null references public.quotes (id) on delete cascade,
  request_item_id uuid references public.book_request_items (id) on delete set null,
  title           text not null check (length(trim(title)) between 1 and 300),
  quantity        integer not null default 1 check (quantity > 0 and quantity <= 500),
  unit_price      numeric(12,2) check (unit_price is null or unit_price >= 0),
  -- The availability switch. An unavailable line stays on the quote so
  -- the buyer can see it was considered and not silently dropped.
  is_available    boolean not null default true,
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (quote_id, request_item_id)
);

create index if not exists quote_items_quote_idx on public.quote_items (quote_id, position);

alter table public.quote_items enable row level security;

-- The vendor who owns the quote may do anything with its lines.
create policy "quote_items_all_own_vendor" on public.quote_items for all
  to authenticated
  using (
    exists (
      select 1 from public.quotes q
      join public.vendors v on v.id = q.vendor_id
      where q.id = quote_items.quote_id and v.profile_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.quotes q
      join public.vendors v on v.id = q.vendor_id
      where q.id = quote_items.quote_id and v.profile_id = (select auth.uid())
    )
  );

-- The buyer sees the lines only once the quote has been sent. This is
-- the second half of not leaking drafts.
create policy "quote_items_select_buyer_sent" on public.quote_items for select
  to authenticated
  using (
    exists (
      select 1 from public.quotes q
      join public.book_requests r on r.id = q.request_id
      where q.id = quote_items.quote_id
        and r.buyer_id = (select auth.uid())
        and q.status <> 'draft'
    )
  );

drop trigger if exists touch_quote_items on public.quote_items;
create trigger touch_quote_items before update on public.quote_items
  for each row execute function public.touch_updated_at();

-- Keep quotes.total_price in step with the available priced lines, so
-- the headline figure can never disagree with the breakdown.
create or replace function public.refresh_quote_total()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target uuid := coalesce(new.quote_id, old.quote_id);
begin
  update public.quotes q
     set total_price = coalesce((
           select sum(qi.unit_price * qi.quantity)
             from public.quote_items qi
            where qi.quote_id = target
              and qi.is_available
              and qi.unit_price is not null
         ), 0)
   where q.id = target;
  return null;
end;
$$;

drop trigger if exists refresh_quote_total on public.quote_items;
create trigger refresh_quote_total
  after insert or update or delete on public.quote_items
  for each row execute function public.refresh_quote_total();

-- ============================================================
-- 3. Drafts must not reach the buyer
-- ============================================================
drop policy if exists "quotes_select_own_side" on public.quotes;

create policy "quotes_select_own_side" on public.quotes for select
  to authenticated
  using (
    -- The vendor who wrote it, at any status including draft.
    exists (
      select 1 from public.vendors v
      where v.id = quotes.vendor_id and v.profile_id = (select auth.uid())
    )
    -- The buyer who raised the request, but never a draft.
    or (
      quotes.status <> 'draft'
      and exists (
        select 1 from public.book_requests r
        where r.id = quotes.request_id and r.buyer_id = (select auth.uid())
      )
    )
  );

-- ============================================================
-- 4. Declining a request
-- ============================================================
create table if not exists public.request_declines (
  request_id uuid not null references public.book_requests (id) on delete cascade,
  vendor_id  uuid not null references public.vendors (id) on delete cascade,
  reason     text check (reason is null or length(reason) <= 500),
  created_at timestamptz not null default now(),
  primary key (request_id, vendor_id)
);

comment on table public.request_declines is
  'A vendor passing on a request. Removes it from that vendor''s queue only — other vendors still see it.';

alter table public.request_declines enable row level security;

create policy "request_declines_all_own_vendor" on public.request_declines for all
  to authenticated
  using (
    exists (select 1 from public.vendors v
             where v.id = request_declines.vendor_id and v.profile_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.vendors v
             where v.id = request_declines.vendor_id and v.profile_id = (select auth.uid()))
  );

-- ============================================================
-- 5. Peak season busy mode
-- ============================================================
alter table public.vendors
  add column if not exists busy_mode boolean not null default false,
  add column if not exists busy_note text check (busy_note is null or length(busy_note) <= 200);

comment on column public.vendors.busy_mode is
  'Vendor-set flag for peak season. Buyers should be told to expect slower replies; it does not stop requests arriving.';

-- ============================================================
-- 6. The request queue, with customer names gated on engagement
-- ============================================================
-- SECURITY DEFINER because the privacy rule is the point: a vendor may
-- read a buyer's name only for a request they have quoted, or one sent
-- to them directly. Everyone else gets a reference code. Doing this in a
-- function keeps the rule in one place rather than trusting each client.
create or replace function public.vendor_request_queue()
returns table (
  request_id       uuid,
  reference        text,
  school_name      text,
  class_level      text,
  created_at       timestamptz,
  item_count       bigint,
  is_targeted      boolean,
  my_quote_id      uuid,
  my_quote_status  text,
  customer_name    text,
  customer_phone   text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  my_vendor uuid;
begin
  select v.id into my_vendor
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
     and not exists (
       select 1 from public.request_declines d
        where d.request_id = r.id and d.vendor_id = my_vendor
     )
   order by (r.target_vendor_id = my_vendor) desc, r.created_at desc;
end;
$$;

revoke all on function public.vendor_request_queue() from public, anon;
grant execute on function public.vendor_request_queue() to authenticated;

commit;

notify pgrst, 'reload schema';
