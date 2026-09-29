-- Bookshops — vendor alerts: the shop's half of the notification bell
--
-- bookshops_buyer_portal.sql built public.notifications as one inbox for
-- every role, but only buyer events ever wrote to it, so the bell in the
-- vendor top bar had nothing behind it. This adds the shop's events,
-- written by triggers exactly like the buyer's — correct whoever or
-- whatever made the change (the buyer's app, the Paystack webhook, an
-- admin):
--
--   request_received   A buyer sent a booklist straight to this shop.
--                      (Open-market lists are NOT alerted: every shop
--                      would get every list. They wait in the queue.)
--   order_placed       A quote from this shop was paid for — books to pack.
--   quote_declined     The buyer declined this quote, or paid another shop.
--   buyer_message      A buyer wrote on one of this shop's threads.
--   payment_released   The buyer confirmed receipt; escrow released.
--
-- The recipient is the shop owner (vendors.profile_id). Reads, realtime
-- and mark-as-read already work for any recipient: notifications_select_own
-- and mark_notifications_read() key on auth.uid(), not on role.
--
-- Safe to run more than once. Requires bookshops_buyer_portal.sql.

begin;

-- ============================================================
-- 1. The new kinds
-- ============================================================
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    -- buyer
    'quote_received', 'quote_updated', 'quote_withdrawn',
    'message', 'payment_held', 'order_dispatched',
    'order_delivered', 'order_cancelled', 'escrow_released',
    -- vendor
    'request_received', 'order_placed', 'quote_declined',
    'buyer_message', 'payment_released'
  ));

-- The shop owner for a vendor row. Null for an unknown vendor, which
-- push_notification() already treats as "nobody to tell".
create or replace function public.vendor_owner(p_vendor_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.profile_id from public.vendors v where v.id = p_vendor_id;
$$;

revoke all on function public.vendor_owner(uuid) from public;

-- ============================================================
-- 2. A booklist sent straight to this shop
-- ============================================================
create or replace function public.notify_vendor_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_what text;
begin
  if new.status <> 'pending_quote' or new.target_vendor_id is null then
    return null;
  end if;

  -- Only on the moment it reaches this shop: published from a draft,
  -- created already published, or re-routed to this shop.
  if tg_op = 'UPDATE'
     and old.status = 'pending_quote'
     and old.target_vendor_id is not distinct from new.target_vendor_id then
    return null;
  end if;

  v_what := concat_ws(' · ', nullif(btrim(new.school_name), ''), nullif(btrim(new.class_level), ''));

  perform public.push_notification(
    public.vendor_owner(new.target_vendor_id), 'request_received',
    'New booklist sent to your shop',
    coalesce(nullif(v_what, ''), 'A buyer is waiting for your quote.'),
    '/vendor/quotes', null, null, new.id, false);
  return null;
end;
$$;

drop trigger if exists notify_vendor_request on public.book_requests;
create trigger notify_vendor_request
  after insert or update of status, target_vendor_id on public.book_requests
  for each row execute function public.notify_vendor_request();

-- ============================================================
-- 3. The buyer said no
-- ============================================================
-- 'rejected' covers both a buyer declining and finalize_escrow_order()
-- closing the siblings when another shop's quote was paid. The body
-- tells them apart, and carries the buyer's reason when they gave one.
create or replace function public.notify_vendor_quote_declined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school text;
begin
  if not (old.status = 'sent' and new.status = 'rejected') then
    return null;
  end if;

  select r.school_name into v_school from public.book_requests r where r.id = new.request_id;

  perform public.push_notification(
    public.vendor_owner(new.vendor_id), 'quote_declined',
    'Quote not taken — ' || coalesce(nullif(v_school, ''), 'a booklist'),
    case
      when nullif(btrim(coalesce(new.decline_reason, '')), '') is not null
        then 'The buyer said: ' || new.decline_reason
      when exists (
        select 1 from public.quotes q2
        where q2.request_id = new.request_id and q2.id <> new.id and q2.status = 'accepted'
      ) then 'The buyer went with another shop.'
      else 'The buyer declined this quote.'
    end,
    '/vendor/quotes', new.id, null, new.request_id, false);
  return null;
end;
$$;

drop trigger if exists notify_vendor_quote_declined on public.quotes;
create trigger notify_vendor_quote_declined
  after update of status on public.quotes
  for each row execute function public.notify_vendor_quote_declined();

-- ============================================================
-- 4. Paid for, and paid out
-- ============================================================
create or replace function public.notify_vendor_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner  uuid;
  v_school text;
  v_ref    text := 'LOCI-' || upper(substr(replace(new.id::text, '-', ''), 1, 6));
begin
  select public.vendor_owner(q.vendor_id), r.school_name into v_owner, v_school
  from public.quotes q
  join public.book_requests r on r.id = q.request_id
  where q.id = new.quote_id;

  -- Paid into escrow: this is the moment a shop has work to do.
  if new.payment_status = 'escrow_held'
     and (tg_op = 'INSERT' or old.payment_status is distinct from 'escrow_held') then
    perform public.push_notification(
      v_owner, 'order_placed',
      'New order ' || v_ref || ' — ready to pack',
      coalesce(nullif(v_school, ''), 'Booklist') || ' · ₦'
        || to_char(coalesce(new.amount, 0), 'FM999,999,999,990') || ' paid into escrow',
      '/vendor/orders', new.quote_id, new.id, null, false);
  end if;

  if tg_op = 'UPDATE'
     and new.payment_status = 'escrow_released'
     and old.payment_status is distinct from 'escrow_released' then
    perform public.push_notification(
      v_owner, 'payment_released',
      'Payment released for ' || v_ref,
      'The buyer confirmed receipt. ₦' || to_char(coalesce(new.amount, 0), 'FM999,999,999,990')
        || ' now counts towards your payout balance.',
      '/vendor/payouts', new.quote_id, new.id, null, false);
  end if;

  return null;
end;
$$;

drop trigger if exists notify_vendor_order on public.orders;
create trigger notify_vendor_order
  after insert or update of payment_status on public.orders
  for each row execute function public.notify_vendor_order();

-- ============================================================
-- 5. A buyer wrote to the shop
-- ============================================================
-- Deduplicated per thread while unread, like the buyer's message alert:
-- five quick messages are one alert showing the latest, not five.
create or replace function public.notify_vendor_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_buyer text;
  v_req   uuid;
begin
  if new.sender_role <> 'buyer' then
    return null;
  end if;

  select public.vendor_owner(q.vendor_id), p.full_name, r.id into v_owner, v_buyer, v_req
  from public.quotes q
  join public.book_requests r on r.id = q.request_id
  left join public.profiles p on p.id = r.buyer_id
  where q.id = new.quote_id;

  perform public.push_notification(
    v_owner, 'buyer_message',
    'New message from ' || coalesce(nullif(btrim(v_buyer), ''), 'a buyer'),
    new.body, '/vendor/messages?quote=' || new.quote_id, new.quote_id, null, v_req, true);
  return null;
end;
$$;

drop trigger if exists notify_vendor_message on public.quote_messages;
create trigger notify_vendor_message
  after insert on public.quote_messages
  for each row execute function public.notify_vendor_message();

-- ============================================================
-- 6. Reading a thread clears its message alert
-- ============================================================
-- Without this the bell keeps saying "new message" for a conversation
-- the shop has already opened and answered. mark_quote_thread_read() is
-- what both apps call when a thread is opened, so it is the one place
-- to do it — for both roles.
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

  update public.notifications n
     set read_at = now()
   where n.recipient_id = auth.uid()
     and n.quote_id = p_quote_id
     and n.kind in ('message', 'buyer_message')
     and n.read_at is null;

  return v_n;
end;
$$;

revoke all on function public.mark_quote_thread_read(uuid) from public;
grant execute on function public.mark_quote_thread_read(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
