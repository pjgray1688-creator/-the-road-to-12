-- Review-only migration: audited in-gym membership payment evidence and Family terms.
-- This migration makes no provider calls, collections, charges or product-price changes.
begin;

alter table public.club_staff_permission_overrides drop constraint if exists club_staff_permission_overrides_capability_check;
alter table public.club_staff_permission_overrides add constraint club_staff_permission_overrides_capability_check check (capability in (
  'members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately',
  'payments.take','payments.record_cash','payments.extend_grace','membership_payments.verify',
  'memberships.pricing_sensitive','memberships.manage','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust',
  'commerce.stock_remove','members.import','staff.permissions_manage','induction.manage_policy','induction.perform',
  'classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive',
  'commerce.pricing_manage','commerce.collections_manage','finance.view','finance.manage','staff.work_submit',
  'staff.work_review','finance.export'
));

create or replace function public.club_capabilities_for_role(p_role text)
returns text[] language sql immutable set search_path=pg_catalog,public as $$
  select case
    when p_role='owner' then array[
      'members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately',
      'payments.take','payments.record_cash','payments.extend_grace','membership_payments.verify','memberships.pricing_sensitive','memberships.manage',
      'refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','commerce.stock_remove','members.import',
      'staff.permissions_manage','induction.manage_policy','induction.perform','classes.manage','services.manage',
      'supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage',
      'commerce.collections_manage','finance.view','finance.manage','staff.work_submit','staff.work_review','finance.export'
    ]::text[]
    when p_role='gym_admin' then array[
      'members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately',
      'payments.take','payments.record_cash','membership_payments.verify','memberships.manage','refunds.issue','refunds.approve','cash.reconcile',
      'inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage','induction.manage_policy',
      'induction.perform','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage',
      'supplier.receive','commerce.pricing_manage','commerce.collections_manage','finance.view','finance.manage',
      'staff.work_submit','staff.work_review','finance.export'
    ]::text[]
    when p_role in ('gym_staff','trainer') then array[
      'members.view','members.create','members.link_account','memberships.assign','payments.take','payments.record_cash',
      'refunds.issue','inventory.adjust','commerce.stock_remove','induction.perform','classes.manage','services.manage',
      'supplier.orders_manage','supplier.receive','commerce.collections_manage','staff.work_submit'
    ]::text[]
    else '{}'::text[]
  end;
$$;

create or replace function public.club_capability_allowed(p_organisation_id uuid,p_user_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select auth.uid() is not null and p_user_id=auth.uid() and exists (
    select 1 from public.club_members m
    where m.organisation_id=p_organisation_id and m.user_id=p_user_id and m.active
      and m.role in ('owner','gym_admin','gym_staff','trainer') and (
        (m.role='owner' and p_capability in ('payments.extend_grace','memberships.pricing_sensitive')) or (
          not exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=p_user_id and o.capability=p_capability and o.decision='deny')
          and (p_capability=any(public.club_capabilities_for_role(m.role)) or (p_capability<>'staff.permissions_manage' and exists(
            select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=p_user_id and o.capability=p_capability and o.decision='allow'
          )))
        )
      )
  );
$$;

create table public.club_membership_counter_payments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  product_id uuid not null,
  customer_id uuid not null,
  membership_id uuid,
  location_id uuid not null,
  method text not null check(method in ('cash','bank_transfer','external_card')),
  amount_minor integer not null check(amount_minor>0),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  state text not null default 'pending_verification' check(state in ('pending_verification','confirmed','rejected')),
  reconciliation_state text not null default 'unreconciled' check(reconciliation_state in ('unreconciled','verified','rejected')),
  external_reference text,
  evidence_note text not null check(char_length(btrim(evidence_note)) between 8 and 500),
  starts_at timestamptz not null,
  initiated_by uuid not null references auth.users(id) on delete restrict,
  initiated_at timestamptz not null default now(),
  verified_by uuid references auth.users(id) on delete restrict,
  verified_at timestamptz,
  verification_note text,
  idempotency_key text not null check(char_length(btrim(idempotency_key)) between 8 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organisation_id), unique(organisation_id,idempotency_key),
  foreign key(product_id,organisation_id) references public.club_products(id,organisation_id) on delete restrict,
  foreign key(customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete restrict,
  foreign key(membership_id,organisation_id) references public.club_memberships(id,organisation_id) on delete restrict,
  foreign key(location_id,organisation_id) references public.club_locations(id,organisation_id) on delete restrict,
  check(method='cash' or coalesce(char_length(btrim(external_reference)),0)>0),
  check((state='pending_verification' and verified_by is null and verified_at is null) or
    (state in ('confirmed','rejected') and verified_by is not null and verified_at is not null and nullif(btrim(verification_note),'') is not null))
);
create unique index club_membership_counter_payments_reference_uidx on public.club_membership_counter_payments(organisation_id,method,external_reference) where external_reference is not null;
create unique index club_membership_counter_payments_open_uidx on public.club_membership_counter_payments(organisation_id,customer_id,product_id) where state in ('pending_verification','confirmed');
create index club_membership_counter_payments_review_idx on public.club_membership_counter_payments(organisation_id,state,initiated_at);
alter table public.club_membership_counter_payments enable row level security;
revoke all on public.club_membership_counter_payments from public,anon,authenticated;

create or replace function public.club_initiate_membership_counter_payment(
  p_organisation_id uuid,p_product_id uuid,p_customer_id uuid,p_location_id uuid,p_method text,
  p_external_reference text,p_evidence_note text,p_starts_at timestamptz,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare product public.club_products%rowtype; row public.club_membership_counter_payments%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then raise exception 'Membership payment initiation is not permitted' using errcode='42501'; end if;
  if p_method not in ('cash','bank_transfer','external_card') or p_starts_at is null or nullif(btrim(p_evidence_note),'') is null or char_length(btrim(p_evidence_note)) not between 8 and 500 or nullif(btrim(p_idempotency_key),'') is null then raise exception 'Complete the payment evidence' using errcode='22023'; end if;
  if p_method='cash' and not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.record_cash') then raise exception 'Cash recording is not permitted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id) then raise exception 'Member is outside this organisation' using errcode='42501'; end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) or not public.club_location_authorized(p_organisation_id,p_location_id) then raise exception 'An authorised active venue is required' using errcode='42501'; end if;
  select * into product from public.club_products where id=p_product_id and organisation_id=p_organisation_id for share;
  if not found or product.kind<>'membership' or product.archived_at is not null or not product.sellable or product.price_minor<=0 or product.pricing_on_request then raise exception 'This product requires a different authorised contract workflow' using errcode='22023'; end if;
  select * into row from public.club_membership_counter_payments where organisation_id=p_organisation_id and idempotency_key=btrim(p_idempotency_key);
  if found then
    if row.product_id<>p_product_id or row.customer_id<>p_customer_id or row.location_id<>p_location_id or row.method<>p_method then raise exception 'Idempotency key represents another payment' using errcode='23505'; end if;
    return to_jsonb(row);
  end if;
  insert into public.club_membership_counter_payments(organisation_id,product_id,customer_id,location_id,method,amount_minor,currency,external_reference,evidence_note,starts_at,initiated_by,idempotency_key)
  values(p_organisation_id,p_product_id,p_customer_id,p_location_id,p_method,product.price_minor,product.currency,nullif(btrim(p_external_reference),''),btrim(p_evidence_note),p_starts_at,auth.uid(),btrim(p_idempotency_key)) returning * into row;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata)
  select p_organisation_id,auth.uid(),m.role,'membership.payment_initiated','membership_counter_payment',row.id,p_location_id,btrim(p_evidence_note),jsonb_build_object('product_id',product.id,'customer_id',p_customer_id,'method',p_method,'amount_minor',product.price_minor,'currency',product.currency,'reference_present',row.external_reference is not null)
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active;
  return to_jsonb(row);
end $$;

create or replace function public.club_verify_membership_counter_payment(p_organisation_id uuid,p_payment_id uuid,p_decision text,p_verification_note text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare payment public.club_membership_counter_payments%rowtype; product public.club_products%rowtype; result jsonb; end_at timestamptz;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'membership_payments.verify') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.assign') then raise exception 'Payment verification is not permitted' using errcode='42501'; end if;
  if p_decision not in ('confirmed','rejected') or nullif(btrim(p_verification_note),'') is null or char_length(btrim(p_verification_note)) not between 8 and 500 then raise exception 'A documented verification decision is required' using errcode='22023'; end if;
  select * into payment from public.club_membership_counter_payments where id=p_payment_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Payment record not found' using errcode='P0002'; end if;
  if payment.state<>'pending_verification' then
    if payment.state<>p_decision then raise exception 'Payment already has a different verification decision' using errcode='23505'; end if;
    return to_jsonb(payment);
  end if;
  if payment.method='cash' and not public.club_capability_allowed(p_organisation_id,auth.uid(),'cash.reconcile') then raise exception 'Cash reconciliation is not permitted' using errcode='42501'; end if;
  if p_decision='confirmed' then
    select * into product from public.club_products where id=payment.product_id and organisation_id=payment.organisation_id for share;
    if not found or product.archived_at is not null or product.price_minor<>payment.amount_minor or product.currency<>payment.currency or product.pricing_on_request then raise exception 'Product terms changed; review without activating access' using errcode='22023'; end if;
    end_at:=case when product.duration_days is not null then payment.starts_at + make_interval(days=>product.duration_days) else null end;
    result:=public.club_assign_membership(payment.organisation_id,payment.product_id,payment.customer_id,'{}'::uuid[],payment.starts_at,end_at,'staff_assignment','counter-payment:'||payment.id::text);
    update public.club_membership_counter_payments set state='confirmed',reconciliation_state='verified',membership_id=(result->'membership'->>'id')::uuid,verified_by=auth.uid(),verified_at=now(),verification_note=btrim(p_verification_note),updated_at=now() where id=payment.id returning * into payment;
  else
    update public.club_membership_counter_payments set state='rejected',reconciliation_state='rejected',verified_by=auth.uid(),verified_at=now(),verification_note=btrim(p_verification_note),updated_at=now() where id=payment.id returning * into payment;
  end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata)
  select p_organisation_id,auth.uid(),m.role,'membership.payment_'||p_decision,'membership_counter_payment',payment.id,payment.location_id,btrim(p_verification_note),jsonb_build_object('membership_id',payment.membership_id,'method',payment.method,'amount_minor',payment.amount_minor,'currency',payment.currency)
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active;
  return to_jsonb(payment);
end $$;

alter table public.club_membership_shared_contracts add column if not exists agreed_amount_minor integer check(agreed_amount_minor is null or agreed_amount_minor>0), add column if not exists currency text check(currency is null or currency ~ '^[A-Z]{3}$'), add column if not exists frequency text check(frequency is null or frequency in ('weekly','monthly','quarterly','annual','other')), add column if not exists billing_state text check(billing_state is null or billing_state in ('pending','active','paused','ended')), add column if not exists terms_set_by uuid references auth.users(id) on delete restrict, add column if not exists terms_set_at timestamptz;

create or replace function public.club_set_family_contract_terms(p_organisation_id uuid,p_membership_id uuid,p_amount_minor integer,p_currency text,p_frequency text,p_paid_through_date date,p_billing_state text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare contract public.club_membership_shared_contracts%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.pricing_sensitive') then raise exception 'Sensitive Family pricing permission is required' using errcode='42501'; end if;
  if p_amount_minor<=0 or p_currency!~'^[A-Z]{3}$' or p_frequency not in ('weekly','monthly','quarterly','annual','other') or p_billing_state not in ('pending','active','paused','ended') or char_length(btrim(p_reason)) not between 8 and 500 then raise exception 'Complete the negotiated Family terms' using errcode='22023'; end if;
  update public.club_membership_shared_contracts set agreed_amount_minor=p_amount_minor,currency=p_currency,frequency=p_frequency,paid_through_date=p_paid_through_date,billing_state=p_billing_state,terms_set_by=auth.uid(),terms_set_at=now(),updated_at=now()
  where membership_id=p_membership_id and organisation_id=p_organisation_id and arrangement_kind='family' returning * into contract;
  if not found then raise exception 'Family contract not found' using errcode='P0002'; end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,reason,metadata)
  select p_organisation_id,auth.uid(),m.role,'membership.family_terms_set','membership',p_membership_id,btrim(p_reason),jsonb_build_object('amount_minor',p_amount_minor,'currency',p_currency,'frequency',p_frequency,'paid_through_date',p_paid_through_date,'billing_state',p_billing_state)
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active;
  return to_jsonb(contract);
end $$;

revoke all on function public.club_initiate_membership_counter_payment(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text),public.club_verify_membership_counter_payment(uuid,uuid,text,text),public.club_set_family_contract_terms(uuid,uuid,integer,text,text,date,text,text) from public,anon;
grant execute on function public.club_initiate_membership_counter_payment(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text),public.club_verify_membership_counter_payment(uuid,uuid,text,text),public.club_set_family_contract_terms(uuid,uuid,integer,text,text,date,text,text) to authenticated;

commit;
