-- Bookshops — open-pool claims and a daily quote-request limit
--
-- Run once in the Supabase SQL editor, AFTER bookshops_dispatch_routing.sql
-- and bookshops_quote_decline_closes_offer.sql. Safe to re-run.
--
-- 1. EXCLUSIVE CLAIMS ON OPEN-POOL BOOKLISTS
--
--    A booklist sent to the open pool (dispatch_type = 'open_market') used
--    to be quoted by every shop at once. Now the first shop to press
--    "Accept & Quote" claims it, and it leaves every other shop's queue.
--
--      claim_book_request(id)   the button. Row-locked (SELECT ... FOR
--                               UPDATE), so two shops pressing at the same
--                               moment cannot both win: the second waits
--                               for the first, then gets a clear "another
--                               bookshop has already accepted this" error.
--      guard_quote_claim        a trigger on quotes, so the rule holds even
--                               for a client that never calls the RPC. A
--                               quote on an unclaimed open list claims it;
--                               a quote on someone else's claim is refused.
--      vendor_request_queue()   leaves out lists another shop holds.
--
--    A claim is released, and the list goes back to the pool, when:
--      * the claiming shop declines the list;
--      * the buyer declines that shop's quote;
--      * the shop deletes its quote;
--      * the buyer re-routes the list (open pool <-> one shop);
--      * the shop has held it for 24 hours WITHOUT sending a quote. This
--        stops a shop that clicks and walks away from blocking the
--        buyer's list forever. Once the quote is sent, the claim holds
--        until the buyer decides. Change CLAIM_HOLD in
--        request_claim_holder() if 24 hours is wrong for your market.
--
--    Lists sent directly to one shop are untouched: they were already
--    exclusive.
--
-- 2. DAILY QUOTE-REQUEST LIMIT
--
--    A buyer may send at most 3 booklists for quotes per calendar day
--    (Lagos time). The 4th is refused by a trigger on book_requests with:
--
--      "You have reached your daily limit of 3 quote requests. Please
--       check your active quotes or try again tomorrow."
--
--    What counts is the moment a list is first sent (draft -> pending_quote,
--    or created already sent). Saving drafts is unlimited. Re-routing or
--    re-opening a list that was already sent does not count again.
--    Submissions are logged in book_request_submissions, so sending a
--    list and then deleting it does NOT give the buyer the slot back.
--    Admins and the server (service role) are not limited.
--
--    my_quote_request_allowance() lets the app show how many are left.

begin;

-- ============================================================
-- 0. Columns
-- ============================================================
alter table public.book_requests
  add column if not exists claimed_by_vendor_id uuid references public.vendors (id) on delete set null,
  add column if not exists claimed_at   timestamptz,
  add column if not exists submitted_at timestamptz;

comment on column public.book_requests.claimed_by_vendor_id is
  'Open-pool lists only: the shop that accepted it first. Written only by claim_book_request() and its triggers.';
comment on column public.book_requests.submitted_at is
  'When the list was first sent for quotes. Drives the daily request limit.';

create index if not exists book_requests_claimed_by_idx
  on public.book_requests (claimed_by_vendor_id) where claimed_by_vendor_id is not null;

-- Every list already sent counts from when it was created.
update public.book_requests
   set submitted_at = created_at
 where submitted_at is null
   and status <> 'draft';

-- Lists already in the pool with a live quote go to the shop that got
-- there first (a sent quote beats a draft). Shops that had ALREADY sent
-- a quote before this migration keep seeing their own quote in their
-- queue (see vendor_request_queue below); nobody new can join.
update public.book_requests r
   set claimed_by_vendor_id = f.vendor_id,
       claimed_at = f.created_at
  from (
    select distinct on (q.request_id) q.request_id, q.vendor_id, q.created_at
      from public.quotes q
     where q.status in ('sent', 'accepted', 'draft')
     order by q.request_id,
              case when q.status in ('sent', 'accepted') then 0 else 1 end,
              q.created_at
  ) f
 where f.request_id = r.id
   and r.dispatch_type = 'open_market'
   and r.status in ('pending_quote', 'quoted')
   and r.claimed_by_vendor_id is null;


-- ============================================================
-- 1. Who holds a list right now
-- ============================================================
-- NULL means the list is free to claim. Expired claims read as NULL, so
-- nothing needs a cron job to clean them up.
create or replace function public.request_claim_holder(p_request_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.claimed_by_vendor_id
    from public.book_requests r
   where r.id = p_request_id
     and r.dispatch_type = 'open_market'
     and r.claimed_by_vendor_id is not null
     and (
       -- CLAIM_HOLD: how long a claim lasts before a quote is sent.
       r.claimed_at > now() - interval '24 hours'
       or exists (
         select 1 from public.quotes q
          where q.request_id = r.id
            and q.vendor_id = r.claimed_by_vendor_id
            and q.status in ('sent', 'accepted')
       )
     );
$$;

revoke all on function public.request_claim_holder(uuid) from public, anon;
grant execute on function public.request_claim_holder(uuid) to authenticated;


-- ============================================================
-- 2. The claim itself
-- ============================================================
create or replace function public.claim_book_request(p_request_id uuid)
returns table (request_id uuid, claimed_at timestamptz, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  my_vendor uuid;
  r record;
  holder uuid;
  stamp timestamptz;
begin
  select v.id into my_vendor
    from public.vendors v
   where v.profile_id = auth.uid()
     and v.is_active
     and v.approval_status = 'approved';

  if my_vendor is null or public.is_suspended() then
    raise exception 'Only an approved, active bookshop can accept booklists.'
      using errcode = '42501';
  end if;

  -- The lock. A second shop calling at the same instant waits here until
  -- the first commits, then reads the claim the first one wrote.
  select br.id, br.status, br.dispatch_type, br.target_vendor_id,
         br.claimed_by_vendor_id, br.claimed_at
    into r
    from public.book_requests br
   where br.id = p_request_id
   for update;

  if not found
     or r.status not in ('pending_quote', 'quoted')
     or (r.dispatch_type = 'direct' and r.target_vendor_id is distinct from my_vendor)
     or exists (select 1 from public.request_declines d
                 where d.request_id = r.id and d.vendor_id = my_vendor)
  then
    raise exception 'This booklist is no longer open for quotes.'
      using errcode = 'P0001', hint = 'request_closed';
  end if;

  -- Sent to this shop only: already exclusive, nothing to lock.
  if r.dispatch_type = 'direct' then
    return query select r.id, now(), null::timestamptz;
    return;
  end if;

  holder := public.request_claim_holder(r.id);

  if holder is not null and holder <> my_vendor then
    raise exception 'Another bookshop has already accepted this booklist, so it has left the open pool.'
      using errcode = 'P0001', hint = 'request_claimed';
  end if;

  if holder = my_vendor then
    stamp := r.claimed_at;           -- pressing again does not extend it
  else
    stamp := now();
    update public.book_requests br
       set claimed_by_vendor_id = my_vendor,
           claimed_at = stamp
     where br.id = r.id;
  end if;

  return query
  select r.id, stamp,
         case when exists (select 1 from public.quotes q
                            where q.request_id = r.id and q.vendor_id = my_vendor
                              and q.status in ('sent', 'accepted'))
              then null::timestamptz
              else stamp + interval '24 hours' end;
end;
$$;

revoke all on function public.claim_book_request(uuid) from public, anon;
grant execute on function public.claim_book_request(uuid) to authenticated;


-- ============================================================
-- 3. Quotes respect the claim
-- ============================================================
-- Only the shop-side states are checked. A buyer accepting or declining a
-- quote (accepted / rejected), and the server-side payment flow, pass
-- straight through.
create or replace function public.guard_quote_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind text;
  holder uuid;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.status not in ('draft', 'sent') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    -- Nothing about who or what changed.
    if new.status is not distinct from old.status
       and new.vendor_id = old.vendor_id
       and new.request_id = old.request_id then
      return new;
    end if;
    -- A quote that was already sent may be revised. Covers shops that
    -- quoted before claims existed.
    if old.status = 'sent' and new.vendor_id = old.vendor_id
       and new.request_id = old.request_id then
      return new;
    end if;
  end if;

  -- Same row lock as claim_book_request, so the two cannot race.
  select br.dispatch_type into kind
    from public.book_requests br
   where br.id = new.request_id
   for update;

  if kind is distinct from 'open_market' then
    return new;
  end if;

  holder := public.request_claim_holder(new.request_id);
  if holder is null then
    update public.book_requests br
       set claimed_by_vendor_id = new.vendor_id,
           claimed_at = now()
     where br.id = new.request_id;
  elsif holder <> new.vendor_id then
    raise exception 'Another bookshop has already accepted this booklist, so it has left the open pool.'
      using errcode = 'P0001', hint = 'request_claimed';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_quote_claim on public.quotes;
create trigger guard_quote_claim
  before insert or update of status, vendor_id, request_id on public.quotes
  for each row execute function public.guard_quote_claim();


-- ============================================================
-- 4. Releasing a claim
-- ============================================================
create or replace function public.release_claim_on_decline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.book_requests br
     set claimed_by_vendor_id = null, claimed_at = null
   where br.id = new.request_id
     and br.claimed_by_vendor_id = new.vendor_id;
  return null;
end;
$$;

drop trigger if exists release_claim_on_decline on public.request_declines;
create trigger release_claim_on_decline
  after insert on public.request_declines
  for each row execute function public.release_claim_on_decline();

create or replace function public.release_claim_on_quote_end()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  q record;
begin
  if tg_op = 'DELETE' then
    q := old;
  elsif new.status = 'rejected' and old.status is distinct from 'rejected' then
    q := new;
  else
    return null;
  end if;

  update public.book_requests br
     set claimed_by_vendor_id = null, claimed_at = null
   where br.id = q.request_id
     and br.claimed_by_vendor_id = q.vendor_id;
  return null;
end;
$$;

drop trigger if exists release_claim_on_quote_end on public.quotes;
create trigger release_claim_on_quote_end
  after update of status or delete on public.quotes
  for each row execute function public.release_claim_on_quote_end();


-- ============================================================
-- 5. The daily limit
-- ============================================================
create table if not exists public.book_request_submissions (
  id           uuid primary key default gen_random_uuid(),
  buyer_id     uuid not null references auth.users (id) on delete cascade,
  -- No foreign key on purpose: the log must outlive a deleted list, or
  -- send-then-delete would hand the slot back.
  request_id   uuid not null,
  submitted_at timestamptz not null default now()
);

create index if not exists book_request_submissions_buyer_idx
  on public.book_request_submissions (buyer_id, submitted_at desc);

-- Written and read only through the functions below.
alter table public.book_request_submissions enable row level security;
revoke all on public.book_request_submissions from anon, authenticated;

insert into public.book_request_submissions (buyer_id, request_id, submitted_at)
select r.buyer_id, r.id, r.submitted_at
  from public.book_requests r
 where r.submitted_at is not null
   and not exists (select 1 from public.book_request_submissions s where s.request_id = r.id);

create or replace function public.quote_request_daily_limit()
returns integer
language sql
immutable
set search_path = ''
as $$ select 3 $$;

-- Midnight in Lagos, as a timestamptz.
create or replace function public.quote_request_day_start()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'
$$;

create or replace function public.record_quote_request_submission(p_buyer uuid, p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  used integer;
  cap integer := public.quote_request_daily_limit();
begin
  -- Callable only for yourself: nobody can use up another buyer's sends.
  if p_buyer is distinct from auth.uid() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  -- One buyer's submissions queue up behind each other, so two tabs
  -- sending at once cannot both slip in as number 3.
  perform pg_advisory_xact_lock(hashtextextended('quote-request-limit:' || p_buyer::text, 0));

  select count(*) into used
    from public.book_request_submissions s
   where s.buyer_id = p_buyer
     and s.submitted_at >= public.quote_request_day_start();

  if used >= cap then
    raise exception 'You have reached your daily limit of % quote requests. Please check your active quotes or try again tomorrow.', cap
      using errcode = 'P0001', hint = 'daily_request_limit';
  end if;

  insert into public.book_request_submissions (buyer_id, request_id)
  values (p_buyer, p_request);
end;
$$;

-- The trigger below runs with the buyer's own rights, so the buyer role
-- must be able to call this. Calling it directly only spends your own sends.
revoke all on function public.record_quote_request_submission(uuid, uuid) from public, anon;
grant execute on function public.record_quote_request_submission(uuid, uuid) to authenticated;

-- Invoker rights ON PURPOSE: current_user tells a buyer's own write
-- ('authenticated') apart from a write made inside one of the
-- security-definer functions above (the function owner). Only the
-- former may not touch the claim columns.
create or replace function public.guard_book_request_submission()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  app_user boolean := current_user in ('authenticated', 'anon');
begin
  if app_user then
    if tg_op = 'INSERT' then
      new.claimed_by_vendor_id := null;
      new.claimed_at := null;
      new.submitted_at := null;
    else
      new.claimed_by_vendor_id := old.claimed_by_vendor_id;
      new.claimed_at := old.claimed_at;
      new.submitted_at := old.submitted_at;
    end if;
  end if;

  -- Re-routed (open pool <-> one shop): any claim belongs to the old route.
  if tg_op = 'UPDATE' and new.dispatch_type is distinct from old.dispatch_type then
    new.claimed_by_vendor_id := null;
    new.claimed_at := null;
  end if;

  -- First time this list is sent for quotes.
  if new.status in ('pending_quote', 'quoted') and new.submitted_at is null then
    if app_user and not public.is_admin() then
      perform public.record_quote_request_submission(new.buyer_id, new.id);
    end if;
    new.submitted_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists guard_book_request_submission on public.book_requests;
create trigger guard_book_request_submission
  before insert or update on public.book_requests
  for each row execute function public.guard_book_request_submission();

-- For the app: how many sends are left today.
create or replace function public.my_quote_request_allowance()
returns table (used integer, daily_limit integer, resets_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*)::int from public.book_request_submissions s
           where s.buyer_id = auth.uid()
             and s.submitted_at >= public.quote_request_day_start()),
         public.quote_request_daily_limit(),
         public.quote_request_day_start() + interval '1 day';
$$;

revoke all on function public.my_quote_request_allowance() from public, anon;
grant execute on function public.my_quote_request_allowance() to authenticated;


-- ============================================================
-- 6. The vendor queue
-- ============================================================
-- Two new columns (claimed_by_me, claim_expires_at), so the old
-- signature has to go first; CREATE OR REPLACE cannot change a return type.
drop function if exists public.vendor_request_queue();

create function public.vendor_request_queue()
 returns table(request_id uuid, reference text, school_name text, class_level text,
               created_at timestamp with time zone, item_count bigint, is_targeted boolean,
               my_quote_id uuid, my_quote_status text, customer_name text, customer_phone text,
               claimed_by_me boolean, claim_expires_at timestamp with time zone)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  me uuid := auth.uid();
  my_vendor uuid;
  my_city text;
begin
  select v.id, v.city into my_vendor, my_city
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
         -- Engagement gate: a quote of ours, addressed to us, or claimed by us.
         case when q.id is not null or r.target_vendor_id = my_vendor or c.holder = my_vendor
              then p.full_name else null end,
         case when q.id is not null or r.target_vendor_id = my_vendor or c.holder = my_vendor
              then p.phone_number else null end,
         (c.holder = my_vendor),
         case when c.holder = my_vendor and coalesce(q.status, '') not in ('sent', 'accepted')
              then r.claimed_at + interval '24 hours' else null end
    from public.book_requests r
    join public.profiles p on p.id = r.buyer_id
    left join public.quotes q
           on q.request_id = r.id and q.vendor_id = my_vendor
    cross join lateral (select public.request_claim_holder(r.id) as holder) c
   where r.status in ('pending_quote', 'quoted')
     and (r.dispatch_type = 'open_market' or r.target_vendor_id = my_vendor)
     and not exists (
       select 1 from public.request_declines d
        where d.request_id = r.id and d.vendor_id = my_vendor
     )
     and (q.id is null or q.status <> 'rejected')
     -- THE claim rule: an open-pool list is visible while nobody holds
     -- it, to the shop that holds it, and to a shop whose quote was
     -- already sent (quotes from before claims existed).
     and (
       r.dispatch_type <> 'open_market'
       or c.holder is null
       or c.holder = my_vendor
       or q.status in ('sent', 'accepted')
     )
   order by (r.target_vendor_id = my_vendor) desc,
            (c.holder = my_vendor) desc,
            (my_city is not null and p.default_delivery_city = my_city) desc,
            r.created_at desc;
end;
$function$;

revoke all on function public.vendor_request_queue() from public, anon;
grant execute on function public.vendor_request_queue() to authenticated;


-- ============================================================
-- 7. Live queues
-- ============================================================
-- Lets an open queue drop a list the moment another shop claims it.
-- Realtime applies requests_select_visible, so a shop only ever hears
-- about rows it could already read.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'book_requests'
  ) then
    alter publication supabase_realtime add table public.book_requests;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
