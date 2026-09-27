-- Bookshops — a public shop directory
--
-- /shops, /shops/<id>, the dashboard's Featured Shops card and the header
-- search are all open routes: lib/authGate.ts has never listed them. But
-- a guest still saw an EMPTY directory, because the database said no:
--
--   * vendors_select_active and vendor_reviews_select_all are
--     `to authenticated` only, and
--   * the `anon` role has no SELECT grant on either table at all.
--
-- So the page loaded, the query returned zero rows, and a visitor was told
-- there were no shops. This file opens exactly the shop-card view to
-- guests and nothing more:
--
--   vendors         approved + active shops only (same rule signed-in
--                   buyers get), and only the public card columns — never
--                   profile_id (the owner's account), approval notes, or
--                   who reviewed the shop.
--   vendor_reviews  rating, comment and date — never buyer_id or order_id.
--
-- Everything personal stays signed-in only: saved shops, browsing
-- history, booklists, quotes, orders, messages, checkout.
--
-- Column grants are the column filter here; RLS is the row filter. A
-- guest query naming any other column fails with "permission denied for
-- column", which is why useVendorDirectory's select list was trimmed to
-- match.
--
-- Safe to run more than once.

begin;

-- ---- vendors -------------------------------------------------------
grant select (
  id, store_name, address, city, is_active, phone, email,
  verified_at, rating, review_count, completed_orders,
  approval_status, featured, busy_mode, busy_note,
  created_at, updated_at
) on public.vendors to anon;

drop policy if exists vendors_select_public on public.vendors;
create policy vendors_select_public on public.vendors
  for select to anon
  using (is_active and approval_status = 'approved');

-- ---- vendor_reviews ------------------------------------------------
grant select (id, vendor_id, rating, comment, created_at) on public.vendor_reviews to anon;

drop policy if exists vendor_reviews_select_public on public.vendor_reviews;
create policy vendor_reviews_select_public on public.vendor_reviews
  for select to anon
  using (
    exists (
      select 1 from public.vendors v
      where v.id = vendor_reviews.vendor_id
        and v.is_active and v.approval_status = 'approved'
    )
  );

commit;

notify pgrst, 'reload schema';
