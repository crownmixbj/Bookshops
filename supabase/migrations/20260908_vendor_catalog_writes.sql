-- Bookshops — let an approved shop add catalogue entries
--
-- 20260907_create_catalog_schema.sql made `products` admin-write only,
-- on the reasoning that a shared catalogue with open INSERT collects six
-- spellings of "New General Mathematics" and stops being shared at all.
-- That reasoning still holds, but it left the vendor inventory screen
-- unable to list anything that was not already in the table — and the
-- table ships with four categories and no products, so in practice a
-- shop could list nothing whatsoever.
--
-- This grants INSERT to approved, active shops and nothing more:
--
--   INSERT  yes — a shop adds the book it stocks
--   UPDATE  no  — products is shared, so one shop editing a row would
--                 rewrite the title under every other shop listing it
--   DELETE  no  — same reason, with sharper consequences
--
-- Editing and removal stay with admins. A shop's own price and stock
-- live on shop_listings, which it already owns outright.
--
-- The app also searches existing titles before inserting and offers the
-- match, so the duplicate problem is addressed at both ends.

begin;

drop policy if exists products_insert_vendor on public.products;
create policy products_insert_vendor
  on public.products for insert
  to authenticated
  with check (
    exists (
      select 1 from public.vendors v
       where v.profile_id = (select auth.uid())
         and v.is_active
         and v.approval_status = 'approved'
    )
  );

comment on policy products_insert_vendor on public.products is
  'Approved shops may add catalogue entries. Editing and deleting stay with admins because the row is shared across shops.';

commit;

notify pgrst, 'reload schema';
