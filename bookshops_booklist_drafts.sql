-- Bookshops — booklist drafts
--
-- A booklist read from a photo is a guess until a human has checked it.
-- Today every list is created as 'pending_quote', which puts it in front
-- of vendors the instant it is saved — including the OCR mistakes. This
-- adds a status that means "mine, not yet sent".
--
-- Two changes, and the second is the one that is easy to miss:
--   1. 'draft' becomes a legal status.
--   2. the delete policy learns about it. RLS does not raise an error on
--      a DELETE it refuses — it deletes nothing and reports success — so
--      without this the Delete button appears to work and the list
--      reappears on the next refresh.
--
-- vendor_request_queue() already filters `status in ('pending_quote',
-- 'quoted')`, so drafts stay out of every vendor's queue with no change
-- to that function. Same for SendBooklistModal and useProfileDetails,
-- which filter on the same pair.
--
-- Safe to run as-is. No existing row changes: every current request
-- keeps the status it has.

begin;

-- ============================================================
-- 1. 'draft' as a legal status
-- ============================================================
alter table public.book_requests
  drop constraint if exists book_requests_status_check;

alter table public.book_requests
  add constraint book_requests_status_check
  check (status in ('draft', 'pending_quote', 'quoted', 'ordered', 'cancelled'));

comment on column public.book_requests.status is
  'draft = the buyer is still editing it and no vendor can see it; '
  'pending_quote = published, awaiting quotes; quoted = at least one quote; '
  'ordered; cancelled. Vendors only ever see pending_quote and quoted.';


-- ============================================================
-- 2. Deleting a list nobody has quoted
-- ============================================================
-- Was: status = 'pending_quote' only, which locked drafts in place
-- permanently — the one status where throwing the list away is the most
-- reasonable thing a buyer could want.
--
-- Still deliberately excludes 'quoted' and 'ordered': once a vendor has
-- spent time pricing a list, the buyer cancels it rather than deleting
-- the evidence out from under them.
drop policy if exists "requests_delete_own" on public.book_requests;

create policy "requests_delete_own"
  on public.book_requests for delete
  to authenticated
  using (
    buyer_id = (select auth.uid())
    and status in ('draft', 'pending_quote')
  );

commit;

-- book_request_items has `on delete cascade` on request_id, so deleting
-- a request takes its line items with it. No second statement needed,
-- and no orphan rows.

notify pgrst, 'reload schema';
