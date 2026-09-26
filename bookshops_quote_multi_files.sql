-- BookShops: several response files per quote, 5 MB per file
--
-- Run once in the Supabase SQL editor, AFTER bookshops_lump_sum_quotes.sql.
-- Safe to re-run.
--
-- What changes
--   quotes.response_file_path / _name / _type (one file) become
--   quotes.response_files, an ordered JSON array: page 1 first.
--
--     [{ "path": "<vendor_id>/<quote_id>/<key>.jpg",
--        "name": "Page 1.jpg",
--        "type": "image/jpeg",
--        "size": 812345 }, ...]
--
--   An array on the quote rather than a child table on purpose: the
--   app replaces the whole set in the same UPDATE that flips the status
--   to 'sent', so the buyer can never see a half-updated set of pages,
--   and the "a sent quote needs at least one file" rule stays a plain
--   CHECK on one row.
--
-- Limits
--   - 5 MB per file, enforced by the bucket itself (file_size_limit), so
--     an oversized upload is refused by Storage whatever the client does.
--   - At most 10 files per quote.
--   - Each entry must sit in the quoting shop's folder, have a name, and
--     be one of the allowed types. No duplicate paths.
--
-- Nothing to migrate today (no quote has a file yet), but any single
-- file present when this runs is carried into the array first.

begin;

-- 1. The new column ---------------------------------------------------------
alter table public.quotes
  add column if not exists response_files jsonb not null default '[]'::jsonb;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'quotes'
       and column_name = 'response_file_path'
  ) then
    execute $m$
      update public.quotes
         set response_files = jsonb_build_array(jsonb_build_object(
               'path', response_file_path,
               'name', coalesce(response_file_name, 'Quote file'),
               'type', coalesce(response_file_type, 'image/jpeg')))
       where response_file_path is not null
         and response_files = '[]'::jsonb
    $m$;
  end if;
end $$;

-- 2. Shape rules ------------------------------------------------------------
-- Written with IS DISTINCT FROM throughout: a missing key is NULL, and a
-- plain <> against NULL would quietly let a malformed entry through.
create or replace function public.quote_response_files_valid(files jsonb, vendor uuid)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select jsonb_typeof(files) = 'array'
     and jsonb_array_length(files) <= 10
     and not exists (
       select 1
         from jsonb_array_elements(files) f
        where jsonb_typeof(f) is distinct from 'object'
           or jsonb_typeof(f -> 'path') is distinct from 'string'
           or split_part(f ->> 'path', '/', 1) is distinct from vendor::text
           or jsonb_typeof(f -> 'name') is distinct from 'string'
           or coalesce(length(f ->> 'name'), 0) not between 1 and 200
           or (f ->> 'type') is null
           or (f ->> 'type') not in
                ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf')
           or (f ? 'size' and jsonb_typeof(f -> 'size') is distinct from 'number')
           or (jsonb_typeof(f -> 'size') = 'number' and (f ->> 'size')::numeric > 5242880)
     )
     and (select count(distinct f ->> 'path') from jsonb_array_elements(files) f)
         = jsonb_array_length(files);
$$;

alter table public.quotes drop constraint if exists quotes_response_files_valid;
alter table public.quotes add constraint quotes_response_files_valid
  check (public.quote_response_files_valid(response_files, vendor_id));

alter table public.quotes drop constraint if exists quotes_lump_sum_complete;
alter table public.quotes add constraint quotes_lump_sum_complete
  check (pricing_mode = 'itemised'
         or status not in ('sent', 'accepted')
         or (total_price > 0 and jsonb_array_length(response_files) >= 1));

-- Lets the storage read policy find "which quote carries this object".
create index if not exists quotes_response_files_gin
  on public.quotes using gin (response_files jsonb_path_ops);

-- 3. Frozen once accepted: now the whole set of files --------------------
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
     and (new.total_price    is distinct from old.total_price
       or new.response_files is distinct from old.response_files
       or new.pricing_mode   is distinct from old.pricing_mode)
  then
    raise exception 'An accepted quote can no longer be changed' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- 4. Buyer read access follows the array ------------------------------------
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
         where q.response_files @> jsonb_build_array(jsonb_build_object('path', objects.name))
           and q.status <> 'draft'
           and r.buyer_id = (select auth.uid())
      )
    )
  );

-- 5. The single-file columns go (the policy above no longer uses them) ------
alter table public.quotes drop constraint if exists quotes_response_file_in_vendor_folder;
alter table public.quotes drop constraint if exists quotes_response_file_name_length;
alter table public.quotes drop constraint if exists quotes_response_file_type_check;
drop index if exists public.quotes_response_file_path_idx;
alter table public.quotes
  drop column if exists response_file_path,
  drop column if exists response_file_name,
  drop column if exists response_file_type;

-- 6. 5 MB per file, enforced by Storage -------------------------------------
update storage.buckets
   set file_size_limit = 5242880
 where id = 'quote-responses';

commit;
