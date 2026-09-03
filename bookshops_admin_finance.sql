-- ============================================================
-- LOCI-BOOK — admin financial console
--
-- RUN bookshops_payouts.sql FIRST. This builds on the tables it
-- creates (payout_settings, vendor_bank_accounts, payout_requests).
--
-- Safe to run twice.
--
-- What it adds:
--   admin_finance_summary()   GMV, platform revenue, escrow, pending
--   admin_payout_queue()      every payout request + shop + bank
--   admin_set_payout_status() approve / hold / mark paid, audited
--
-- Design notes:
--
--  * ESCROW here means money a buyer has paid that the vendor cannot
--    yet withdraw: paid orders that are not delivered and not
--    cancelled. LOCI does not hold funds in a separate account — this
--    is a derived figure describing exposure, not a bank balance.
--    Do not present it to anyone as segregated client money.
--
--  * PLATFORM REVENUE is GMV x payout_settings.commission_rate, which
--    ships at 0. Until someone sets a rate deliberately, this figure
--    is honestly zero rather than an invented 10%.
--
--  * Admins get READ policies only. Every state change goes through
--    the SECURITY DEFINER function below, which writes an
--    admin_actions row in the same transaction. An admin cannot
--    quietly move money and leave no trace.
-- ============================================================

-- ---------- 1. audit vocabulary ---------------------------------------

-- admin_actions.action is CHECK-constrained; the payout verbs are new.
alter table public.admin_actions drop constraint if exists admin_actions_action_check;
alter table public.admin_actions add constraint admin_actions_action_check
  check (action in (
    'set_role','suspend_user','unsuspend_user',
    'approve_vendor','reject_vendor','feature_vendor','unfeature_vendor',
    'resolve_report',
    'approve_payout','hold_payout','complete_payout','fail_payout'
  ));

alter table public.admin_actions drop constraint if exists admin_actions_subject_type_check;
alter table public.admin_actions add constraint admin_actions_subject_type_check
  check (subject_type in ('profile','vendor','report','payout'));

-- ---------- 2. admin read access to payouts ---------------------------

drop policy if exists vba_select_admin on public.vendor_bank_accounts;
create policy vba_select_admin on public.vendor_bank_accounts
  for select to authenticated using (public.is_admin());

-- payout_requests already allows admin SELECT via its own policy.

-- ---------- 3. the numbers --------------------------------------------

create or replace function public.admin_finance_summary()
returns table (
  gmv              numeric,
  platform_revenue numeric,
  escrow           numeric,
  pending_payouts  numeric,
  commission_rate  numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate numeric;
begin
  if not public.is_admin() then
    raise exception 'Administrators only.';
  end if;

  select s.commission_rate into v_rate from public.payout_settings s where s.id;

  -- GMV: everything the marketplace has actually sold and been paid for.
  select coalesce(sum(o.amount), 0) into gmv
  from public.orders o
  where o.payment_status = 'paid';

  platform_revenue := round(gmv * coalesce(v_rate, 0), 2);

  -- Paid, but not yet delivered: the vendor cannot draw on it.
  select coalesce(sum(o.amount), 0) into escrow
  from public.orders o
  where o.payment_status = 'paid'
    and o.fulfillment_status not in ('delivered', 'cancelled');

  select coalesce(sum(p.amount), 0) into pending_payouts
  from public.payout_requests p
  where p.status in ('pending', 'processing');

  commission_rate := coalesce(v_rate, 0);
  return next;
end;
$$;

revoke all on function public.admin_finance_summary() from public;
grant execute on function public.admin_finance_summary() to authenticated;

-- ---------- 4. the approval queue -------------------------------------

create or replace function public.admin_payout_queue()
returns table (
  id             uuid,
  reference      text,
  vendor_id      uuid,
  store_name     text,
  amount         numeric,
  status         text,
  bank_name      text,
  account_name   text,
  account_number text,
  requested_at   timestamptz,
  processed_at   timestamptz,
  failure_reason text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrators only.';
  end if;

  return query
  select p.id, p.reference, p.vendor_id, v.store_name, p.amount, p.status,
         -- Prefer the snapshot taken when the payout was requested: it
         -- is where the money was actually meant to go, even if the
         -- shop has edited its details since.
         coalesce(p.bank_name, b.bank_name),
         coalesce(p.account_name, b.account_name),
         -- The full number, because an admin has to key it into a bank
         -- transfer. This is the one place it is exposed, it requires
         -- is_admin(), and the vendor's own screen still masks it.
         b.account_number,
         p.requested_at, p.processed_at, p.failure_reason
  from public.payout_requests p
  join public.vendors v on v.id = p.vendor_id
  left join public.vendor_bank_accounts b on b.vendor_id = p.vendor_id
  order by
    case p.status when 'pending' then 0 when 'processing' then 1 else 2 end,
    p.requested_at desc;
end;
$$;

revoke all on function public.admin_payout_queue() from public;
grant execute on function public.admin_payout_queue() to authenticated;

-- ---------- 5. moving a payout along ----------------------------------

create or replace function public.admin_set_payout_status(
  payout_id  uuid,
  next_status text,
  note        text default null
)
returns public.payout_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  current public.payout_requests;
  result  public.payout_requests;
  verb    text;
begin
  if not public.is_admin() then
    raise exception 'Administrators only.';
  end if;

  if next_status not in ('processing', 'completed', 'failed', 'pending') then
    raise exception 'Unknown payout status: %', next_status;
  end if;

  select * into current from public.payout_requests where id = payout_id;
  if current.id is null then
    raise exception 'No such payout request.';
  end if;

  -- A completed payout is money that has left the building. Reopening
  -- it would let the same balance be withdrawn twice.
  if current.status = 'completed' then
    raise exception 'That payout is already completed and cannot be changed.';
  end if;

  if next_status = 'failed' and coalesce(trim(note), '') = '' then
    raise exception 'Say why the payout failed — the vendor sees this.';
  end if;

  update public.payout_requests
     set status         = next_status,
         failure_reason = case when next_status = 'failed' then note else failure_reason end,
         processed_at   = case when next_status in ('completed','failed') then now() else processed_at end,
         processed_by   = case when next_status in ('completed','failed') then auth.uid() else processed_by end
   where id = payout_id
   returning * into result;

  verb := case next_status
            when 'processing' then 'approve_payout'
            when 'completed'  then 'complete_payout'
            when 'failed'     then 'fail_payout'
            else 'hold_payout'
          end;

  insert into public.admin_actions (actor_id, action, subject_type, subject_id, detail)
  values (
    auth.uid(), verb, 'payout', payout_id,
    jsonb_build_object(
      'from', current.status, 'to', next_status,
      'amount', current.amount, 'reference', current.reference,
      'note', note
    )
  );

  return result;
end;
$$;

revoke all on function public.admin_set_payout_status(uuid, text, text) from public;
grant execute on function public.admin_set_payout_status(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
