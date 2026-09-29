-- Bookshops — vendor identity verification, and locking down who can
-- mark a shop "verified"
--
-- Three things, because the first is pointless without the other two:
--
--   1. vendor_identity: the shop owner's NIN (or other government ID),
--      the name on it, and up to three document scans, in a PRIVATE table
--      with a PRIVATE storage bucket. Not columns on `vendors`: that
--      table is readable by every signed-in user and by guests (it is the
--      shop directory), so anything put there is public.
--
--   2. An admin review step. admin_review_identity() is now the ONLY way
--      a shop becomes "Verified" (vendors.verified_at). Approving a shop
--      to trade (admin_review_vendor) no longer ticks "Verified" as a side
--      effect — before this, every approved shop was shown to buyers as
--      verified without anyone having seen an ID.
--
--   3. Guards on vendor-owned writes. vendors_update_own let a shop owner
--      update ANY column of their own row, including verified_at,
--      approval_status, featured and rating — a shop could approve,
--      verify and feature itself from the browser console. A trigger now
--      keeps those columns for admins and for the database's own
--      functions. Same for vendor_bank_accounts.verified_at, which a shop
--      could previously set on its own bank details.
--
-- How the guards tell "the shop's browser" from "the database itself":
-- `current_user`. A client request runs as the role `authenticated`;
-- a SECURITY DEFINER function (every admin RPC, and the triggers that
-- maintain rating and completed_orders) runs as its owner. So the guard
-- only applies to direct client writes, and never blocks the app's own
-- server-side maintenance.
--
-- NIN is stored as typed, protected by RLS (the shop and admins only).
-- It is not encrypted at rest beyond Supabase's disk encryption; see the
-- note at the bottom if you want column-level encryption later.
--
-- Safe to run more than once. Requires bookshops_admin.sql,
-- bookshops_payouts.sql and bookshops_vendor_promotions.sql (owns_vendor).

begin;

-- ============================================================
-- 1. Lock the admin-owned columns on vendors
-- ============================================================
-- Deliberately NOT security definer: it must see the caller's role.
create or replace function public.guard_vendor_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A new shop starts unreviewed, whatever the request said.
    new.approval_status  := 'pending';
    new.verified_at      := null;
    new.reviewed_at      := null;
    new.reviewed_by      := null;
    new.review_note      := null;
    new.featured         := false;
    new.rating           := null;
    new.review_count     := 0;
    new.completed_orders := 0;
    return new;
  end if;

  if (new.approval_status, new.verified_at, new.reviewed_at, new.reviewed_by, new.review_note,
      new.featured, new.rating, new.review_count, new.completed_orders, new.profile_id)
     is distinct from
     (old.approval_status, old.verified_at, old.reviewed_at, old.reviewed_by, old.review_note,
      old.featured, old.rating, old.review_count, old.completed_orders, old.profile_id) then
    raise exception 'Approval, verification, ratings and featuring are set by LOCI, not by the shop'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_vendor_row on public.vendors;
create trigger guard_vendor_row
  before insert or update on public.vendors
  for each row execute function public.guard_vendor_row();

-- ============================================================
-- 2. Bank details: the shop cannot mark its own account "confirmed"
-- ============================================================
create or replace function public.guard_vendor_bank()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then
    return new;
  end if;
  -- Any change by the shop — new account or edited digits — means the
  -- old confirmation no longer applies.
  new.verified_at := null;
  new.account_name := btrim(new.account_name);
  new.bank_name    := btrim(new.bank_name);
  new.account_number := regexp_replace(new.account_number, '\s', '', 'g');
  return new;
end;
$$;

drop trigger if exists guard_vendor_bank on public.vendor_bank_accounts;
create trigger guard_vendor_bank
  before insert or update on public.vendor_bank_accounts
  for each row execute function public.guard_vendor_bank();

-- ============================================================
-- 3. The identity record
-- ============================================================
create table if not exists public.vendor_identity (
  vendor_id     uuid primary key references public.vendors(id) on delete cascade,
  id_type       text not null
                  check (id_type in ('nin', 'intl_passport', 'drivers_licence', 'voters_card')),
  id_number     text not null,
  -- The name exactly as it appears on the ID, for the reviewer to match
  -- against the document and the bank account holder.
  legal_name    text not null check (length(btrim(legal_name)) between 2 and 120),
  -- [{path, name, type, size}] in the vendor-kyc bucket, at most three.
  documents     jsonb not null default '[]'::jsonb
                  check (jsonb_typeof(documents) = 'array' and jsonb_array_length(documents) <= 3),
  status        text not null default 'submitted'
                  check (status in ('submitted', 'verified', 'rejected')),
  submitted_at  timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewed_by   uuid references auth.users(id) on delete set null,
  review_note   text check (review_note is null or length(review_note) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint vendor_identity_number_format check (
    (id_type = 'nin' and id_number ~ '^[0-9]{11}$')
    or (id_type <> 'nin' and id_number ~ '^[A-Z0-9-]{5,20}$')
  )
);

comment on table public.vendor_identity is
  'KYC for shop owners. Private: the shop and admins only. status moves to verified/rejected only through admin_review_identity(), which is also the only writer of vendors.verified_at.';
comment on column public.vendor_identity.id_number is
  'NIN (11 digits) or the document number of the other ID type. The app shows only the last four after saving.';

alter table public.vendor_identity enable row level security;

drop policy if exists vendor_identity_select_own on public.vendor_identity;
create policy vendor_identity_select_own on public.vendor_identity
  for select to authenticated using (public.owns_vendor(vendor_id));

drop policy if exists vendor_identity_select_admin on public.vendor_identity;
create policy vendor_identity_select_admin on public.vendor_identity
  for select to authenticated using (public.is_admin());

drop policy if exists vendor_identity_insert_own on public.vendor_identity;
create policy vendor_identity_insert_own on public.vendor_identity
  for insert to authenticated
  with check (
    public.owns_vendor(vendor_id)
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.suspended_at is not null)
  );

drop policy if exists vendor_identity_update_own on public.vendor_identity;
create policy vendor_identity_update_own on public.vendor_identity
  for update to authenticated
  using (public.owns_vendor(vendor_id))
  with check (
    public.owns_vendor(vendor_id)
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.suspended_at is not null)
  );
-- No delete policy: a withdrawn identity is a record worth keeping.

drop trigger if exists touch_vendor_identity on public.vendor_identity;
create trigger touch_vendor_identity before update on public.vendor_identity
  for each row execute function public.touch_updated_at();

-- A shop submitting or changing its ID always goes (back) to review.
create or replace function public.guard_vendor_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_doc jsonb;
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then
    return new;
  end if;

  new.id_number  := upper(regexp_replace(new.id_number, '[\s]', '', 'g'));
  new.legal_name := btrim(new.legal_name);

  -- Every document must be in this shop's own folder of the private bucket.
  for v_doc in select * from jsonb_array_elements(new.documents) loop
    if coalesce(v_doc ->> 'path', '') not like new.vendor_id::text || '/%' then
      raise exception 'Identity documents must be uploaded from your own shop account'
        using errcode = '42501';
    end if;
  end loop;

  if tg_op = 'UPDATE'
     and (new.id_type, new.id_number, new.legal_name, new.documents)
         is not distinct from (old.id_type, old.id_number, old.legal_name, old.documents)
     and (new.status, new.reviewed_at, new.reviewed_by, new.review_note)
         is not distinct from (old.status, old.reviewed_at, old.reviewed_by, old.review_note) then
    return new;  -- nothing changed; keep the review as it was
  end if;

  new.status       := 'submitted';
  new.submitted_at := now();
  new.reviewed_at  := null;
  new.reviewed_by  := null;
  new.review_note  := null;

  -- Changing the ID behind a verified shop un-verifies it until an admin
  -- has looked again. Done here, as the owner, because the shop cannot
  -- write verified_at itself (section 1).
  if tg_op = 'UPDATE' and old.status = 'verified' then
    perform public.unverify_vendor_after_identity_change(new.vendor_id);
  end if;

  return new;
end;
$$;

-- Callable by the shop (the guard above runs as the shop), but only for
-- its OWN shop: it can un-verify itself, never anyone else.
create or replace function public.unverify_vendor_after_identity_change(p_vendor uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.vendors set verified_at = null, updated_at = now()
   where id = p_vendor and profile_id = auth.uid();
$$;

revoke all on function public.unverify_vendor_after_identity_change(uuid) from public;
grant execute on function public.unverify_vendor_after_identity_change(uuid) to authenticated;

drop trigger if exists guard_vendor_identity on public.vendor_identity;
create trigger guard_vendor_identity
  before insert or update on public.vendor_identity
  for each row execute function public.guard_vendor_identity();

-- ============================================================
-- 4. Private bucket for the ID scans
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vendor-kyc', 'vendor-kyc', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Paths are <vendor_id>/<key>.<ext>. The shop reads and writes its own
-- folder; admins read everything. Nobody else, ever.
drop policy if exists vendor_kyc_insert_own on storage.objects;
create policy vendor_kyc_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'vendor-kyc' and public.owns_vendor(((storage.foldername(name))[1])::uuid));

drop policy if exists vendor_kyc_update_own on storage.objects;
create policy vendor_kyc_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'vendor-kyc' and public.owns_vendor(((storage.foldername(name))[1])::uuid));

drop policy if exists vendor_kyc_delete_own on storage.objects;
create policy vendor_kyc_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'vendor-kyc' and public.owns_vendor(((storage.foldername(name))[1])::uuid));

drop policy if exists vendor_kyc_select on storage.objects;
create policy vendor_kyc_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vendor-kyc'
    and (public.is_admin() or public.owns_vendor(((storage.foldername(name))[1])::uuid))
  );

-- ============================================================
-- 5. Admin review
-- ============================================================
alter table public.admin_actions drop constraint if exists admin_actions_action_check;
alter table public.admin_actions
  add constraint admin_actions_action_check check (action in (
    'set_role', 'suspend_user', 'unsuspend_user', 'approve_vendor', 'reject_vendor',
    'feature_vendor', 'unfeature_vendor', 'resolve_report', 'approve_payout', 'hold_payout',
    'complete_payout', 'fail_payout',
    'verify_identity', 'reject_identity', 'confirm_bank', 'unconfirm_bank'
  ));

-- Approving a shop to trade no longer marks it Verified. Otherwise
-- identical to bookshops_admin.sql.
create or replace function public.admin_review_vendor(p_vendor uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  update public.vendors
     set approval_status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         review_note = p_note,
         updated_at = now()
   where id = p_vendor;

  insert into public.admin_actions (actor_id, action, subject_type, subject_id, detail)
  values (auth.uid(),
          case when p_approve then 'approve_vendor' else 'reject_vendor' end,
          'vendor', p_vendor, jsonb_build_object('note', p_note));
end;
$$;

revoke all on function public.admin_review_vendor(uuid, boolean, text) from public;
grant execute on function public.admin_review_vendor(uuid, boolean, text) to authenticated;

-- Verify or reject the owner's identity. The one writer of verified_at.
create or replace function public.admin_review_identity(p_vendor uuid, p_verify boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if not p_verify and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Say what needs fixing — the shop sees this note' using errcode = '22023';
  end if;

  update public.vendor_identity
     set status      = case when p_verify then 'verified' else 'rejected' end,
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         review_note = nullif(btrim(coalesce(p_note, '')), ''),
         updated_at  = now()
   where vendor_id = p_vendor;

  if not found then
    raise exception 'This shop has not submitted an ID yet' using errcode = 'P0002';
  end if;

  update public.vendors
     set verified_at = case when p_verify then coalesce(verified_at, now()) else null end,
         updated_at  = now()
   where id = p_vendor;

  insert into public.admin_actions (actor_id, action, subject_type, subject_id, detail)
  values (auth.uid(),
          case when p_verify then 'verify_identity' else 'reject_identity' end,
          'vendor', p_vendor, jsonb_build_object('note', p_note));
end;
$$;

revoke all on function public.admin_review_identity(uuid, boolean, text) from public;
grant execute on function public.admin_review_identity(uuid, boolean, text) to authenticated;

-- An admin confirms the account holder name matches the ID / business
-- (manually, or later from a Paystack resolve-account check).
create or replace function public.admin_confirm_bank(p_vendor uuid, p_confirmed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  update public.vendor_bank_accounts
     set verified_at = case when p_confirmed then now() else null end,
         updated_at  = now()
   where vendor_id = p_vendor;

  if not found then
    raise exception 'This shop has not added bank details yet' using errcode = 'P0002';
  end if;

  insert into public.admin_actions (actor_id, action, subject_type, subject_id, detail)
  values (auth.uid(), case when p_confirmed then 'confirm_bank' else 'unconfirm_bank' end,
          'vendor', p_vendor, '{}'::jsonb);
end;
$$;

revoke all on function public.admin_confirm_bank(uuid, boolean) from public;
grant execute on function public.admin_confirm_bank(uuid, boolean) to authenticated;

commit;

notify pgrst, 'reload schema';

-- Column-level encryption, if you want it later: move id_number into
-- Supabase Vault (vault.create_secret) and keep only its secret id and
-- the last four digits here. The review screen would then read it
-- through a definer function that checks is_admin(). Not done now
-- because it adds a decrypt path that has to be audited on its own.
