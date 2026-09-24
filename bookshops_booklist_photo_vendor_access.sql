-- BookShops: vendor access to buyers' booklist photos
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Why
--   The live read policy `booklists_select_own_or_vendor` lets ANY profile
--   whose role is 'vendor' sign and read EVERY object in the private
--   `booklists` bucket — unapproved vendors included, photos of requests
--   targeted at a different shop, and orphaned uploads that never became
--   a request.
--
-- After this
--   A vendor can read a photo only when
--     1. their shop is approved AND active, and
--     2. a book_requests row they can see points at that object via
--        image_path. "Can see" is requests_select_visible (open market, or
--        targeted at their shop); it applies inside this policy because
--        Storage evaluates it as the signed-in user.
--   Buyers keep their own folder, admins keep everything.
--
--   createSignedUrl() checks this SELECT policy before signing, so the
--   app needs no extra permission logic: a vendor who is not allowed just
--   gets a failed signature and the viewer's "could not open" state.

begin;

-- 1. Is the caller an approved, active vendor?
--    SECURITY DEFINER so it reads vendors regardless of that table's RLS,
--    same pattern as public.is_admin().
create or replace function public.is_approved_vendor()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
      from public.vendors v
     where v.profile_id = auth.uid()
       and v.is_active
       and v.approval_status = 'approved'
  );
$$;

revoke all on function public.is_approved_vendor() from public, anon;
grant execute on function public.is_approved_vendor() to authenticated;

-- 2. Keeps the policy's path lookup an index probe, not a table scan.
create index if not exists book_requests_image_path_idx
  on public.book_requests (image_path)
  where image_path is not null;

-- 3. Replace the read policy. Insert/update/delete policies are untouched.
drop policy if exists booklists_select_own_or_vendor on storage.objects;
drop policy if exists booklists_select_own_admin_or_approved_vendor on storage.objects;

create policy booklists_select_own_admin_or_approved_vendor
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'booklists'
    and (
      -- the buyer, reading their own uploads
      (storage.foldername(name))[1] = (select auth.uid())::text
      -- admins
      or public.is_admin()
      -- approved vendors, only for a photo on a request they can see
      or (
        public.is_approved_vendor()
        and exists (
          select 1
            from public.book_requests r
           where r.image_path = objects.name
        )
      )
    )
  );

commit;
