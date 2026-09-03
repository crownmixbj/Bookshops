-- ============================================================
-- LOCI-BOOK — vendor payouts
--
-- Run this in the Supabase SQL editor. It is idempotent: safe to
-- run twice.
--
-- What it adds:
--   payout_settings       one row of policy (minimum, commission)
--   vendor_bank_accounts  where a shop wants to be paid
--   payout_requests       the audit trail of every withdrawal
--   vendor_payout_summary() / request_payout()  the money maths
--
-- Design notes that matter:
--
--  * Orders have no vendor_id. The link is orders -> quotes ->
--    vendors, so every balance query goes through quotes. Getting
--    this wrong would pay the wrong shop.
--
--  * Only DELIVERED and PAID orders count towards a balance. Money
--    for something still in a box in the shop is not the vendor's
--    yet.
--
--  * payout_requests has NO insert/update/delete policy. Every
--    write goes through request_payout(), which re-checks the
--    balance server-side. A client-side threshold check is a
--    courtesy to the user, never a control.
--
--  * Nigerian banking: a 10-digit NUBAN account number plus a bank
--    code. There is no IBAN and no BIC/SWIFT for local transfers.
--
--  * Nothing here moves money. It records what is owed and what has
--    been asked for. When you wire up Paystack transaction splits,
--    settlement rows land in payout_requests the same way and the
--    UI does not change.
-- ============================================================

-- ---------- 1. policy -------------------------------------------------

create table if not exists public.payout_settings (
  id               boolean primary key default true check (id),
  minimum_amount   numeric not null default 5000 check (minimum_amount >= 0),
  commission_rate  numeric not null default 0
                     check (commission_rate >= 0 and commission_rate < 1),
  updated_at       timestamptz not null default now()
);

comment on table public.payout_settings is
  'Single row (id is always true). Payout policy lives in data, not in a constant, so changing the minimum is an UPDATE rather than a deploy.';
comment on column public.payout_settings.commission_rate is
  'Platform cut, 0 to 1. Defaults to 0 — set it deliberately rather than inheriting a number nobody chose.';

insert into public.payout_settings (id) values (true) on conflict (id) do nothing;

alter table public.payout_settings enable row level security;

drop policy if exists payout_settings_read on public.payout_settings;
create policy payout_settings_read on public.payout_settings
  for select to authenticated using (true);
-- No write policy: the service key changes policy, not the app.

-- ---------- 2. bank details -------------------------------------------

create table if not exists public.vendor_bank_accounts (
  vendor_id       uuid primary key references public.vendors(id) on delete cascade,
  account_name    text not null check (length(trim(account_name)) between 2 and 120),
  bank_name       text not null check (length(trim(bank_name)) between 2 and 120),
  -- Not digits-only: Paystack's code for ALAT by WEMA is '035A'. A
  -- digits-only check would have rejected a real bank.
  bank_code       text check (bank_code is null or bank_code ~ '^[0-9A-Z]{3,6}$'),
  account_number  text not null check (account_number ~ '^[0-9]{10}$'),
  verified_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.vendor_bank_accounts is
  'One account per shop. Not history — updating replaces it, and payout_requests keeps a snapshot of where each payment was actually sent.';
comment on column public.vendor_bank_accounts.account_number is
  '10-digit NUBAN. The app never redisplays this in full; it shows the last four.';
comment on column public.vendor_bank_accounts.verified_at is
  'Set once the name has been confirmed against the bank (Paystack resolve-account). Null means unverified — pay out at your own risk.';

alter table public.vendor_bank_accounts enable row level security;

drop policy if exists vba_select_own on public.vendor_bank_accounts;
create policy vba_select_own on public.vendor_bank_accounts
  for select to authenticated
  using (
    exists (
      select 1 from public.vendors v
      where v.id = vendor_id and v.profile_id = auth.uid()
    )
  );

drop policy if exists vba_write_own on public.vendor_bank_accounts;
create policy vba_write_own on public.vendor_bank_accounts
  for insert to authenticated
  with check (
    exists (
      select 1 from public.vendors v
      where v.id = vendor_id and v.profile_id = auth.uid()
    )
    and not exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.suspended_at is not null
    )
  );

drop policy if exists vba_update_own on public.vendor_bank_accounts;
create policy vba_update_own on public.vendor_bank_accounts
  for update to authenticated
  using (
    exists (
      select 1 from public.vendors v
      where v.id = vendor_id and v.profile_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.vendors v
      where v.id = vendor_id and v.profile_id = auth.uid()
    )
    and not exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.suspended_at is not null
    )
  );

-- Deliberately no DELETE policy. Removing bank details while a payout
-- is in flight would strand the money.

-- ---------- 3. payout requests ----------------------------------------

create table if not exists public.payout_requests (
  id               uuid primary key default gen_random_uuid(),
  vendor_id        uuid not null references public.vendors(id) on delete restrict,
  reference        text not null unique,
  amount           numeric not null check (amount > 0),
  currency         text not null default 'NGN' check (currency = 'NGN'),
  status           text not null default 'pending'
                     check (status in ('pending','processing','completed','failed')),
  -- Where it was sent, frozen at request time. If the vendor edits
  -- their bank details tomorrow, this still says where yesterday's
  -- money went.
  bank_name        text,
  account_name     text,
  account_last4    text check (account_last4 is null or account_last4 ~ '^[0-9]{4}$'),
  requested_at     timestamptz not null default now(),
  processed_at     timestamptz,
  processed_by     uuid references public.profiles(id) on delete set null,
  failure_reason   text check (failure_reason is null or length(failure_reason) <= 500)
);

comment on table public.payout_requests is
  'Every withdrawal ever asked for. Append-only from the app''s point of view: no insert/update/delete policy exists, so the only way in is request_payout().';

create index if not exists payout_requests_vendor_idx
  on public.payout_requests (vendor_id, requested_at desc);

alter table public.payout_requests enable row level security;

drop policy if exists payout_requests_select_own on public.payout_requests;
create policy payout_requests_select_own on public.payout_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.vendors v
      where v.id = vendor_id and v.profile_id = auth.uid()
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ---------- 4. the money maths ----------------------------------------

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
    return;                       -- not a vendor: no rows, not an error
  end if;

  select s.commission_rate, s.minimum_amount into v_rate, v_min
  from public.payout_settings s where s.id;

  -- Delivered AND paid only. Orders reach a vendor through quotes.
  select coalesce(sum(o.amount), 0) into v_gross
  from public.orders o
  join public.quotes q on q.id = o.quote_id
  where q.vendor_id = v_id
    and o.fulfillment_status = 'delivered'
    and o.payment_status = 'paid';

  select coalesce(sum(p.amount), 0) into v_paid
  from public.payout_requests p
  where p.vendor_id = v_id and p.status = 'completed';

  -- Money already spoken for. A failed request frees its amount again.
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

-- Requests the whole available balance. No amount argument on purpose:
-- a client-supplied figure is one more thing to validate, and partial
-- withdrawals are not a feature anyone has asked for.
create or replace function public.request_payout()
returns public.payout_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  s      record;
  bank   record;
  ref    text;
  result public.payout_requests;
begin
  select * into s from public.vendor_payout_summary();

  if s.vendor_id is null then
    raise exception 'Only a registered bookshop can request a payout.';
  end if;

  if exists (
    select 1 from public.payout_requests p
    where p.vendor_id = s.vendor_id and p.status in ('pending','processing')
  ) then
    raise exception 'You already have a payout in progress.';
  end if;

  if not s.has_bank_account then
    raise exception 'Add your bank details before requesting a payout.';
  end if;

  -- The real threshold check. The disabled button in the UI is a
  -- courtesy; this is the control.
  if s.available_balance < s.minimum_amount then
    raise exception 'Your balance is below the % minimum for a payout.', s.minimum_amount;
  end if;

  select * into bank from public.vendor_bank_accounts b where b.vendor_id = s.vendor_id;

  ref := 'PO-' || to_char(now(), 'YYMMDD') || '-' ||
         upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.payout_requests
    (vendor_id, reference, amount, bank_name, account_name, account_last4)
  values
    (s.vendor_id, ref, s.available_balance, bank.bank_name, bank.account_name,
     right(bank.account_number, 4))
  returning * into result;

  return result;
end;
$$;

revoke all on function public.request_payout() from public;
grant execute on function public.request_payout() to authenticated;

notify pgrst, 'reload schema';
