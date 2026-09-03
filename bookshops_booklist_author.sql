-- Bookshops — author / publisher on a booklist line
--
-- The review step after a photo is parsed lets a buyer correct the
-- author or publisher as well as the title, because on a real Nigerian
-- school list that is what distinguishes two editions of the same book:
-- "New General Mathematics" is meaningless to a vendor without
-- "A.O. Kalejaiye" beside it.
--
-- Nullable and additive. No existing row changes, nothing that selects
-- an explicit column list breaks.

begin;

alter table public.book_request_items
  add column if not exists author text
    check (author is null or length(author) <= 200);

comment on column public.book_request_items.author is
  'Author or publisher as it appeared on the school list. Null when the list did not name one.';

commit;

-- PostgREST caches the schema; without this the new column reads as
-- "Could not find the 'author' column of 'book_request_items' in the
-- schema cache" until the cache happens to reload.
notify pgrst, 'reload schema';
