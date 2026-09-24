-- Bookshops — a sent quote moves its request to 'quoted'
--
-- THE PROBLEM
--
-- hooks/useVendorDashboard.ts tries to do this from the client:
--
--     supabase.from('book_requests')
--       .update({ status: 'quoted' })
--       .eq('id', selectedId);
--
-- and it has never once worked. `requests_update_own` is
--
--     buyer_id = (select auth.uid())
--
-- so a vendor updating somebody else's request matches no row. PostgREST
-- reports success with zero rows affected, the code logs a warning, and
-- the request stays 'pending_quote' for the rest of its life.
--
-- The buyer is unaffected — their card derives state from the quotes
-- themselves — but the admin console has a "Quoted" filter tab and a
-- quoted count (app/admin/booklists.tsx, hooks/useAdminOps.ts) that are
-- therefore permanently zero.
--
-- THE FIX
--
-- A trigger owned by the database rather than a client. It runs as its
-- definer, so it is not subject to requests_update_own — which is the
-- point: the rule "a sent quote means this request has been quoted" is
-- the system's, not the buyer's, and nothing a client sends can make it
-- true or false.
--
-- Widening requests_update_own to admit vendors was the alternative and
-- is worse: it would let any approved vendor write any column of any
-- open request, to fix a status they should not be setting by hand.
--
-- Safe to run more than once.

begin;

create or replace function public.quote_marks_request_quoted()
 returns trigger
 language plpgsql
 security definer
 -- Empty search_path so every object below must be schema-qualified. A
 -- security definer function that resolves names through the caller's
 -- search_path is the classic privilege-escalation hole.
 set search_path to ''
as $function$
begin
  -- Only a SENT quote counts. A draft quote is the vendor's private
  -- working copy — they may be part-way through pricing, or may never
  -- send it — and telling the buyer they have been quoted on the
  -- strength of one would be a lie the vendor never told.
  if new.status is distinct from 'sent' then
    return new;
  end if;

  -- Only ever pending_quote -> quoted. Every other status is somewhere
  -- further along or off the path entirely:
  --   draft      not published; a quote against it should not surface it
  --   quoted     already there, nothing to do
  --   ordered    the buyer has accepted and paid; a second vendor
  --              sending a late quote must NOT drag it backwards
  --   cancelled  the buyer withdrew it
  -- Scoping the UPDATE this tightly is what makes the trigger safe to
  -- fire on every quote write.
  update public.book_requests r
     set status = 'quoted',
         updated_at = now()
   where r.id = new.request_id
     and r.status = 'pending_quote';

  return new;
end;
$function$;

comment on function public.quote_marks_request_quoted() is
  'Advances a book_request from pending_quote to quoted when a vendor '
  'sends a quote. Runs as definer because requests_update_own is scoped '
  'to the buyer and a vendor cannot move somebody else''s request.';

-- INSERT covers "send" straight from the editor, which creates the quote
-- already at 'sent'. UPDATE covers the commoner path: a draft quote the
-- vendor has been building, flipped to 'sent' later. saveQuote() in
-- useVendorDashboard.ts does both, depending on whether a draft exists.
drop trigger if exists quote_marks_request_quoted on public.quotes;

create trigger quote_marks_request_quoted
  after insert or update of status on public.quotes
  for each row
  execute function public.quote_marks_request_quoted();

commit;


-- ------------------------------------------------------------------
-- Backfill
-- ------------------------------------------------------------------
-- Requests that already carry a sent-or-better quote but were left at
-- pending_quote by the bug above. Same guard as the trigger, so nothing
-- ordered or cancelled is touched.
--
-- 'accepted' is included deliberately: an accepted quote was sent first,
-- so its request was quoted whatever the row now says.
update public.book_requests r
   set status = 'quoted',
       updated_at = now()
 where r.status = 'pending_quote'
   and exists (
     select 1 from public.quotes q
      where q.request_id = r.id
        and q.status in ('sent', 'accepted')
   );

notify pgrst, 'reload schema';
