-- Bookshops — self-serve promotions: vendors book their own dashboard deals
--
-- bookshops_sponsored_deals.sql made the buyer dashboard's promo slot
-- admin-only. This opens it to shops themselves, without giving up the
-- rules that file was written to keep:
--
--   * A vendor deal is always badged SPONSORED. The badge column is
--     forced here, not chosen in the form.
--   * A vendor can only touch its own deals, and only while its shop is
--     approved and active — the same gate the slot uses when showing one.
--   * Nobody can read another shop's deals. A vendor sees its own rows;
--     buyers still see only the one live deal, through
--     current_sponsored_deal().
--
-- Vendors write straight into public.sponsored_deals (insert, cancel,
-- delete). RLS decides WHOSE row it is; the guard trigger below decides
-- WHAT a vendor may put in it — a policy can check ownership but is a
-- poor place for "no more than 31 days" or "you may cancel, not extend".
--
-- Guardrails for vendor-created deals (admins and the service role skip
-- all of them):
--   priority     1 Standard, 2 Boosted, 3 Top. Admin deals can use any
--                number, so LOCI can always outrank a self-serve booking.
--   window       starts no earlier than now (15 min grace for a slow
--                form) and no later than 90 days out; runs at most 31 days.
--   volume       at most 3 live-or-scheduled deals per shop at once.
--   edits        none, except cancelling (is_active true -> false). To
--                change an offer, cancel it and book a new one — so a
--                buyer never sees an offer quietly rewritten mid-run.
--   delete       only before it has started. Once a deal has run it stays
--                as a record of what buyers were shown.
--
-- Also adds the shop photo the form pulls in (vendors.logo_url, in a
-- public `shop-media` bucket) and lets the live deal fall back to it.
--
-- Safe to run more than once. Requires bookshops_sponsored_deals.sql and
-- bookshops_booklist_photo_vendor_access.sql (is_approved_vendor).

begin;

-- ============================================================
-- 1. The shop photo
-- ============================================================
alter table public.vendors
  add column if not exists logo_url text
    check (logo_url is null or logo_url ~* '^https://');

comment on column public.vendors.logo_url is
  'Public https URL of the shop photo/logo in the shop-media bucket. Shown on the shop''s sponsored deals and anywhere else the shop is carded.';

-- Public on purpose: a promo image is meant to be seen by guests, and a
-- signed URL would expire under a deal that runs for weeks.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-media', 'shop-media', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Object paths are <vendor_id>/<key>.<ext>. Writes only into your own folder.
drop policy if exists shop_media_insert_own on storage.objects;
create policy shop_media_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'shop-media'
    and exists (
      select 1 from public.vendors v
       where v.id::text = (storage.foldername(name))[1]
         and v.profile_id = (select auth.uid())
    )
  );

drop policy if exists shop_media_update_own on storage.objects;
create policy shop_media_update_own
  on storage.objects for update to authenticated
  using (
    bucket_id = 'shop-media'
    and exists (
      select 1 from public.vendors v
       where v.id::text = (storage.foldername(name))[1]
         and v.profile_id = (select auth.uid())
    )
  );

drop policy if exists shop_media_delete_own on storage.objects;
create policy shop_media_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'shop-media'
    and exists (
      select 1 from public.vendors v
       where v.id::text = (storage.foldername(name))[1]
         and v.profile_id = (select auth.uid())
    )
  );

-- ============================================================
-- 2. Columns a self-serve deal needs
-- ============================================================
alter table public.sponsored_deals
  add column if not exists cancelled_at timestamptz,
  add column if not exists created_via  text not null default 'admin'
    check (created_via in ('admin', 'vendor'));

comment on column public.sponsored_deals.created_via is
  'Who booked it. Set by the guard trigger from the caller, never by the client.';

create index if not exists sponsored_deals_vendor_idx
  on public.sponsored_deals (vendor_id, ends_at desc);

-- ============================================================
-- 3. Vendor access
-- ============================================================
-- Is this vendor row mine? Definer-rights so the policies below do not
-- depend on the caller being able to read vendors.
create or replace function public.owns_vendor(p_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.vendors v
    where v.id = p_vendor_id and v.profile_id = auth.uid()
  );
$$;

revoke all on function public.owns_vendor(uuid) from public;
grant execute on function public.owns_vendor(uuid) to authenticated;

drop policy if exists sponsored_deals_vendor_select on public.sponsored_deals;
create policy sponsored_deals_vendor_select on public.sponsored_deals
  for select to authenticated
  using (public.owns_vendor(vendor_id));

drop policy if exists sponsored_deals_vendor_insert on public.sponsored_deals;
create policy sponsored_deals_vendor_insert on public.sponsored_deals
  for insert to authenticated
  with check (public.owns_vendor(vendor_id) and public.is_approved_vendor());

drop policy if exists sponsored_deals_vendor_update on public.sponsored_deals;
create policy sponsored_deals_vendor_update on public.sponsored_deals
  for update to authenticated
  using (public.owns_vendor(vendor_id))
  with check (public.owns_vendor(vendor_id));

drop policy if exists sponsored_deals_vendor_delete on public.sponsored_deals;
create policy sponsored_deals_vendor_delete on public.sponsored_deals
  for delete to authenticated
  using (public.owns_vendor(vendor_id) and starts_at > now());

-- ============================================================
-- 4. The guard
-- ============================================================
create or replace function public.guard_sponsored_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open integer;
begin
  -- LOCI's own staff and server code are not self-serve.
  if public.is_admin() or auth.role() = 'service_role' then
    if tg_op = 'INSERT' then
      new.created_via := coalesce(new.created_via, 'admin');
    end if;
    if tg_op = 'UPDATE' and new.is_active is distinct from old.is_active then
      new.cancelled_at := case when new.is_active then null else coalesce(new.cancelled_at, now()) end;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_via  := 'vendor';
    new.created_by   := auth.uid();
    new.badge        := 'SPONSORED';
    new.is_active    := true;
    new.cancelled_at := null;
    -- The picture is the shop's own photo (vendors.logo_url), resolved
    -- when the deal is shown. A vendor does not get to point the
    -- buyer dashboard at an arbitrary external image.
    new.image_url    := null;
    new.headline     := btrim(new.headline);
    new.details      := nullif(btrim(coalesce(new.details, '')), '');
    new.audience     := nullif(btrim(coalesce(new.audience, '')), '');

    if new.priority not between 1 and 3 then
      raise exception 'Choose a priority of Standard, Boosted or Top'
        using errcode = '22023';
    end if;

    if new.starts_at < now() - interval '15 minutes' then
      raise exception 'A promotion cannot start in the past'
        using errcode = '22023';
    end if;

    if new.starts_at > now() + interval '90 days' then
      raise exception 'A promotion can be booked at most 90 days ahead'
        using errcode = '22023';
    end if;

    if new.ends_at - new.starts_at > interval '31 days' then
      raise exception 'A promotion can run for at most 31 days'
        using errcode = '22023';
    end if;

    -- Serialise per shop so two quick submits cannot both slip under the cap.
    perform pg_advisory_xact_lock(hashtext('sponsored_deals:' || new.vendor_id::text));

    select count(*) into v_open
    from public.sponsored_deals d
    where d.vendor_id = new.vendor_id
      and d.is_active
      and d.ends_at > now();

    if v_open >= 3 then
      raise exception 'You already have 3 live or scheduled promotions'
        using errcode = '23P01',
              hint = 'Cancel one before booking another.';
    end if;

    return new;
  end if;

  -- UPDATE by a vendor: cancelling is the only change allowed.
  if new.is_active or not old.is_active then
    raise exception 'A promotion can only be cancelled, not edited'
      using errcode = '42501',
            hint = 'Cancel it and book a new one to change the offer.';
  end if;

  if (new.vendor_id, new.badge, new.headline, new.details, new.image_url, new.audience,
      new.starts_at, new.ends_at, new.priority, new.created_by, new.created_via)
     is distinct from
     (old.vendor_id, old.badge, old.headline, old.details, old.image_url, old.audience,
      old.starts_at, old.ends_at, old.priority, old.created_by, old.created_via) then
    raise exception 'A promotion can only be cancelled, not edited'
      using errcode = '42501',
            hint = 'Cancel it and book a new one to change the offer.';
  end if;

  new.cancelled_at := now();
  return new;
end;
$$;

drop trigger if exists guard_sponsored_deal on public.sponsored_deals;
create trigger guard_sponsored_deal
  before insert or update on public.sponsored_deals
  for each row execute function public.guard_sponsored_deal();

-- ============================================================
-- 5. What the buyer sees — now with the shop photo
-- ============================================================
-- Unchanged except image_url, which falls back to the shop's own photo.
create or replace function public.current_sponsored_deal()
returns table (
  deal_id      uuid,
  badge        text,
  headline     text,
  details      text,
  image_url    text,
  audience     text,
  ends_at      timestamptz,
  vendor_id    uuid,
  store_name   text,
  city         text,
  rating       numeric,
  review_count integer,
  verified     boolean
)
language sql
volatile   -- random() for rotation between equal-priority deals
security definer
set search_path = ''
as $$
  select
    d.id, d.badge, d.headline, d.details, coalesce(d.image_url, v.logo_url), d.audience, d.ends_at,
    v.id, v.store_name, v.city, v.rating, v.review_count, v.verified_at is not null
  from public.sponsored_deals d
  join public.vendors v on v.id = d.vendor_id
  where d.is_active
    and now() >= d.starts_at
    and now() <  d.ends_at
    and v.is_active
    and v.approval_status = 'approved'
  order by d.priority desc, random()
  limit 1;
$$;

revoke all on function public.current_sponsored_deal() from public;
grant execute on function public.current_sponsored_deal() to anon, authenticated;

-- ============================================================
-- 6. The vendor's campaign list
-- ============================================================
-- The shop's own deals with a status, plus the one thing a shop cannot
-- work out for itself: whether its live deal is actually being shown.
-- The slot shows one deal at a time, highest priority first, rotating
-- among equals. A shop is told how its deal is placed — never whose
-- deals it is up against.
create or replace function public.vendor_sponsored_deals()
returns table (
  deal_id          uuid,
  headline         text,
  details          text,
  audience         text,
  starts_at        timestamptz,
  ends_at          timestamptz,
  priority         integer,
  created_via      text,
  cancelled_at     timestamptz,
  created_at       timestamptz,
  status           text,     -- live | scheduled | ended | cancelled | paused
  outranked        boolean,  -- live, but a higher-priority deal is shown instead
  rotation_size    integer   -- live and not outranked: deals sharing the slot, this one included
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  my_vendor uuid;
  my_ok     boolean;
begin
  select v.id, (v.is_active and v.approval_status = 'approved')
    into my_vendor, my_ok
  from public.vendors v where v.profile_id = auth.uid();

  if my_vendor is null then
    return;
  end if;

  return query
  with live as (
    select d.id, d.priority
    from public.sponsored_deals d
    join public.vendors v on v.id = d.vendor_id
    where d.is_active and now() >= d.starts_at and now() < d.ends_at
      and v.is_active and v.approval_status = 'approved'
  ),
  top as (select max(l.priority) as p from live l)
  select
    d.id, d.headline, d.details, d.audience, d.starts_at, d.ends_at, d.priority,
    d.created_via, d.cancelled_at, d.created_at,
    case
      when not d.is_active then 'cancelled'
      when now() >= d.ends_at then 'ended'
      when not my_ok then 'paused'
      when now() < d.starts_at then 'scheduled'
      else 'live'
    end,
    (d.is_active and my_ok and now() >= d.starts_at and now() < d.ends_at
      and d.priority < (select t.p from top t)),
    case
      when d.is_active and my_ok and now() >= d.starts_at and now() < d.ends_at
       and d.priority >= (select t.p from top t)
      then (select count(*)::integer from live l where l.priority = d.priority)
      else null
    end
  from public.sponsored_deals d
  where d.vendor_id = my_vendor
  -- Live first, then scheduled soonest-first, then history newest-first.
  order by
    case
      when d.is_active and now() >= d.starts_at and now() < d.ends_at then 0
      when d.is_active and now() < d.starts_at then 1
      else 2
    end,
    case when d.is_active and now() < d.ends_at then d.starts_at end asc,
    d.starts_at desc
  limit 50;
end;
$$;

revoke all on function public.vendor_sponsored_deals() from public;
grant execute on function public.vendor_sponsored_deals() to authenticated;

commit;

notify pgrst, 'reload schema';
