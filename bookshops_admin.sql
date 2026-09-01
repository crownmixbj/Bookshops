-- Bookshops — admin control centre
--
-- ORDERING NOTE (this is what broke the first version): a function
-- declared LANGUAGE sql has its body parsed and validated at CREATE
-- time, unlike plpgsql which defers until it runs. is_suspended() reads
-- profiles.suspended_at, so that column has to exist before the function
-- is created. Columns and tables therefore come first here, helper
-- functions second, policies third. Do not reorder these sections.
--
-- Read this before running. The shape of this migration is a security
-- decision, not a style choice:
--
--  * Admins get READ policies only. Every admin mutation goes through a
--    narrow SECURITY DEFINER function that re-checks is_admin(),
--    enforces its own invariants, and writes an audit row. A broad
--    "admins can UPDATE profiles" policy would have been shorter and
--    much worse: it cannot express "may change role, but never to or
--    from admin", and it leaves no trail.
--
--  * An admin CANNOT create or remove another admin. That is deliberate
--    and it is the main thing protecting you: a stolen admin session can
--    suspend users and approve shops — bad, reversible, and logged — but
--    it cannot mint itself a permanent foothold or lock you out. New
--    admins are made only in the SQL editor with the service key. The
--    bootstrap statement is at the very bottom, commented out.
--
--  * is_admin() is SECURITY DEFINER on purpose. A policy on `profiles`
--    that queries `profiles` recurses infinitely; the definer function
--    bypasses RLS and breaks the cycle.
--
-- Defaults applied here, as offered when these were not answered:
-- role changes limited to buyer <-> vendor; suspension really enforced;
-- activity feed derived from existing tables.

begin;

-- ============================================================
-- 1. Columns first — the helper functions below depend on them
-- ============================================================
alter table public.profiles
  add column if not exists suspended_at      timestamptz,
  add column if not exists suspension_reason text check (suspension_reason is null or length(suspension_reason) <= 500);

comment on column public.profiles.suspended_at is
  'Set by an admin. Enforced: the write policies below refuse a suspended account. Reads still work so the person can see their own history.';

alter table public.vendors
  add column if not exists approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  add column if not exists reviewed_at  timestamptz,
  add column if not exists reviewed_by  uuid references public.profiles (id) on delete set null,
  add column if not exists review_note  text check (review_note is null or length(review_note) <= 500),
  add column if not exists featured     boolean not null default false;

-- Shops that existed before review was introduced are treated as
-- approved rather than silently pulled from the marketplace.
update public.vendors
   set approval_status = 'approved', reviewed_at = coalesce(reviewed_at, now())
 where approval_status = 'pending';

create index if not exists vendors_approval_idx on public.vendors (approval_status)
  where approval_status = 'pending';

-- ============================================================
-- 2. Identity helpers
-- ============================================================
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'admin'
  );
$$;

create or replace function public.role_of(p_id uuid)
returns public.user_role
language sql
security definer
stable
set search_path = ''
as $$
  select role from public.profiles where id = p_id;
$$;

create or replace function public.is_suspended()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.suspended_at is not null
  );
$$;

revoke all on function public.is_admin(), public.role_of(uuid), public.is_suspended()
  from public, anon;
grant execute on function public.is_admin(), public.role_of(uuid), public.is_suspended()
  to authenticated;

-- ============================================================
-- 3. Audit trail — every admin action, append-only
-- ============================================================
create table if not exists public.admin_actions (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.profiles (id) on delete set null,
  action       text not null check (action in (
                 'set_role', 'suspend_user', 'unsuspend_user',
                 'approve_vendor', 'reject_vendor',
                 'feature_vendor', 'unfeature_vendor',
                 'resolve_report'
               )),
  subject_type text not null check (subject_type in ('profile', 'vendor', 'report')),
  subject_id   uuid not null,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists admin_actions_created_idx on public.admin_actions (created_at desc);

alter table public.admin_actions enable row level security;

-- Readable by admins, written only by the definer functions below.
-- There is deliberately no INSERT/UPDATE/DELETE policy: the log must not
-- be editable by the people it records.
drop policy if exists "admin_actions_select_admin" on public.admin_actions;
create policy "admin_actions_select_admin" on public.admin_actions for select
  to authenticated using (public.is_admin());

-- ============================================================
-- 4. Flagged content
-- ============================================================
create table if not exists public.content_reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid references public.profiles (id) on delete set null,
  subject_type    text not null check (subject_type in ('review', 'booklist', 'vendor', 'quote')),
  subject_id      uuid not null,
  reason          text not null check (length(trim(reason)) between 1 and 500),
  status          text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolved_by     uuid references public.profiles (id) on delete set null,
  resolved_at     timestamptz,
  resolution_note text check (resolution_note is null or length(resolution_note) <= 500),
  created_at      timestamptz not null default now()
);

create index if not exists content_reports_open_idx on public.content_reports (created_at desc)
  where status = 'open';

alter table public.content_reports enable row level security;

drop policy if exists "content_reports_insert_own" on public.content_reports;
drop policy if exists "content_reports_select_own_or_admin" on public.content_reports;

create policy "content_reports_insert_own" on public.content_reports for insert
  to authenticated with check (reporter_id = (select auth.uid()) and not public.is_suspended());
create policy "content_reports_select_own_or_admin" on public.content_reports for select
  to authenticated using (reporter_id = (select auth.uid()) or public.is_admin());

-- ============================================================
-- 5. Admin READ policies
-- ============================================================
-- Policies are OR'd, so these widen admin visibility without touching
-- the rules that protect everyone else.
drop policy if exists "profiles_select_admin"        on public.profiles;
drop policy if exists "vendors_select_admin"         on public.vendors;
drop policy if exists "book_requests_select_admin"   on public.book_requests;
drop policy if exists "book_request_items_sel_admin" on public.book_request_items;
drop policy if exists "quotes_select_admin"          on public.quotes;
drop policy if exists "quote_items_select_admin"     on public.quote_items;
drop policy if exists "orders_select_admin"          on public.orders;
drop policy if exists "vendor_reviews_select_admin"  on public.vendor_reviews;

create policy "profiles_select_admin"        on public.profiles           for select to authenticated using (public.is_admin());
create policy "vendors_select_admin"         on public.vendors            for select to authenticated using (public.is_admin());
create policy "book_requests_select_admin"   on public.book_requests      for select to authenticated using (public.is_admin());
create policy "book_request_items_sel_admin" on public.book_request_items for select to authenticated using (public.is_admin());
create policy "quotes_select_admin"          on public.quotes             for select to authenticated using (public.is_admin());
create policy "quote_items_select_admin"     on public.quote_items        for select to authenticated using (public.is_admin());
create policy "orders_select_admin"          on public.orders             for select to authenticated using (public.is_admin());
create policy "vendor_reviews_select_admin"  on public.vendor_reviews     for select to authenticated using (public.is_admin());

-- ============================================================
-- 6. Suspension actually blocks things
-- ============================================================
-- A Suspend button that stops nothing is theatre. These are the three
-- writes that matter: raising a booklist, quoting one, and ordering.
drop policy if exists "requests_insert_own" on public.book_requests;
create policy "requests_insert_own" on public.book_requests for insert
  to authenticated
  with check (buyer_id = (select auth.uid()) and not public.is_suspended());

drop policy if exists "quotes_insert_own_vendor" on public.quotes;
create policy "quotes_insert_own_vendor" on public.quotes for insert
  to authenticated
  with check (
    not public.is_suspended()
    and exists (
      select 1 from public.vendors v
      where v.id = quotes.vendor_id
        and v.profile_id = (select auth.uid())
        and v.is_active
        and v.approval_status = 'approved'
    )
  );

drop policy if exists "orders_insert_own" on public.orders;
create policy "orders_insert_own" on public.orders for insert
  to authenticated
  with check (
    buyer_id = (select auth.uid())
    and not public.is_suspended()
    and exists (
      select 1 from public.quotes q
      join public.book_requests r on r.id = q.request_id
      where q.id = orders.quote_id and r.buyer_id = (select auth.uid())
    )
  );

-- Buyers should not see shops that have not been approved.
drop policy if exists "vendors_select_active" on public.vendors;
create policy "vendors_select_active" on public.vendors for select
  to authenticated
  using (
    (is_active and approval_status = 'approved')
    or profile_id = (select auth.uid())
  );

commit;

-- ============================================================
-- 7. Admin mutations — narrow, checked, audited
-- ============================================================

create or replace function public.admin_set_role(p_target uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  -- The three invariants that keep a stolen admin session survivable.
  if p_role not in ('buyer', 'vendor') then
    raise exception 'role must be buyer or vendor; admins are granted only with the service key'
      using errcode = '22023';
  end if;
  if public.role_of(p_target) = 'admin' then
    raise exception 'cannot change another administrator''s role' using errcode = '42501';
  end if;
  if p_target = auth.uid() then
    raise exception 'cannot change your own role' using errcode = '42501';
  end if;

  update public.profiles
     set role = p_role::public.user_role, updated_at = now()
   where id = p_target;

  insert into public.admin_actions (actor_id, action, subject_type, subject_id, detail)
  values (auth.uid(), 'set_role', 'profile', p_target, jsonb_build_object('role', p_role));
end;
$$;

create or replace function public.admin_set_suspended(
  p_target uuid, p_suspended boolean, p_reason text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if public.role_of(p_target) = 'admin' then
    raise exception 'cannot suspend an administrator' using errcode = '42501';
  end if;
  if p_target = auth.uid() then
    raise exception 'cannot suspend yourself' using errcode = '42501';
  end if;

  update public.profiles
     set suspended_at = case when p_suspended then now() else null end,
         suspension_reason = case when p_suspended then p_reason else null end,
         updated_at = now()
   where id = p_target;

  insert into public.admin_actions (actor_id, action, subject_type, subject_id, detail)
  values (auth.uid(),
          case when p_suspended then 'suspend_user' else 'unsuspend_user' end,
          'profile', p_target, jsonb_build_object('reason', p_reason));
end;
$$;

create or replace function public.admin_review_vendor(
  p_vendor uuid, p_approve boolean, p_note text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  update public.vendors
     set approval_status = case when p_approve then 'approved' else 'rejected' end,
         verified_at = case when p_approve then coalesce(verified_at, now()) else null end,
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

create or replace function public.admin_set_featured(p_vendor uuid, p_featured boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  update public.vendors set featured = p_featured, updated_at = now() where id = p_vendor;

  insert into public.admin_actions (actor_id, action, subject_type, subject_id, detail)
  values (auth.uid(),
          case when p_featured then 'feature_vendor' else 'unfeature_vendor' end,
          'vendor', p_vendor, '{}'::jsonb);
end;
$$;

create or replace function public.admin_resolve_report(
  p_report uuid, p_status text, p_note text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_status not in ('actioned', 'dismissed') then
    raise exception 'status must be actioned or dismissed' using errcode = '22023';
  end if;

  update public.content_reports
     set status = p_status, resolved_by = auth.uid(), resolved_at = now(), resolution_note = p_note
   where id = p_report;

  insert into public.admin_actions (actor_id, action, subject_type, subject_id, detail)
  values (auth.uid(), 'resolve_report', 'report', p_report,
          jsonb_build_object('status', p_status, 'note', p_note));
end;
$$;

-- ============================================================
-- 8. Platform statistics — one call, admin-gated
-- ============================================================
-- Returns headline counts, the 14-day daily series each sparkline draws,
-- and the pending-work counts. Doing this in SQL keeps the client from
-- pulling every row just to count them.
create or replace function public.admin_platform_stats()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  with days as (
    select generate_series(
      (current_date - interval '13 days')::date, current_date, interval '1 day'
    )::date as d
  ),
  series as (
    select
      d,
      (select count(*) from public.profiles      p where p.created_at::date = d) as users,
      (select count(*) from public.vendors       v where v.created_at::date = d) as vendors,
      (select count(*) from public.orders        o where o.created_at::date = d) as orders,
      (select count(*) from public.book_requests r where r.created_at::date = d) as booklists,
      (select coalesce(sum(o.amount), 0) from public.orders o
        where o.created_at::date = d and o.payment_status = 'paid')              as revenue
    from days
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'users',     (select count(*) from public.profiles),
      'vendors',   (select count(*) from public.vendors),
      'orders',    (select count(*) from public.orders),
      'booklists', (select count(*) from public.book_requests),
      'revenue',   (select coalesce(sum(amount), 0) from public.orders where payment_status = 'paid')
    ),
    'series', jsonb_build_object(
      'users',     (select jsonb_agg(users     order by d) from series),
      'vendors',   (select jsonb_agg(vendors   order by d) from series),
      'orders',    (select jsonb_agg(orders    order by d) from series),
      'booklists', (select jsonb_agg(booklists order by d) from series),
      'revenue',   (select jsonb_agg(revenue   order by d) from series)
    ),
    'pending', jsonb_build_object(
      'vendor_approvals', (select count(*) from public.vendors where approval_status = 'pending'),
      'open_reports',     (select count(*) from public.content_reports where status = 'open')
    )
  ) into result;

  return result;
end;
$$;

revoke all on function
  public.admin_set_role(uuid, text),
  public.admin_set_suspended(uuid, boolean, text),
  public.admin_review_vendor(uuid, boolean, text),
  public.admin_set_featured(uuid, boolean),
  public.admin_resolve_report(uuid, text, text),
  public.admin_platform_stats()
  from public, anon;

grant execute on function
  public.admin_set_role(uuid, text),
  public.admin_set_suspended(uuid, boolean, text),
  public.admin_review_vendor(uuid, boolean, text),
  public.admin_set_featured(uuid, boolean),
  public.admin_resolve_report(uuid, text, text),
  public.admin_platform_stats()
  to authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- 9. BOOTSTRAP YOUR FIRST ADMIN — run this by hand, separately
-- ============================================================
-- Nothing in the app can do this, on purpose. Uncomment, put your own
-- user id in, and run it:
--
--   update public.profiles set role = 'admin'
--    where id = '29d5a95a-96ae-48b9-b1c4-eb1c3ff93886';
--
-- Find ids with:  select id, email from auth.users order by created_at;
--
-- Verify afterwards:
--   select id, full_name, role from public.profiles where role = 'admin';
