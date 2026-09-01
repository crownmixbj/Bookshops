-- Bookshops — booklist line items + booklist photo storage
--
-- Adds the table the "My Booklists" page is built around: the individual
-- textbooks, stationery and uniform items on a school list, with
-- quantities and prices, so a request can be shown and totalled properly
-- instead of being a photo with no structure behind it.
--
-- Also fixes the `booklists` storage bucket, which today is public with
-- no policies at all — meaning anyone with a URL can read an uploaded
-- photo, while no signed-in user can actually upload one.
--
-- Safe to run as-is: creates one new table, adds one nullable column,
-- and replaces storage policies. No existing rows are modified.

begin;

-- ============================================================
-- 1. book_request_items
-- ============================================================
create table if not exists public.book_request_items (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.book_requests (id) on delete cascade,
  title        text not null check (length(trim(title)) between 1 and 300),
  -- Matches the three groups the UI sections by. 'other' is the escape
  -- hatch so a parsed list never fails to insert on an odd line.
  category     text not null default 'textbook'
                 check (category in ('textbook', 'stationery', 'uniform', 'other')),
  quantity     integer not null default 1 check (quantity > 0 and quantity <= 500),
  -- Nullable on purpose: a freshly scanned list has titles but no prices
  -- until a vendor quotes it.
  unit_price   numeric(12,2) check (unit_price is null or unit_price >= 0),
  -- Set by the parser so a human knows which lines to double-check.
  parsed       boolean not null default false,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.book_request_items is
  'Individual items on a booklist request. Rows may be created by the photo parser (parsed = true) or entered by hand.';

create index if not exists book_request_items_request_idx
  on public.book_request_items (request_id, position);

alter table public.book_request_items enable row level security;

-- A line item is visible to whoever may see its parent request: the
-- buyer who raised it, and vendors (who need it to quote). This mirrors
-- requests_select_visible rather than restating its logic.
create policy "items_select_via_request"
  on public.book_request_items for select
  to authenticated
  using (
    exists (
      select 1 from public.book_requests r
      where r.id = book_request_items.request_id
        and (
          r.buyer_id = (select auth.uid())
          or exists (
            select 1 from public.profiles p
            where p.id = (select auth.uid()) and p.role in ('vendor', 'admin')
          )
        )
    )
  );

-- Only the buyer who owns the request may add, change or remove items.
create policy "items_insert_own"
  on public.book_request_items for insert
  to authenticated
  with check (
    exists (
      select 1 from public.book_requests r
      where r.id = book_request_items.request_id
        and r.buyer_id = (select auth.uid())
    )
  );

create policy "items_update_own"
  on public.book_request_items for update
  to authenticated
  using (
    exists (
      select 1 from public.book_requests r
      where r.id = book_request_items.request_id and r.buyer_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.book_requests r
      where r.id = book_request_items.request_id and r.buyer_id = (select auth.uid())
    )
  );

create policy "items_delete_own"
  on public.book_request_items for delete
  to authenticated
  using (
    exists (
      select 1 from public.book_requests r
      where r.id = book_request_items.request_id and r.buyer_id = (select auth.uid())
    )
  );

drop trigger if exists touch_book_request_items on public.book_request_items;
create trigger touch_book_request_items
  before update on public.book_request_items
  for each row execute function public.touch_updated_at();


-- ============================================================
-- 2. book_requests.image_path
-- ============================================================
-- image_url was never populated and, for a private bucket, a URL is the
-- wrong thing to store: signed URLs expire. Store the object path and
-- sign it on demand instead. image_url is left in place so nothing that
-- reads it breaks.
alter table public.book_requests
  add column if not exists image_path text;

comment on column public.book_requests.image_path is
  'Object path in the booklists bucket, as <buyer id>/<request id>.<ext>. Sign it to display; do not store signed URLs.';

commit;


-- ============================================================
-- 3. Storage: the booklists bucket
-- ============================================================
-- Run this section separately if your SQL editor complains — storage
-- objects live outside the transaction above in some setups.
--
-- Why private: these are photographs of real school booklists, tied to a
-- named school and class level. A public bucket makes every one of them
-- readable by anyone holding or guessing the URL.

update storage.buckets
   set public = false,
       file_size_limit = 10485760,                        -- 10 MB
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
 where id = 'booklists';

drop policy if exists "booklists_insert_own_folder" on storage.objects;
drop policy if exists "booklists_select_own_or_vendor" on storage.objects;
drop policy if exists "booklists_update_own_folder" on storage.objects;
drop policy if exists "booklists_delete_own_folder" on storage.objects;

-- Uploads must land in a folder named after the uploader's own user id.
create policy "booklists_insert_own_folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'booklists'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "booklists_update_own_folder"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'booklists'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "booklists_delete_own_folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'booklists'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- The owner always; vendors and admins so they can read a list to quote it.
create policy "booklists_select_own_or_vendor"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'booklists'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role in ('vendor', 'admin')
      )
    )
  );

-- PostgREST caches the schema; without this the new table reads as
-- "Could not find the table 'public.book_request_items' in the schema
-- cache" until the cache happens to reload.
notify pgrst, 'reload schema';
