-- Bookshops — buyer ↔ vendor messaging, threaded per quote
--
-- One thread per quote, not per pair of people. A buyer and a shop can
-- be talking about two different booklists at once (two children, two
-- schools), and a message saying "the Basic 4 maths book is out of
-- print" has to land against the list it is about. The quote is the one
-- thing both sides already share, and an order hangs off a quote, so a
-- quote-keyed thread covers "about my quote" and "about my order" with
-- a single key.
--
-- Writes go through functions, not INSERT policies, for the same reason
-- orders do: the function decides who the sender is and which side they
-- are on. A client-supplied sender_role would let a buyer post as the
-- shop.
--
-- Safe to run more than once. Creates one table, its policies, four
-- functions, and adds the table to the realtime publication.
-- Requires bookshops_escrow_checkout.sql (for the order reference).

begin;

-- ============================================================
-- 1. The table
-- ============================================================
create table if not exists public.quote_messages (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.quotes(id) on delete cascade,
  -- The order this quote had become when the message was sent, if any.
  -- A snapshot for context ("sent after it was paid for"), not the key:
  -- the thread is always the quote.
  order_id    uuid references public.orders(id) on delete set null,
  -- Nullable so deleting an account does not delete the other party's
  -- record of the conversation.
  sender_id   uuid references auth.users(id) on delete set null,
  sender_role text not null check (sender_role in ('buyer', 'vendor')),
  body        text not null
    check (length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now(),
  -- When the OTHER side first read it. Only mark_quote_thread_read sets it.
  read_at     timestamptz
);

comment on table public.quote_messages is
  'Buyer ↔ vendor conversation, one thread per quote. Written only through send_quote_message(); read state only through mark_quote_thread_read().';

create index if not exists quote_messages_thread_idx
  on public.quote_messages (quote_id, created_at);

-- The unread badge asks "messages to me, not yet read" constantly.
create index if not exists quote_messages_unread_idx
  on public.quote_messages (quote_id, sender_role)
  where read_at is null;

alter table public.quote_messages enable row level security;

-- ============================================================
-- 2. Who is in a thread
-- ============================================================
-- Returns 'vendor', 'buyer', or null. Definer-rights because the answer
-- crosses tables the caller may not be able to read directly — a buyer
-- cannot see vendors.profile_id, and should not need to.
--
-- Draft quotes have no buyer side: a buyer cannot see a draft, so they
-- cannot be in a conversation about one.
create or replace function public.quote_thread_role(p_quote_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when v.profile_id = auth.uid() then 'vendor'
    when r.buyer_id = auth.uid() and q.status <> 'draft' then 'buyer'
    else null
  end
  from public.quotes q
  join public.vendors v       on v.id = q.vendor_id
  join public.book_requests r on r.id = q.request_id
  where q.id = p_quote_id;
$$;

revoke all on function public.quote_thread_role(uuid) from public;
grant execute on function public.quote_thread_role(uuid) to authenticated;

-- Read: either party. No INSERT / UPDATE / DELETE policy on purpose —
-- the functions below are the only writers. Realtime applies this same
-- policy, so a subscription only ever receives the caller's own threads.
drop policy if exists quote_messages_select_participant on public.quote_messages;
create policy quote_messages_select_participant
  on public.quote_messages for select
  to authenticated
  using (public.quote_thread_role(quote_id) is not null);

-- Support needs to read a thread when a buyer raises a dispute.
drop policy if exists quote_messages_select_admin on public.quote_messages;
create policy quote_messages_select_admin
  on public.quote_messages for select
  to authenticated
  using (public.is_admin());

-- ============================================================
-- 3. Sending
-- ============================================================
create or replace function public.send_quote_message(p_quote_id uuid, p_body text)
returns public.quote_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role  text;
  v_body  text := btrim(coalesce(p_body, ''));
  v_order uuid;
  v_row   public.quote_messages%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  v_role := public.quote_thread_role(p_quote_id);
  if v_role is null then
    -- Same wording whether the quote is someone else's or does not
    -- exist, so this cannot be used to probe for other shops' quotes.
    raise exception 'That conversation is not yours' using errcode = '42501';
  end if;

  if length(v_body) = 0 then
    raise exception 'A message cannot be empty' using errcode = '22023';
  end if;
  if length(v_body) > 2000 then
    raise exception 'Keep a message under 2,000 characters' using errcode = '22023';
  end if;

  -- A suspended account can still read, but not write — the same rule
  -- suspension follows everywhere else.
  if exists (select 1 from public.profiles p where p.id = auth.uid() and p.suspended_at is not null) then
    raise exception 'This account is suspended' using errcode = '42501';
  end if;

  select o.id into v_order
  from public.orders o
  where o.quote_id = p_quote_id
    and o.payment_status in ('escrow_held', 'escrow_released', 'paid')
  order by o.created_at desc
  limit 1;

  insert into public.quote_messages (quote_id, order_id, sender_id, sender_role, body)
  values (p_quote_id, v_order, auth.uid(), v_role, v_body)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.send_quote_message(uuid, text) from public;
grant execute on function public.send_quote_message(uuid, text) to authenticated;

-- ============================================================
-- 4. Reading
-- ============================================================
-- Marks the OTHER side's messages read. Your own messages are never
-- "unread" to you, so there is nothing to mark on them.
create or replace function public.mark_quote_thread_read(p_quote_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.quote_thread_role(p_quote_id);
  v_n    integer;
begin
  if v_role is null then
    raise exception 'That conversation is not yours' using errcode = '42501';
  end if;

  update public.quote_messages m
     set read_at = now()
   where m.quote_id = p_quote_id
     and m.sender_role <> v_role
     and m.read_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.mark_quote_thread_read(uuid) from public;
grant execute on function public.mark_quote_thread_read(uuid) to authenticated;

-- ============================================================
-- 5. The vendor's inbox
-- ============================================================
-- One row per quote this shop has sent, with its latest message and
-- unread count. Every non-draft quote is listed, not only ones with
-- messages already, so a shop can open the conversation — "we can
-- deliver Saturday, does that work?" — without waiting to be asked.
--
-- Customer name comes through here for the same reason it does in
-- vendor_quote_list(): every row is a quote this vendor wrote, which is
-- the engagement the queue's name gate tests for.
create or replace function public.vendor_message_threads()
returns table (
  quote_id                 uuid,
  request_id               uuid,
  reference                text,
  quote_status             text,
  school_name              text,
  class_level              text,
  customer_name            text,
  total_price              numeric,
  order_id                 uuid,
  order_reference          text,
  order_fulfillment_status text,
  last_message             text,
  last_message_at          timestamptz,
  last_sender_role         text,
  message_count            bigint,
  unread_count             bigint,
  activity_at              timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  my_vendor uuid;
begin
  select v.id into my_vendor from public.vendors v where v.profile_id = auth.uid();
  if my_vendor is null then
    return;  -- not a vendor: empty inbox, not an error
  end if;

  return query
  select
    q.id,
    r.id,
    'REQ-' || upper(substr(replace(r.id::text, '-', ''), 1, 6)),
    q.status,
    r.school_name,
    r.class_level,
    p.full_name,
    q.total_price,
    o.id,
    case when o.id is null then null
         else 'LOCI-' || upper(substr(replace(o.id::text, '-', ''), 1, 6)) end,
    o.fulfillment_status,
    lm.body,
    lm.created_at,
    lm.sender_role,
    coalesce(mc.n, 0),
    coalesce(mc.unread, 0),
    greatest(q.updated_at, coalesce(lm.created_at, q.updated_at))
  from public.quotes q
  join public.book_requests r on r.id = q.request_id
  left join public.profiles p on p.id = r.buyer_id
  left join lateral (
    select o2.id, o2.fulfillment_status
    from public.orders o2
    where o2.quote_id = q.id
      and o2.payment_status in ('escrow_held', 'escrow_released', 'paid')
    order by o2.created_at desc
    limit 1
  ) o on true
  left join lateral (
    select m.body, m.created_at, m.sender_role
    from public.quote_messages m
    where m.quote_id = q.id
    order by m.created_at desc
    limit 1
  ) lm on true
  left join lateral (
    select count(*) as n,
           count(*) filter (where m.sender_role = 'buyer' and m.read_at is null) as unread
    from public.quote_messages m
    where m.quote_id = q.id
  ) mc on true
  where q.vendor_id = my_vendor
    and q.status <> 'draft'
  order by 17 desc;
end;
$$;

revoke all on function public.vendor_message_threads() from public;
grant execute on function public.vendor_message_threads() to authenticated;

-- The sidebar badge. Cheaper than pulling the whole inbox on every
-- navigation just to count it.
create or replace function public.vendor_unread_message_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)
  from public.quote_messages m
  join public.quotes q  on q.id = m.quote_id
  join public.vendors v on v.id = q.vendor_id
  where v.profile_id = auth.uid()
    and m.sender_role = 'buyer'
    and m.read_at is null;
$$;

revoke all on function public.vendor_unread_message_count() from public;
grant execute on function public.vendor_unread_message_count() to authenticated;

-- ============================================================
-- 6. Live delivery
-- ============================================================
-- Realtime respects the SELECT policy above, so adding the table to the
-- publication does not widen who can see what.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quote_messages'
  ) then
    alter publication supabase_realtime add table public.quote_messages;
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
