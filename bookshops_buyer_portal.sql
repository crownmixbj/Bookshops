-- Bookshops — the buyer portal: household, inbox, alerts, receipt, bundles
--
-- Brings the buyer side level with the vendor side. Six pieces, each of
-- which the app can live without (every screen checks for a missing
-- table or function and says which file to run), but which only make
-- sense together:
--
--   1. children            A household is several children at several
--                          schools. A booklist now names which child it
--                          is for, so "JSS 2" and "Primary 4" stop being
--                          two anonymous lists from the same parent.
--   2. delivery_addresses  An address book. The default one is mirrored
--                          onto profiles.default_delivery_*, so every
--                          older code path that prefills from the
--                          profile keeps working untouched.
--   3. notifications       The buyer's alert inbox, filled by triggers on
--                          quotes, orders and messages — so it is right
--                          no matter who or what made the change.
--   4. buyer messaging     The buyer's half of bookshops_messaging.sql:
--                          an inbox RPC and an unread count. Sending and
--                          read-marking already work for both sides.
--   5. confirm receipt     The buyer's step that releases escrow. Also
--                          fixes vendor_payout_summary(), which counted
--                          only 'paid' and so would never have paid a
--                          shop for an escrow order at all.
--   6. checkout bundles    One Paystack charge for several accepted
--                          quotes (two children, two lists, one trip to
--                          the bank). Each quote still becomes its OWN
--                          order, because escrow is released per shop,
--                          per delivery.
--
-- Safe to run more than once. Adds tables, columns, policies, triggers
-- and functions; the only existing rows it touches are the one-off
-- address-book seed in section 2.
--
-- Requires: bookshops_escrow_checkout.sql, bookshops_messaging.sql,
--           bookshops_payouts.sql, bookshops_vendor_dispatch.sql.

begin;

-- ============================================================
-- 0. Columns an earlier file declared but this project never got
-- ============================================================
-- bookshops_delivery_address.sql adds these; the live project only has
-- default_delivery_state (from the escrow file). Settings has been
-- writing all three, so its Save has been failing with "column does not
-- exist". Adding them here closes that gap whichever order files ran in.
alter table public.profiles
  add column if not exists default_delivery_lga text
    check (default_delivery_lga is null or length(default_delivery_lga) <= 80),
  add column if not exists default_delivery_landmark text
    check (default_delivery_landmark is null or length(default_delivery_landmark) <= 200);

-- ============================================================
-- 1. Children
-- ============================================================
create table if not exists public.children (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  full_name    text not null check (length(btrim(full_name)) between 1 and 80),
  school_name  text check (school_name is null or length(school_name) <= 120),
  class_level  text check (class_level is null or length(class_level) <= 40),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.children is
  'A buyer''s children. Visible only to the parent: vendors see a booklist''s school and class, never the child''s name.';

create index if not exists children_parent_idx on public.children (parent_id, created_at);

alter table public.children enable row level security;

drop policy if exists children_select_own on public.children;
create policy children_select_own on public.children
  for select to authenticated using (parent_id = (select auth.uid()));

drop policy if exists children_insert_own on public.children;
create policy children_insert_own on public.children
  for insert to authenticated
  with check (parent_id = (select auth.uid()) and not public.is_suspended());

drop policy if exists children_update_own on public.children;
create policy children_update_own on public.children
  for update to authenticated
  using (parent_id = (select auth.uid()))
  with check (parent_id = (select auth.uid()));

drop policy if exists children_delete_own on public.children;
create policy children_delete_own on public.children
  for delete to authenticated using (parent_id = (select auth.uid()));

drop trigger if exists touch_children on public.children;
create trigger touch_children before update on public.children
  for each row execute function public.touch_updated_at();

-- Which child a booklist is for. SET NULL on delete: removing a child
-- profile must not delete the booklists (or orders) raised for them.
alter table public.book_requests
  add column if not exists child_id uuid references public.children(id) on delete set null;

create index if not exists book_requests_child_idx on public.book_requests (child_id)
  where child_id is not null;

-- RLS on book_requests checks buyer_id and nothing else, so without
-- this a buyer could tag their list with another parent's child id —
-- harmless to read (they cannot see that child) but a foreign key into
-- someone else's household is not a thing to allow.
create or replace function public.guard_request_child()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.child_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.child_id is not distinct from old.child_id then
      return new;
    end if;
  end if;
  if not exists (
    select 1 from public.children c
    where c.id = new.child_id and c.parent_id = new.buyer_id
  ) then
    raise exception 'That child profile is not on this account' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_request_child on public.book_requests;
create trigger guard_request_child
  before insert or update of child_id on public.book_requests
  for each row execute function public.guard_request_child();

-- ============================================================
-- 2. Delivery address book
-- ============================================================
create table if not exists public.delivery_addresses (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label          text not null default 'Home' check (length(btrim(label)) between 1 and 40),
  recipient_name text not null check (length(btrim(recipient_name)) between 2 and 120),
  phone          text not null check (length(btrim(phone)) between 7 and 20),
  address        text not null check (length(btrim(address)) between 4 and 300),
  city           text not null check (length(btrim(city)) between 2 and 80),
  state          text check (state is null or length(state) <= 60),
  lga            text check (lga is null or length(lga) <= 80),
  landmark       text check (landmark is null or length(landmark) <= 200),
  is_default     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.delivery_addresses is
  'Saved addresses that prefill checkout. orders.delivery_* stays the record of where an order actually went, so editing or deleting one here never rewrites history.';

create index if not exists delivery_addresses_profile_idx
  on public.delivery_addresses (profile_id, created_at);

-- At most one default per person. The trigger below keeps it that way
-- without the client having to clear the old one first.
create unique index if not exists delivery_addresses_one_default
  on public.delivery_addresses (profile_id) where is_default;

alter table public.delivery_addresses enable row level security;

drop policy if exists delivery_addresses_select_own on public.delivery_addresses;
create policy delivery_addresses_select_own on public.delivery_addresses
  for select to authenticated using (profile_id = (select auth.uid()));

drop policy if exists delivery_addresses_insert_own on public.delivery_addresses;
create policy delivery_addresses_insert_own on public.delivery_addresses
  for insert to authenticated
  with check (profile_id = (select auth.uid()) and not public.is_suspended());

drop policy if exists delivery_addresses_update_own on public.delivery_addresses;
create policy delivery_addresses_update_own on public.delivery_addresses
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists delivery_addresses_delete_own on public.delivery_addresses;
create policy delivery_addresses_delete_own on public.delivery_addresses
  for delete to authenticated using (profile_id = (select auth.uid()));

drop trigger if exists touch_delivery_addresses on public.delivery_addresses;
create trigger touch_delivery_addresses before update on public.delivery_addresses
  for each row execute function public.touch_updated_at();

-- Before: a new default demotes the old one, and a person's first
-- address is their default whether or not they ticked the box.
create or replace function public.delivery_address_default_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- INSERT only. On UPDATE this would fight the demotion below: while
  -- a new default is being inserted, the old one is briefly the only
  -- row on file, and re-promoting it breaks the one-default index.
  if tg_op = 'INSERT' then
    if not new.is_default and not exists (
      select 1 from public.delivery_addresses a
      where a.profile_id = new.profile_id
    ) then
      new.is_default := true;
    end if;
  end if;

  if new.is_default then
    update public.delivery_addresses a
       set is_default = false
     where a.profile_id = new.profile_id
       and a.id <> new.id
       and a.is_default;
  end if;
  return new;
end;
$$;

drop trigger if exists delivery_address_default_before on public.delivery_addresses;
create trigger delivery_address_default_before
  before insert or update of is_default on public.delivery_addresses
  for each row execute function public.delivery_address_default_before();

-- After: mirror the default onto the profile, so checkout_quote-era code
-- and anything else that prefills from profiles keeps the right answer.
create or replace function public.delivery_address_sync_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_row     public.delivery_addresses%rowtype;
begin
  if tg_op = 'DELETE' then
    v_profile := old.profile_id;
  else
    v_profile := new.profile_id;
  end if;

  -- Deleting the default promotes the most recent remaining address.
  if tg_op = 'DELETE' then
   if old.is_default then
    update public.delivery_addresses a
       set is_default = true
     where a.id = (
       select a2.id from public.delivery_addresses a2
       where a2.profile_id = v_profile
       order by a2.updated_at desc
       limit 1
     );
    -- That update fires this trigger again and syncs the profile. If
    -- nothing was left to promote, clear the prefill instead of leaving
    -- a deleted address in it.
    if not found then
      update public.profiles p set
        default_delivery_address  = null,
        default_delivery_city     = null,
        default_delivery_state    = null,
        default_delivery_lga      = null,
        default_delivery_landmark = null,
        default_delivery_phone    = null
      where p.id = v_profile;
    end if;
    return null;
   end if;
  end if;

  select * into v_row
  from public.delivery_addresses a
  where a.profile_id = v_profile and a.is_default
  limit 1;

  if found then
    update public.profiles p set
      default_delivery_address  = v_row.address,
      default_delivery_city     = v_row.city,
      default_delivery_state    = v_row.state,
      default_delivery_lga      = v_row.lga,
      default_delivery_landmark = v_row.landmark,
      default_delivery_phone    = v_row.phone
    where p.id = v_profile;
  end if;
  return null;
end;
$$;

drop trigger if exists delivery_address_sync_profile on public.delivery_addresses;
create trigger delivery_address_sync_profile
  after insert or update or delete on public.delivery_addresses
  for each row execute function public.delivery_address_sync_profile();

-- One-off seed: a buyer who already saved a default address in Settings
-- finds it in their address book rather than an empty list.
insert into public.delivery_addresses
  (profile_id, label, recipient_name, phone, address, city, state, lga, landmark, is_default)
select
  p.id, 'Home', p.full_name,
  coalesce(nullif(btrim(p.default_delivery_phone), ''), p.phone_number),
  p.default_delivery_address, p.default_delivery_city,
  p.default_delivery_state, p.default_delivery_lga, p.default_delivery_landmark,
  true
from public.profiles p
where p.role = 'buyer'
  and length(btrim(coalesce(p.default_delivery_address, ''))) >= 4
  and length(btrim(coalesce(p.default_delivery_city, ''))) >= 2
  and length(btrim(coalesce(p.full_name, ''))) >= 2
  and length(btrim(coalesce(p.default_delivery_phone, p.phone_number, ''))) >= 7
  and not exists (select 1 from public.delivery_addresses a where a.profile_id = p.id);

-- ============================================================
-- 3. Notifications
-- ============================================================
-- One table for every role, keyed on auth.users, so a vendor alert
-- centre can read the same thing later. Today only buyer events write.
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in (
                 'quote_received', 'quote_updated', 'quote_withdrawn',
                 'message', 'payment_held', 'order_dispatched',
                 'order_delivered', 'order_cancelled', 'escrow_released')),
  title        text not null,
  body         text,
  -- An in-app route, e.g. /quotes/<id>. Never a full URL: the client
  -- pushes it through the router, so it cannot point off-site.
  link         text check (link is null or link like '/%'),
  quote_id     uuid references public.quotes(id) on delete cascade,
  order_id     uuid references public.orders(id) on delete cascade,
  request_id   uuid references public.book_requests(id) on delete cascade,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);

comment on table public.notifications is
  'In-app alerts. Written only by triggers (via push_notification); read state only through mark_notifications_read().';

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (recipient_id) where read_at is null;

alter table public.notifications enable row level security;

-- Read only. No INSERT/UPDATE/DELETE policy: triggers write, the RPC
-- below marks read. Realtime applies this policy too.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated using (recipient_id = (select auth.uid()));

-- The single writer. p_dedupe folds a burst into one row: a vendor
-- revising three lines of a sent quote fires three total updates, and
-- a buyer should see "quote updated" once, not three times.
create or replace function public.push_notification(
  p_recipient uuid,
  p_kind      text,
  p_title     text,
  p_body      text,
  p_link      text,
  p_quote     uuid default null,
  p_order     uuid default null,
  p_request   uuid default null,
  p_dedupe    boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
begin
  if p_recipient is null then
    return;
  end if;

  if p_dedupe then
    select n.id into v_existing
    from public.notifications n
    where n.recipient_id = p_recipient
      and n.kind = p_kind
      and n.read_at is null
      and n.quote_id is not distinct from p_quote
      and n.order_id is not distinct from p_order
    order by n.created_at desc
    limit 1;

    if v_existing is not null then
      update public.notifications n
         set title = p_title, body = p_body, link = p_link, created_at = now()
       where n.id = v_existing;
      return;
    end if;
  end if;

  insert into public.notifications (recipient_id, kind, title, body, link, quote_id, order_id, request_id)
  values (p_recipient, p_kind, p_title, left(p_body, 280), p_link, p_quote, p_order, p_request);
end;
$$;

revoke all on function public.push_notification(uuid, text, text, text, text, uuid, uuid, uuid, boolean) from public;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  update public.notifications n
     set read_at = now()
   where n.recipient_id = auth.uid()
     and n.read_at is null
     and (p_ids is null or n.id = any (p_ids));

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.mark_notifications_read(uuid[]) from public;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- ---- quote events -------------------------------------------------
create or replace function public.notify_quote_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer  uuid;
  v_school text;
  v_store  text;
  v_what   text;
begin
  select r.buyer_id, r.school_name into v_buyer, v_school
  from public.book_requests r where r.id = new.request_id;
  select v.store_name into v_store from public.vendors v where v.id = new.vendor_id;

  v_what := coalesce(nullif(v_school, ''), 'your booklist');

  -- OLD is not touched on INSERT: each branch is guarded by tg_op
  -- first, in nested IFs rather than one boolean, because SQL does not
  -- promise to short-circuit OR.
  if tg_op = 'INSERT' then
    if new.status = 'sent' then
      perform public.push_notification(
        v_buyer, 'quote_received',
        'New quote from ' || coalesce(v_store, 'a bookshop'),
        v_what || ' — ₦' || to_char(coalesce(new.total_price, 0), 'FM999,999,999,990'),
        '/quotes/' || new.id, new.id, null, new.request_id, false);
    end if;
    return null;
  end if;

  if new.status = 'sent' and old.status is distinct from 'sent' then
    perform public.push_notification(
      v_buyer, 'quote_received',
      'New quote from ' || coalesce(v_store, 'a bookshop'),
      v_what || ' — ₦' || to_char(coalesce(new.total_price, 0), 'FM999,999,999,990'),
      '/quotes/' || new.id, new.id, null, new.request_id, false);

  elsif old.status = 'sent' and new.status = 'sent'
        and new.total_price is distinct from old.total_price then
    perform public.push_notification(
      v_buyer, 'quote_updated',
      coalesce(v_store, 'A bookshop') || ' revised their quote',
      v_what || ' — now ₦' || to_char(coalesce(new.total_price, 0), 'FM999,999,999,990'),
      '/quotes/' || new.id, new.id, null, new.request_id, true);

  elsif old.status = 'sent' and new.status = 'withdrawn' then
    perform public.push_notification(
      v_buyer, 'quote_withdrawn',
      coalesce(v_store, 'A bookshop') || ' withdrew their quote',
      v_what, '/booklists/' || new.request_id, new.id, null, new.request_id, false);
  end if;

  return null;
end;
$$;

drop trigger if exists notify_quote_change on public.quotes;
create trigger notify_quote_change
  after insert or update of status, total_price on public.quotes
  for each row execute function public.notify_quote_change();

-- ---- order events -------------------------------------------------
create or replace function public.notify_order_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store text;
  v_ref   text := 'LOCI-' || upper(substr(replace(new.id::text, '-', ''), 1, 6));
  v_link  text := '/orders?order=' || new.id;
begin
  select v.store_name into v_store
  from public.quotes q join public.vendors v on v.id = q.vendor_id
  where q.id = new.quote_id;
  v_store := coalesce(v_store, 'the shop');

  if tg_op = 'INSERT' then
    if new.payment_status = 'escrow_held' then
      perform public.push_notification(
        new.buyer_id, 'payment_held', 'Payment secured in escrow',
        v_ref || ' — ' || v_store || ' has been told to prepare your books.',
        v_link, new.quote_id, new.id, null, false);
    end if;
    return null;
  end if;

  if new.payment_status = 'escrow_held' and old.payment_status is distinct from 'escrow_held' then
    perform public.push_notification(
      new.buyer_id, 'payment_held', 'Payment secured in escrow',
      v_ref || ' — ' || v_store || ' has been told to prepare your books.',
      v_link, new.quote_id, new.id, null, false);
  end if;

  if new.fulfillment_status is distinct from old.fulfillment_status then
    if new.fulfillment_status = 'dispatched' then
      perform public.push_notification(
        new.buyer_id, 'order_dispatched', 'Your books are on the way',
        v_ref || ' — dispatched by ' || v_store || '.',
        v_link, new.quote_id, new.id, null, false);
    elsif new.fulfillment_status = 'delivered' and new.payment_status = 'escrow_held' then
      -- Only while money is still held: if the buyer confirmed receipt
      -- themselves, telling them to confirm receipt would be noise.
      perform public.push_notification(
        new.buyer_id, 'order_delivered', 'Delivered — please confirm receipt',
        v_ref || ' — ' || v_store || ' marked this delivered. Confirm to release payment, or report a problem.',
        v_link, new.quote_id, new.id, null, false);
    elsif new.fulfillment_status = 'cancelled' then
      perform public.push_notification(
        new.buyer_id, 'order_cancelled', 'Order cancelled',
        v_ref || ' — ' || v_store || '.', v_link, new.quote_id, new.id, null, false);
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists notify_order_change on public.orders;
create trigger notify_order_change
  after insert or update of payment_status, fulfillment_status on public.orders
  for each row execute function public.notify_order_change();

-- ---- message events -----------------------------------------------
create or replace function public.notify_quote_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer uuid;
  v_store text;
  v_req   uuid;
begin
  if new.sender_role <> 'vendor' then
    return null;
  end if;

  select r.buyer_id, v.store_name, r.id into v_buyer, v_store, v_req
  from public.quotes q
  join public.book_requests r on r.id = q.request_id
  join public.vendors v on v.id = q.vendor_id
  where q.id = new.quote_id;

  perform public.push_notification(
    v_buyer, 'message', 'New message from ' || coalesce(v_store, 'a bookshop'),
    new.body, '/messages?quote=' || new.quote_id, new.quote_id, null, v_req, true);
  return null;
end;
$$;

drop trigger if exists notify_quote_message on public.quote_messages;
create trigger notify_quote_message
  after insert on public.quote_messages
  for each row execute function public.notify_quote_message();

-- ============================================================
-- 4. The buyer's inbox
-- ============================================================
-- One row per quote on this buyer's lists that is worth a conversation:
-- any thread with messages, plus every quote still open or turned into
-- an order. A rejected quote nobody ever wrote about is not a thread.
create or replace function public.buyer_message_threads()
returns table (
  quote_id                 uuid,
  request_id               uuid,
  reference                text,
  quote_status             text,
  school_name              text,
  class_level              text,
  child_name               text,
  store_name               text,
  vendor_id                uuid,
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
begin
  if auth.uid() is null then
    return;
  end if;

  return query
  select
    q.id,
    r.id,
    'REQ-' || upper(substr(replace(r.id::text, '-', ''), 1, 6)),
    q.status,
    r.school_name,
    r.class_level,
    c.full_name,
    v.store_name,
    v.id,
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
  join public.vendors v       on v.id = q.vendor_id
  left join public.children c on c.id = r.child_id
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
           count(*) filter (where m.sender_role = 'vendor' and m.read_at is null) as unread
    from public.quote_messages m
    where m.quote_id = q.id
  ) mc on true
  where r.buyer_id = auth.uid()
    and q.status <> 'draft'
    and (coalesce(mc.n, 0) > 0 or q.status in ('sent', 'accepted') or o.id is not null)
  order by 19 desc;
end;
$$;

revoke all on function public.buyer_message_threads() from public;
grant execute on function public.buyer_message_threads() to authenticated;

create or replace function public.buyer_unread_message_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)
  from public.quote_messages m
  join public.quotes q        on q.id = m.quote_id
  join public.book_requests r on r.id = q.request_id
  where r.buyer_id = auth.uid()
    and m.sender_role = 'vendor'
    and m.read_at is null;
$$;

revoke all on function public.buyer_unread_message_count() from public;
grant execute on function public.buyer_unread_message_count() to authenticated;

-- ============================================================
-- 5. Confirm receipt, release escrow
-- ============================================================
-- The buyer's only lever on money, and deliberately a one-way door.
--
-- Allowed from any live fulfilment state, not only 'delivered': a
-- parent who collected in person, or whose shop never pressed
-- "delivered", still has the books and should be able to say so. What
-- it will not do is release money that was never held, or release it
-- twice. Idempotent: a second tap returns the same row.
create or replace function public.confirm_order_receipt(p_order_id uuid)
returns table (order_id uuid, payment_status text, fulfillment_status text, escrow_released_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;

  if not found or v_order.buyer_id <> auth.uid() then
    raise exception 'That order is not yours' using errcode = '42501';
  end if;

  if v_order.payment_status = 'escrow_released' then
    order_id := v_order.id;
    payment_status := v_order.payment_status;
    fulfillment_status := v_order.fulfillment_status;
    escrow_released_at := v_order.escrow_released_at;
    return next;
    return;
  end if;

  if v_order.payment_status <> 'escrow_held' then
    raise exception 'There is no payment held in escrow for this order (payment is %)', v_order.payment_status
      using errcode = '22023';
  end if;

  if v_order.fulfillment_status = 'cancelled' then
    raise exception 'This order was cancelled — contact support about a refund instead'
      using errcode = '22023';
  end if;

  update public.orders o set
    payment_status     = 'escrow_released',
    escrow_released_at = now(),
    fulfillment_status = 'delivered',
    delivered_at       = coalesce(o.delivered_at, now())
  where o.id = v_order.id
  returning o.id, o.payment_status, o.fulfillment_status, o.escrow_released_at
    into order_id, payment_status, fulfillment_status, escrow_released_at;

  return next;
end;
$$;

revoke all on function public.confirm_order_receipt(uuid) from public;
grant execute on function public.confirm_order_receipt(uuid) to authenticated;

-- vendor_payout_summary() counted only payment_status = 'paid'. Every
-- order since escrow checkout is 'escrow_held' then 'escrow_released',
-- so no shop could ever have been paid. Same function, one line wider.
create or replace function public.vendor_payout_summary()
returns table (
  vendor_id          uuid,
  total_revenue      numeric,
  commission         numeric,
  net_earned         numeric,
  paid_out           numeric,
  pending_payouts    numeric,
  available_balance  numeric,
  minimum_amount     numeric,
  has_bank_account   boolean,
  can_request        boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid;
  v_rate    numeric;
  v_min     numeric;
  v_gross   numeric;
  v_paid    numeric;
  v_pending numeric;
  v_bank    boolean;
begin
  select v.id into v_id
  from public.vendors v
  where v.profile_id = auth.uid()
  limit 1;

  if v_id is null then
    return;
  end if;

  select s.commission_rate, s.minimum_amount into v_rate, v_min
  from public.payout_settings s where s.id;

  -- Delivered AND the buyer's money is the shop's: released from escrow,
  -- or a legacy direct payment. escrow_held is NOT counted — that money
  -- is still refundable to the buyer.
  select coalesce(sum(o.amount), 0) into v_gross
  from public.orders o
  join public.quotes q on q.id = o.quote_id
  where q.vendor_id = v_id
    and o.fulfillment_status = 'delivered'
    and o.payment_status in ('paid', 'escrow_released');

  select coalesce(sum(p.amount), 0) into v_paid
  from public.payout_requests p
  where p.vendor_id = v_id and p.status = 'completed';

  select coalesce(sum(p.amount), 0) into v_pending
  from public.payout_requests p
  where p.vendor_id = v_id and p.status in ('pending','processing');

  select exists (
    select 1 from public.vendor_bank_accounts b where b.vendor_id = v_id
  ) into v_bank;

  vendor_id         := v_id;
  total_revenue     := v_gross;
  commission        := round(v_gross * v_rate, 2);
  net_earned        := v_gross - round(v_gross * v_rate, 2);
  paid_out          := v_paid;
  pending_payouts   := v_pending;
  available_balance := greatest(net_earned - v_paid - v_pending, 0);
  minimum_amount    := v_min;
  has_bank_account  := v_bank;
  can_request       := v_bank and available_balance >= v_min;
  return next;
end;
$$;

revoke all on function public.vendor_payout_summary() from public;
grant execute on function public.vendor_payout_summary() to authenticated;

-- ============================================================
-- 6. Checkout bundles — several quotes, one charge
-- ============================================================
create table if not exists public.checkout_groups (
  id                uuid primary key default gen_random_uuid(),
  buyer_id          uuid not null references auth.users(id) on delete cascade,
  payment_reference text not null unique,
  payment_provider  text check (payment_provider is null or payment_provider in ('paystack', 'test')),
  gateway_reference text,
  amount            numeric(12,2) not null check (amount >= 0),
  currency          text not null default 'NGN' check (currency = 'NGN'),
  status            text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  created_at        timestamptz not null default now(),
  paid_at           timestamptz
);

comment on table public.checkout_groups is
  'One payment covering several orders. The reference here is what Paystack sees; each order keeps its own escrow state so a shop is paid when ITS delivery is confirmed.';

alter table public.checkout_groups enable row level security;

drop policy if exists checkout_groups_select_own on public.checkout_groups;
create policy checkout_groups_select_own on public.checkout_groups
  for select to authenticated using (buyer_id = (select auth.uid()) or public.is_admin());

alter table public.orders
  add column if not exists checkout_group_id uuid references public.checkout_groups(id) on delete set null;

create index if not exists orders_checkout_group_idx on public.orders (checkout_group_id)
  where checkout_group_id is not null;

-- ---- the priced lines of a bundle ---------------------------------
-- The one place a bundle is priced, used by the summary the buyer sees
-- AND by the functions that charge — so the two cannot disagree.
--
-- Delivery is charged once per SHOP, not once per quote: two children's
-- lists from the same shop travel in one parcel. The fee sits on the
-- first quote from each shop, in the order given.
--
-- Never raises. `problem` says why a line cannot be paid for; the
-- callers decide whether that is a message or an exception.
create or replace function public.bundle_lines(p_buyer uuid, p_quote_ids uuid[])
returns table (
  quote_id     uuid,
  request_id   uuid,
  vendor_id    uuid,
  store_name   text,
  school_name  text,
  class_level  text,
  child_name   text,
  items_total  numeric,
  delivery_fee numeric,
  line_total   numeric,
  problem      text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fee numeric;
begin
  select coalesce(s.delivery_fee, 0) into v_fee from public.payout_settings s where s.id;
  v_fee := coalesce(v_fee, 0);

  return query
  with wanted as (
    select distinct on (w.qid) w.qid, w.ord
    from unnest(p_quote_ids) with ordinality as w(qid, ord)
    order by w.qid, w.ord
  ),
  base as (
    select
      w.ord,
      q.id            as qid,
      q.request_id    as rid,
      q.vendor_id     as vid,
      v.store_name    as store,
      r.school_name   as school,
      r.class_level   as klass,
      c.full_name     as child,
      q.total_price   as items,
      case
        when q.id is null or r.buyer_id is distinct from p_buyer then 'not_found'
        when q.status not in ('sent', 'accepted') then 'not_open'
        when exists (
          select 1 from public.orders o
          where o.quote_id = q.id
            and o.payment_status in ('escrow_held', 'escrow_released', 'paid')
        ) then 'already_paid'
        when exists (
          select 1 from public.orders o
          join public.quotes q2 on q2.id = o.quote_id
          where q2.request_id = q.request_id
            and o.payment_status in ('escrow_held', 'escrow_released', 'paid')
        ) then 'booklist_ordered'
        else null
      end as problem,
      -- Two quotes for the same booklist cannot both be bought.
      row_number() over (partition by q.request_id order by w.ord) as nth_for_list
    from wanted w
    left join public.quotes q        on q.id = w.qid
    left join public.book_requests r on r.id = q.request_id
    left join public.vendors v       on v.id = q.vendor_id
    left join public.children c      on c.id = r.child_id
  ),
  checked as (
    select b.*,
      coalesce(b.problem, case when b.nth_for_list > 1 then 'duplicate_booklist' end) as final_problem
    from base b
  ),
  fees as (
    select ch.*,
      case
        when ch.final_problem is null
         and row_number() over (partition by ch.vid, (ch.final_problem is null) order by ch.ord) = 1
        then v_fee else 0
      end as fee
    from checked ch
  )
  select
    f.qid, f.rid, f.vid, f.store, f.school, f.klass, f.child,
    coalesce(f.items, 0),
    f.fee,
    coalesce(f.items, 0) + f.fee,
    f.final_problem
  from fees f
  order by f.ord;
end;
$$;

revoke all on function public.bundle_lines(uuid, uuid[]) from public;

-- What the buyer sees on the bundle checkout. Same numbers as the charge.
create or replace function public.checkout_bundle(p_quote_ids uuid[])
returns table (
  quote_id     uuid,
  request_id   uuid,
  vendor_id    uuid,
  store_name   text,
  school_name  text,
  class_level  text,
  child_name   text,
  items_total  numeric,
  delivery_fee numeric,
  line_total   numeric,
  problem      text,
  bundle_total numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if coalesce(array_length(p_quote_ids, 1), 0) = 0 then
    return;
  end if;
  if array_length(p_quote_ids, 1) > 12 then
    raise exception 'A bundle can hold at most 12 quotes' using errcode = '22023';
  end if;

  return query
  select l.*, sum(l.line_total) filter (where l.problem is null) over ()
  from public.bundle_lines(auth.uid(), p_quote_ids) l;
end;
$$;

revoke all on function public.checkout_bundle(uuid[]) from public;
grant execute on function public.checkout_bundle(uuid[]) to authenticated;

-- ---- settling one order (shared) ----------------------------------
-- Money arrived for this order: hold it, accept its quote, reject the
-- siblings, mark the booklist ordered. Used by single and bundle
-- finalisation alike, so the two can never settle differently.
create or replace function public.settle_escrow_order(
  p_order_id          uuid,
  p_provider          text,
  p_gateway_reference text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote   uuid;
  v_request uuid;
begin
  update public.orders o set
    payment_status    = 'escrow_held',
    payment_provider  = p_provider,
    gateway_reference = p_gateway_reference,
    paid_at           = coalesce(o.paid_at, now())
  where o.id = p_order_id
    and o.payment_status not in ('escrow_held', 'escrow_released', 'paid')
  returning o.quote_id into v_quote;

  if v_quote is null then
    return;  -- already settled
  end if;

  update public.quotes q
     set status = 'accepted', updated_at = now()
   where q.id = v_quote and q.status <> 'accepted'
  returning q.request_id into v_request;

  if v_request is null then
    select q.request_id into v_request from public.quotes q where q.id = v_quote;
  end if;

  update public.quotes q
     set status = 'rejected', updated_at = now()
   where q.request_id = v_request
     and q.id <> v_quote
     and q.status = 'sent';

  update public.book_requests r
     set status = 'ordered', updated_at = now()
   where r.id = v_request;
end;
$$;

revoke all on function public.settle_escrow_order(uuid, text, text) from public;

-- ---- opening a bundle charge (service role) ------------------------
create or replace function public.begin_escrow_bundle(
  p_buyer_id         uuid,
  p_quote_ids        uuid[],
  p_delivery_name    text,
  p_delivery_phone   text,
  p_delivery_address text,
  p_delivery_city    text,
  p_delivery_state   text default null,
  p_delivery_notes   text default null
)
returns table (group_id uuid, payment_reference text, amount numeric, currency text, order_ids uuid[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bad    text;
  v_total  numeric;
  v_group  public.checkout_groups%rowtype;
  v_line   record;
  v_order  uuid;
  v_orders uuid[] := '{}';
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'begin_escrow_bundle is service-role only' using errcode = '42501';
  end if;

  if coalesce(array_length(p_quote_ids, 1), 0) = 0 then
    raise exception 'Choose at least one quote' using errcode = '22023';
  end if;
  if array_length(p_quote_ids, 1) > 12 then
    raise exception 'A bundle can hold at most 12 quotes' using errcode = '22023';
  end if;

  select string_agg(coalesce(l.school_name, l.quote_id::text) || ': ' || l.problem, '; ')
    into v_bad
  from public.bundle_lines(p_buyer_id, p_quote_ids) l
  where l.problem is not null;

  if v_bad is not null then
    raise exception 'Some quotes cannot be paid for: %', v_bad using errcode = '23505';
  end if;

  select sum(l.line_total) into v_total from public.bundle_lines(p_buyer_id, p_quote_ids) l;

  -- Anything left pending against these quotes is an abandoned attempt.
  -- Retire it so a stale Paystack page cannot settle a second order for
  -- the same books. (If that stale page IS paid, finalisation still
  -- honours the money — see finalize_escrow_order.)
  update public.checkout_groups g
     set status = 'failed'
   where g.buyer_id = p_buyer_id
     and g.status = 'pending'
     and exists (
       select 1 from public.orders o
       where o.checkout_group_id = g.id and o.quote_id = any (p_quote_ids)
     );

  update public.orders o
     set payment_status = 'failed'
   where o.buyer_id = p_buyer_id
     and o.payment_status = 'pending'
     and o.quote_id = any (p_quote_ids);

  insert into public.checkout_groups (buyer_id, payment_reference, payment_provider, amount)
  values (
    p_buyer_id,
    left('LOCB-' || upper(replace(gen_random_uuid()::text, '-', '')), 21),
    'paystack',
    v_total
  )
  returning * into v_group;

  for v_line in select * from public.bundle_lines(p_buyer_id, p_quote_ids) loop
    insert into public.orders (
      quote_id, buyer_id, amount, delivery_fee, currency,
      payment_status, fulfillment_status, payment_provider, checkout_group_id,
      delivery_name, delivery_phone, delivery_address, delivery_city, delivery_state, delivery_notes
    ) values (
      v_line.quote_id, p_buyer_id, v_line.line_total, v_line.delivery_fee, 'NGN',
      'pending', 'processing', 'paystack', v_group.id,
      p_delivery_name, p_delivery_phone, p_delivery_address, p_delivery_city, p_delivery_state, p_delivery_notes
    )
    returning id into v_order;
    v_orders := v_orders || v_order;
  end loop;

  group_id          := v_group.id;
  payment_reference := v_group.payment_reference;
  amount            := v_group.amount;
  currency          := 'NGN';
  order_ids         := v_orders;
  return next;
end;
$$;

revoke all on function public.begin_escrow_bundle(uuid, uuid[], text, text, text, text, text, text) from public;

-- ---- finalising (single OR bundle) --------------------------------
-- Same signature as before, so the webhook and paystack-verify need no
-- change to settle a bundle: a reference that is not an order's is
-- looked up as a group's.
create or replace function public.finalize_escrow_order(
  p_payment_reference text,
  p_gateway_reference text,
  p_amount_paid       numeric,
  p_provider          text default 'paystack'
)
returns table (order_id uuid, already_finalized boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_group public.checkout_groups%rowtype;
  v_first uuid;
  v_id    uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'finalize_escrow_order is service-role only' using errcode = '42501';
  end if;

  select * into v_order
  from public.orders o
  where o.payment_reference = p_payment_reference
  for update;

  if found then
    if v_order.payment_status in ('escrow_held', 'escrow_released', 'paid') then
      order_id := v_order.id;
      already_finalized := true;
      return next;
      return;
    end if;

    if p_amount_paid + 0.01 < coalesce(v_order.amount, 0) then
      raise exception 'Paid % is short of the % owed on %',
        p_amount_paid, v_order.amount, p_payment_reference using errcode = '22023';
    end if;

    perform public.settle_escrow_order(v_order.id, p_provider, p_gateway_reference);
    order_id := v_order.id;
    already_finalized := false;
    return next;
    return;
  end if;

  -- Not an order reference: a bundle?
  select * into v_group
  from public.checkout_groups g
  where g.payment_reference = p_payment_reference
  for update;

  if not found then
    raise exception 'No order for reference %', p_payment_reference using errcode = 'P0002';
  end if;

  select o.id into v_first
  from public.orders o
  where o.checkout_group_id = v_group.id
  order by o.created_at, o.id
  limit 1;

  if v_group.status = 'paid' then
    order_id := v_first;
    already_finalized := true;
    return next;
    return;
  end if;

  if p_amount_paid + 0.01 < v_group.amount then
    raise exception 'Paid % is short of the % owed on %',
      p_amount_paid, v_group.amount, p_payment_reference using errcode = '22023';
  end if;

  -- Money arrived, so it is honoured even if the group had been retired
  -- as abandoned in the meantime ('failed'): the buyer paid, and a
  -- refund decision belongs to a person, not to this function.
  update public.checkout_groups g set
    status            = 'paid',
    payment_provider  = p_provider,
    gateway_reference = p_gateway_reference,
    paid_at           = now()
  where g.id = v_group.id;

  for v_id in
    select o.id from public.orders o
    where o.checkout_group_id = v_group.id
    order by o.created_at, o.id
  loop
    perform public.settle_escrow_order(v_id, p_provider, p_gateway_reference);
  end loop;

  order_id := v_first;
  already_finalized := false;
  return next;
end;
$$;

revoke all on function public.finalize_escrow_order(text, text, numeric, text) from public;

-- ---- test payments for a bundle ----------------------------------
create or replace function public.simulate_escrow_bundle(
  p_quote_ids        uuid[],
  p_delivery_name    text,
  p_delivery_phone   text,
  p_delivery_address text,
  p_delivery_city    text,
  p_delivery_state   text default null,
  p_delivery_notes   text default null
)
returns table (group_id uuid, order_ids uuid[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_allowed boolean;
  v_bad     text;
  v_total   numeric;
  v_ref     text := left('TESTB-' || upper(replace(gen_random_uuid()::text, '-', '')), 21);
  v_group   uuid;
  v_line    record;
  v_order   uuid;
  v_orders  uuid[] := '{}';
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select s.allow_test_payments into v_allowed from public.payout_settings s where s.id;
  if not coalesce(v_allowed, false) then
    raise exception 'Test payments are switched off for this project'
      using errcode = '42501',
            hint = 'update public.payout_settings set allow_test_payments = true;';
  end if;

  if coalesce(array_length(p_quote_ids, 1), 0) = 0 then
    raise exception 'Choose at least one quote' using errcode = '22023';
  end if;

  select string_agg(coalesce(l.school_name, l.quote_id::text) || ': ' || l.problem, '; ')
    into v_bad
  from public.bundle_lines(v_uid, p_quote_ids) l
  where l.problem is not null;
  if v_bad is not null then
    raise exception 'Some quotes cannot be paid for: %', v_bad using errcode = '23505';
  end if;

  select sum(l.line_total) into v_total from public.bundle_lines(v_uid, p_quote_ids) l;

  insert into public.checkout_groups
    (buyer_id, payment_reference, payment_provider, gateway_reference, amount, status, paid_at)
  values (v_uid, v_ref, 'test', v_ref, v_total, 'paid', now())
  returning id into v_group;

  for v_line in select * from public.bundle_lines(v_uid, p_quote_ids) loop
    insert into public.orders (
      quote_id, buyer_id, amount, delivery_fee, currency,
      payment_status, fulfillment_status, payment_provider, checkout_group_id,
      delivery_name, delivery_phone, delivery_address, delivery_city, delivery_state, delivery_notes
    ) values (
      v_line.quote_id, v_uid, v_line.line_total, v_line.delivery_fee, 'NGN',
      'pending', 'processing', 'test', v_group,
      p_delivery_name, p_delivery_phone, p_delivery_address, p_delivery_city, p_delivery_state, p_delivery_notes
    )
    returning id into v_order;
    perform public.settle_escrow_order(v_order, 'test', v_ref);
    v_orders := v_orders || v_order;
  end loop;

  group_id  := v_group;
  order_ids := v_orders;
  return next;
end;
$$;

revoke all on function public.simulate_escrow_bundle(uuid[], text, text, text, text, text, text) from public;
grant execute on function public.simulate_escrow_bundle(uuid[], text, text, text, text, text, text) to authenticated;

-- ============================================================
-- 7. Live delivery
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
