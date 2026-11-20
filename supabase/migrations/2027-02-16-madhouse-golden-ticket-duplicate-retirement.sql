-- Retire one confirmed duplicate import of an existing R12 lifetime Golden Ticket.
-- Production data is changed only for the exact imported membership below.
-- The original staff-assigned membership and all financial/identity records remain.
begin;

do $preflight$
begin
  if to_regclass('public.club_memberships') is null
    or to_regclass('public.club_products') is null
    or to_regclass('public.club_membership_holders') is null
    or to_regclass('public.club_entitlement_grants') is null
    or to_regclass('public.club_member_import_rows') is null
    or to_regclass('public.club_member_import_batches') is null
    or to_regclass('public.club_customers') is null
    or to_regclass('public.club_membership_billing_arrangements') is null
    or to_regclass('public.club_membership_billing_obligations') is null
    or to_regclass('public.club_membership_counter_payments') is null
    or to_regclass('public.club_membership_shared_contracts') is null
    or to_regclass('public.club_access_credentials') is null
    or to_regclass('public.club_member_access_projection') is null
    or to_regclass('public.club_access_decisions') is null
    or to_regclass('public.club_attendance_visits') is null then
    raise exception 'Golden Ticket retirement prerequisites are missing; no data was changed';
  end if;
end;
$preflight$;

-- A dedicated restricted audit record is used because SQL Editor execution may
-- have no authenticated user. We never invent a manager identity for the event.
create table if not exists public.club_golden_ticket_duplicate_retirements (
  id uuid primary key default gen_random_uuid(),
  migration_key text not null unique,
  organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  member_user_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null,
  retained_membership_id uuid not null,
  retired_membership_id uuid not null,
  import_batch_id uuid not null references public.club_member_import_batches(id) on delete restrict,
  import_row_id uuid not null references public.club_member_import_rows(id) on delete restrict,
  reason text not null,
  prior_membership jsonb not null check (jsonb_typeof(prior_membership)='object'),
  dependency_snapshot jsonb not null check (jsonb_typeof(dependency_snapshot)='object'),
  recorded_at timestamptz not null default now(),
  executed_by text not null default current_user,
  authenticated_actor uuid references auth.users(id) on delete set null,
  unique (organisation_id, retired_membership_id),
  foreign key (retained_membership_id, organisation_id)
    references public.club_memberships(id, organisation_id) on delete restrict,
  foreign key (retired_membership_id, organisation_id)
    references public.club_memberships(id, organisation_id) on delete restrict,
  foreign key (product_id, organisation_id)
    references public.club_products(id, organisation_id) on delete restrict
);
alter table public.club_golden_ticket_duplicate_retirements enable row level security;
revoke all on public.club_golden_ticket_duplicate_retirements from public, anon, authenticated;

do $retire$
declare
  v_org constant uuid := 'fa44592a-1593-4ad3-a621-63a4a4bcbceb';
  v_user constant uuid := 'db8c0932-ec65-40c7-b054-05b820078e5c';
  v_product constant uuid := 'f6e3b2b2-707d-45e2-8629-168f48e57a91';
  v_keep constant uuid := '3ca14913-2689-4f15-a11d-49b934f71480';
  v_duplicate constant uuid := '9f699641-e6dd-4976-8bb3-51dec6cc4504';
  v_batch constant uuid := '6bf9d303-525a-4565-88a4-b4121fac7f98';
  v_key constant text := '2027-02-16-madhouse-golden-ticket-duplicate-retirement';
  v_reason constant text := 'Duplicate ClubManager import of the existing 4 September 2026 staff-assigned lifetime Golden Ticket. Retire this imported row while retaining its source dates and provenance in the correction audit.';
  v_keep_row public.club_memberships%rowtype;
  v_duplicate_row public.club_memberships%rowtype;
  v_customer uuid;
  v_projection_membership uuid;
  v_projection_allowed boolean;
  v_credential_ids uuid[];
  v_holder_count integer;
  v_grant_count integer;
  v_active_count integer;
  v_arrangement_count integer;
  v_obligation_count integer;
  v_cash_count integer;
  v_shared_count integer;
  v_decision_count integer;
  v_attendance_count integer;
  v_now timestamptz := now();
  v_existing_log public.club_golden_ticket_duplicate_retirements%rowtype;
  v_snapshot jsonb;
begin
  if not exists(select 1 from public.club_organisations where id=v_org and slug='madhouse-gym') then
    raise exception 'Madhouse organisation identity mismatch; no data was changed';
  end if;
  if not exists(select 1 from public.club_products where id=v_product and organisation_id=v_org
      and name='Golden Ticket Founding Membership' and kind='membership'
      and is_lifetime and billing='one_off' and duration_days is null) then
    raise exception 'Golden Ticket product contract mismatch; no data was changed';
  end if;
  if (select count(*) from public.club_memberships where id in (v_keep,v_duplicate))<>2 then
    raise exception 'Expected exactly the two supplied membership IDs; no data was changed';
  end if;

  select * into v_keep_row from public.club_memberships
   where id=v_keep and organisation_id=v_org and product_id=v_product for update;
  select * into v_duplicate_row from public.club_memberships
   where id=v_duplicate and organisation_id=v_org and product_id=v_product for update;
  if v_keep_row.id is null or v_duplicate_row.id is null then
    raise exception 'Membership organisation/product binding mismatch; no data was changed';
  end if;

  if v_keep_row.source<>'staff_assignment'
    or v_keep_row.status<>'active'
    or v_keep_row.ends_at is not null
    or (v_keep_row.starts_at at time zone 'Europe/London')::date<>date '2026-09-04'
    or (v_keep_row.created_at at time zone 'Europe/London')::date<>date '2026-09-04' then
    raise exception 'Original membership no longer matches the verified keep-record facts; no data was changed';
  end if;
  if v_duplicate_row.source<>'legacy_import'
    or v_duplicate_row.import_batch_id<>v_batch
    or v_duplicate_row.status not in ('active','cancelled')
    or v_duplicate_row.ends_at is not null
    or (v_duplicate_row.starts_at at time zone 'Europe/London')::date<>date '2026-09-02'
    or (v_duplicate_row.created_at at time zone 'Europe/London')::date<>date '2026-11-18'
    or v_duplicate_row.import_row_id is null then
    raise exception 'Imported duplicate no longer matches the verified source facts; no data was changed';
  end if;
  if not exists (
    select 1 from public.club_member_import_rows r
    where r.id=v_duplicate_row.import_row_id and r.organisation_id=v_org
      and r.batch_id=v_batch and r.imported_membership_id=v_duplicate
      and r.imported_customer_id is not null
  ) then
    raise exception 'Imported row linkage is inconsistent; no data was changed';
  end if;

  select c.id into v_customer from public.club_customers c
   where c.organisation_id=v_org and c.user_id=v_user;
  if v_customer is null or (select count(*) from public.club_customers c where c.organisation_id=v_org and c.user_id=v_user)<>1 then
    raise exception 'Expected one linked Madhouse customer for the supplied R12 identity; no data was changed';
  end if;
  if not exists(select 1 from public.club_member_import_rows r
      where r.id=v_duplicate_row.import_row_id and r.imported_customer_id=v_customer) then
    raise exception 'Imported customer is not the verified linked customer; no data was changed';
  end if;
  if (select count(*) from public.club_membership_holders h where h.organisation_id=v_org
       and h.membership_id=v_keep and (h.user_id=v_user or h.customer_id=v_customer))<>1
    or exists(select 1 from public.club_membership_holders h where h.organisation_id=v_org
       and h.membership_id=v_keep and h.user_id is distinct from v_user and h.customer_id is distinct from v_customer)
    or (select count(*) from public.club_membership_holders h where h.organisation_id=v_org
       and h.membership_id=v_duplicate and (h.user_id=v_user or h.customer_id=v_customer))<>1
    or exists(select 1 from public.club_membership_holders h where h.organisation_id=v_org
       and h.membership_id=v_duplicate and h.user_id is distinct from v_user and h.customer_id is distinct from v_customer) then
    raise exception 'Membership holder identity differs from the verified account; no data was changed';
  end if;

  select count(*) into v_grant_count from public.club_entitlement_grants g
   where g.organisation_id=v_org and g.membership_id=v_keep and g.user_id=v_user;
  if v_grant_count<>2 then raise exception 'Original membership grant count changed; no data was changed'; end if;
  select count(*) into v_grant_count from public.club_entitlement_grants g
   where g.organisation_id=v_org and g.membership_id=v_duplicate and g.user_id=v_user;
  if v_grant_count<>1 or not exists(select 1 from public.club_entitlement_grants g
      where g.organisation_id=v_org and g.membership_id=v_duplicate and g.user_id=v_user
        and g.entitlement_key='gym_access') then
    raise exception 'Imported duplicate grant facts differ from the verified single gym-access grant; no data was changed';
  end if;
  if exists(select 1 from public.club_entitlement_grants g where g.organisation_id=v_org
      and g.membership_id=v_duplicate and g.user_id is distinct from v_user) then
    raise exception 'Unexpected grant holder on imported duplicate; no data was changed';
  end if;

  select count(distinct m.id) into v_active_count
  from public.club_memberships m
  join public.club_membership_holders h on h.organisation_id=m.organisation_id and h.membership_id=m.id
  where m.organisation_id=v_org and m.product_id=v_product and m.status='active'
    and (h.user_id=v_user or h.customer_id=v_customer);
  if v_active_count<>(case when v_duplicate_row.status='active' then 2 else 1 end) then
    raise exception 'Golden Ticket active-count does not match the expected preflight/idempotent state; no data was changed';
  end if;

  select membership_id,access_allowed into v_projection_membership,v_projection_allowed
  from public.club_member_access_projection where organisation_id=v_org and customer_id=v_customer;
  if not found or not v_projection_allowed or v_projection_membership not in (v_keep,v_duplicate) then
    raise exception 'Current member-access projection does not identify valid access from one of the two supplied memberships; no data was changed';
  end if;

  select coalesce(array_agg(c.id order by c.id),'{}'::uuid[]) into v_credential_ids
  from public.club_access_credentials c where c.organisation_id=v_org and c.customer_id=v_customer
    and c.credential_type in ('pin','qr') and c.status='active' and c.permanent;
  if not exists(select 1 from public.club_access_credentials c where c.organisation_id=v_org
      and c.customer_id=v_customer and c.credential_type='pin' and c.status='active' and c.permanent)
    or not exists(select 1 from public.club_access_credentials c where c.organisation_id=v_org
      and c.customer_id=v_customer and c.credential_type='qr' and c.status='active' and c.permanent) then
    raise exception 'Expected the existing active PIN and QR credentials; no data was changed';
  end if;

  select count(*) into v_arrangement_count from public.club_membership_billing_arrangements a
    where a.organisation_id=v_org and a.membership_id=v_duplicate;
  select count(*) into v_obligation_count from public.club_membership_billing_obligations o
    where o.organisation_id=v_org and o.membership_id=v_duplicate;
  select count(*) into v_cash_count from public.club_membership_counter_payments p
    where p.organisation_id=v_org and p.membership_id=v_duplicate;
  select count(*) into v_shared_count from public.club_membership_shared_contracts s
    where s.organisation_id=v_org and s.membership_id=v_duplicate;
  if v_arrangement_count<>0 or v_obligation_count<>0 or v_cash_count<>0 or v_shared_count<>0 then
    raise exception 'Financial or household dependencies were found on the duplicate; no data was changed';
  end if;
  select count(*) into v_decision_count from public.club_access_decisions d
    where d.organisation_id=v_org and d.membership_id=v_duplicate;
  select count(*) into v_attendance_count from public.club_attendance_visits a
    where a.organisation_id=v_org and a.membership_id=v_duplicate;

  select * into v_existing_log from public.club_golden_ticket_duplicate_retirements
    where migration_key=v_key for update;
  if found then
    if v_duplicate_row.status<>'cancelled'
      or v_duplicate_row.ends_at is not null
      or v_duplicate_row.end_reason is distinct from v_reason
      or v_existing_log.retired_membership_id<>v_duplicate
      or v_existing_log.retained_membership_id<>v_keep then
      raise exception 'Existing retirement audit does not match the expected completed correction; no data was changed';
    end if;
  else
    if v_duplicate_row.status<>'active' then
      raise exception 'Duplicate is not active and has no matching retirement audit; no data was changed';
    end if;

    v_snapshot:=jsonb_build_object(
      'active_pin_qr_credential_ids',to_jsonb(v_credential_ids),
      'projection_before',jsonb_build_object('membership_id',v_projection_membership,'access_allowed',v_projection_allowed),
      'membership_bound_access_decision_count',v_decision_count,
      'attendance_visit_count',v_attendance_count,
      'billing_arrangement_count',v_arrangement_count,
      'billing_obligation_count',v_obligation_count,
      'counter_payment_count',v_cash_count,
      'shared_contract_count',v_shared_count,
      'duplicate_entitlement_grant_count',1,
      'retained_membership_entitlement_grant_count',2
    );
    insert into public.club_golden_ticket_duplicate_retirements(
      migration_key,organisation_id,member_user_id,product_id,retained_membership_id,
      retired_membership_id,import_batch_id,import_row_id,reason,prior_membership,
      dependency_snapshot,recorded_at,executed_by,authenticated_actor
    ) values (
      v_key,v_org,v_user,v_product,v_keep,v_duplicate,v_batch,v_duplicate_row.import_row_id,
      v_reason,jsonb_build_object(
        'membership_id',v_duplicate_row.id,'status',v_duplicate_row.status,
        'source',v_duplicate_row.source,'starts_at',v_duplicate_row.starts_at,
        'ends_at',v_duplicate_row.ends_at,'created_at',v_duplicate_row.created_at,
        'import_batch_id',v_duplicate_row.import_batch_id,
        'import_row_id',v_duplicate_row.import_row_id,
        'migration_metadata',v_duplicate_row.migration_metadata
      ),v_snapshot,v_now,current_user,auth.uid()
    );

    update public.club_memberships
       set status='cancelled',
           ended_at=v_now,
           ended_by=coalesce(auth.uid(),ended_by),
           end_requested_at=coalesce(end_requested_at,v_now),
           end_requested_by=coalesce(auth.uid(),end_requested_by),
           end_reason=v_reason,
           migration_metadata=coalesce(migration_metadata,'{}'::jsonb)||jsonb_build_object(
             'golden_ticket_duplicate_retirement',jsonb_build_object(
               'migration_key',v_key,'retained_membership_id',v_keep,
               'retired_membership_id',v_duplicate,'reason',v_reason,
               'retired_at',v_now,'original_status',v_duplicate_row.status,
               'original_starts_at',v_duplicate_row.starts_at,
               'original_ends_at',v_duplicate_row.ends_at,
               'original_source',v_duplicate_row.source,
               'import_batch_id',v_duplicate_row.import_batch_id,
               'import_row_id',v_duplicate_row.import_row_id
             )),
           updated_at=v_now
     where id=v_duplicate and organisation_id=v_org and product_id=v_product and status='active';
    if not found then raise exception 'Duplicate retirement update did not affect exactly the active target row'; end if;
  end if;

  -- The membership trigger recalculates the customer projection. It must now
  -- resolve to the retained membership without changing access eligibility.
  if not exists(select 1 from public.club_memberships m where m.id=v_keep
      and m.organisation_id=v_org and m.product_id=v_product
      and m.source='staff_assignment' and m.status='active' and m.ends_at is null
      and (m.starts_at at time zone 'Europe/London')::date=date '2026-09-04') then
    raise exception 'Retained original membership changed unexpectedly';
  end if;
  if not exists(select 1 from public.club_memberships m where m.id=v_duplicate
      and m.organisation_id=v_org and m.product_id=v_product
      and m.source='legacy_import' and m.import_batch_id=v_batch
      and m.status='cancelled' and m.ends_at is null and m.ended_at is not null
      and m.end_reason=v_reason
      and m.migration_metadata ? 'golden_ticket_duplicate_retirement') then
    raise exception 'Imported duplicate retirement or preserved lifetime provenance did not verify';
  end if;
  if (select count(*) from public.club_memberships m
      join public.club_membership_holders h on h.organisation_id=m.organisation_id and h.membership_id=m.id
      where m.organisation_id=v_org and m.product_id=v_product and m.status='active'
        and (h.user_id=v_user or h.customer_id=v_customer))<>1 then
    raise exception 'Postflight did not leave exactly one active Golden Ticket membership';
  end if;
  if not exists(select 1 from public.club_member_access_projection p
      where p.organisation_id=v_org and p.customer_id=v_customer
        and p.membership_id=v_keep and p.access_allowed=v_projection_allowed) then
    raise exception 'Access projection did not retain the original membership and eligibility';
  end if;
  if (select coalesce(array_agg(c.id order by c.id),'{}'::uuid[]) from public.club_access_credentials c
      where c.organisation_id=v_org and c.customer_id=v_customer
        and c.credential_type in ('pin','qr') and c.status='active' and c.permanent)
      is distinct from v_credential_ids then
    raise exception 'Existing PIN/QR credentials changed unexpectedly';
  end if;
  if (select count(*) from public.club_entitlement_grants g where g.organisation_id=v_org
      and g.membership_id=v_keep and g.user_id=v_user)<>2
    or (select count(*) from public.club_entitlement_grants g where g.organisation_id=v_org
      and g.membership_id=v_duplicate and g.user_id=v_user)<>1 then
    raise exception 'Historical entitlement grant records changed unexpectedly';
  end if;
  if (select count(*) from public.club_access_decisions d where d.organisation_id=v_org and d.membership_id=v_duplicate)<>v_decision_count
    or (select count(*) from public.club_attendance_visits a where a.organisation_id=v_org and a.membership_id=v_duplicate)<>v_attendance_count then
    raise exception 'Historical access or attendance records changed unexpectedly';
  end if;
  if not exists(select 1 from public.club_golden_ticket_duplicate_retirements a
      where a.migration_key=v_key and a.organisation_id=v_org
        and a.retired_membership_id=v_duplicate and a.retained_membership_id=v_keep) then
    raise exception 'Retirement audit record is missing';
  end if;
  raise notice 'Golden Ticket duplicate retirement verified: retained %, retired %, active memberships now 1, PIN/QR credentials and historical records preserved.',v_keep,v_duplicate;
end;
$retire$;

commit;
