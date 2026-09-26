-- BookShops: single-total ("lump-sum") quotes for photo-only booklists
--
-- Run once in the Supabase SQL editor, AFTER
-- bookshops_booklist_photo_vendor_access.sql (it uses is_approved_vendor()).
-- Safe to re-run.
--
-- What it adds
--   A buyer who uploads only a photo leaves nothing to price line by line.
--   Such a request can now be quoted with a single total, an optional
--   note, and the shop's own response file: a photo of the priced sheet,
--   a scan, or a PDF.
--
--   quotes.pricing_mode        'itemised' (every existing quote) | 'lump_sum'
--   quotes.vendor_note         free text for the buyer, <= 1000 chars
--   quotes.response_file_path  object path in the new private bucket
--   quotes.response_file_name  original file name, used when downloading
--   quotes.response_file_type  MIME type
--
-- Checkout needs no change: begin_escrow_checkout() and checkout_quote()
-- already charge quotes.total_price.
--
-- Rules enforced here rather than in the app
--   1. A lump-sum quote can only exist for a request with no itemised
--      lines. Anything that has lines is priced line by line.
--   2. A lump-sum quote cannot be sent without a total above zero and a
--      response file, so the buyer always has something to check.
--   3. refresh_quote_total() no longer touches lump-sum quotes. Before
--      this, any quote_items write would have reset their total to 0.
--   4. Once a lump-sum quote is accepted, its total and file are frozen,
--      so the buyer pays exactly what they accepted.
--   5. The response file must sit in the quoting shop's own folder.

begin;

-- 1. Columns ---------------------------------------------------------------
alter table public.quotes
  add column if not exists pricing_mode       text not null default 'itemised',
  add column if not exists vendor_note        text,
  add column if not exists response_file_path text,
  add column if not exists response_file_name text,
  add column if not exists response_file_type text;

alter table public.quotes drop constraint if exists quotes_pricing_mode_check;
alter table public.quotes add constraint quotes_pricing_mode_check
  check (pricing_mode in ('itemised', 'lump_sum'));

alter table public.quotes drop constraint if exists quotes_vendor_note_length;
alter table public.quotes add constraint quotes_vendor_note_length
  check (vendor_note is null or length(vendor_note) <= 1000);

alter table public.quotes drop constraint if exists quotes_response_file_name_length;
alter table public.quotes add constraint quotes_response_file_name_length
  check (response_file_name is null or length(response_file_name) <= 200);

alter table public.quotes drop constraint if exists quotes_response_file_type_check;
alter table public.quotes add constraint quotes_response_file_type_check
  check (response_file_type is null or response_file_type in
    ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'));

-- Rule 5
alter table public.quotes drop constraint if exists quotes_response_file_in_vendor_folder;
alter table public.quotes add constraint quotes_response_file_in_vendor_folder
  check (response_file_path is null
         or split_part(response_file_path, '/', 1) = vendor_id::text);

-- Rule 2
alter table public.quotes drop constraint if exists quotes_lump_sum_complete;
alter table public.quotes add constraint quotes_lump_sum_complete
  check (pricing_mode = 'itemised'
         or status not in ('sent', 'accepted')
         or (total_price > 0 and response_file_path is not null));

comment on column public.quotes.pricing_mode is
  'itemised: total is the sum of quote_items (kept by refresh_quote_total). lump_sum: vendor-entered total for a photo-only booklist, backed by response_file_path.';

create index if not exists quotes_response_file_path_idx
  on public.quotes (response_file_path)
  where response_file_path is not null;

-- 2. Rules 1 and 4 ---------------------------------------------------------
create or replace function public.guard_lump_sum_quote()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.pricing_mode = 'lump_sum'
     and (tg_op = 'INSERT' or old.pricing_mode is distinct from 'lump_sum')
     and exists (select 1 from public.book_request_items i where i.request_id = new.request_id)
  then
    raise exception 'This booklist has itemised lines, so it must be quoted line by line'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
     and old.pricing_mode = 'lump_sum'
     and old.status = 'accepted'
     and (new.total_price        is distinct from old.total_price
       or new.response_file_path is distinct from old.response_file_path
       or new.pricing_mode       is distinct from old.pricing_mode)
  then
    raise exception 'An accepted quote can no longer be changed' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_lump_sum_quote on public.quotes;
create trigger guard_lump_sum_quote
  before insert or update on public.quotes
  for each row execute function public.guard_lump_sum_quote();

-- 3. Rule 3: the line-sum trigger leaves lump-sum totals alone -------------
create or replace function public.refresh_quote_total()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
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
   where q.id = target
     and q.pricing_mode = 'itemised';
  return null;
end;
$$;

-- 4. Private bucket for the shop's response files --------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quote-responses', 'quote-responses', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Object paths are <vendor_id>/<quote_id>/<key>.<ext>.
-- Writes: only an approved, active shop, only into its own folder.
drop policy if exists quote_responses_insert_own_shop on storage.objects;
create policy quote_responses_insert_own_shop
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'quote-responses'
    and public.is_approved_vendor()
    and exists (
      select 1 from public.vendors v
       where v.id::text = (storage.foldername(name))[1]
         and v.profile_id = (select auth.uid())
    )
  );

drop policy if exists quote_responses_update_own_shop on storage.objects;
create policy quote_responses_update_own_shop
  on storage.objects for update to authenticated
  using (
    bucket_id = 'quote-responses'
    and exists (
      select 1 from public.vendors v
       where v.id::text = (storage.foldername(name))[1]
         and v.profile_id = (select auth.uid())
    )
  );

drop policy if exists quote_responses_delete_own_shop on storage.objects;
create policy quote_responses_delete_own_shop
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'quote-responses'
    and exists (
      select 1 from public.vendors v
       where v.id::text = (storage.foldername(name))[1]
         and v.profile_id = (select auth.uid())
    )
  );

-- Reads: the shop that uploaded it, admins, and the buyer, but only once
-- the quote carrying the file has been sent (never a draft).
drop policy if exists quote_responses_select on storage.objects;
create policy quote_responses_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'quote-responses'
    and (
      exists (
        select 1 from public.vendors v
         where v.id::text = (storage.foldername(name))[1]
           and v.profile_id = (select auth.uid())
      )
      or public.is_admin()
      or exists (
        select 1
          from public.quotes q
          join public.book_requests r on r.id = q.request_id
         where q.response_file_path = objects.name
           and q.status <> 'draft'
           and r.buyer_id = (select auth.uid())
      )
    )
  );

commit;
