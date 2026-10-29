-- Shared Couple/Family contracts and method-specific grace.
-- Review-only: no provider calls, charges, resubscriptions or immediate suspensions.
begin;

alter table public.club_products add column if not exists pricing_on_request boolean not null default false;

alter table public.club_membership_product_rules drop constraint if exists club_membership_product_rules_maximum_holders_check;
alter table public.club_membership_product_rules alter column maximum_holders drop not null;
alter table public.club_membership_product_rules add column if not exists shared_membership boolean not null default false;
alter table public.club_membership_product_rules add constraint club_membership_product_rules_maximum_holders_check
  check(maximum_holders is null or maximum_holders>=1);

do $$
declare org uuid; family_product uuid;
begin
  select id into org from public.club_organisations where slug='madhouse-gym';
  if org is null then raise exception 'Madhouse organisation is missing'; end if;
  update public.club_membership_product_rules r set shared_membership=true
  from public.club_products p where p.id=r.product_id and p.organisation_id=r.organisation_id and p.organisation_id=org and p.name='Unlimited Gym Couple';
  select id into family_product from public.club_products where organisation_id=org and name='Family Membership';
  if family_product is null then
    insert into public.club_products(organisation_id,name,kind,price_minor,currency,billing,sellable)
    values(org,'Family Membership','membership',0,'GBP','recurring',false) returning id into family_product;
  else
    update public.club_products set kind='membership',currency='GBP',billing='recurring',pricing_on_request=true,sellable=false,archived_at=null where id=family_product and organisation_id=org;
  end if;
  update public.club_products set pricing_on_request=true where id=family_product and organisation_id=org;
  insert into public.club_membership_product_rules(product_id,organisation_id,catalogue_code,maximum_holders,shared_membership)
  values(family_product,org,'madhouse.membership.family.v1',null,true)
  on conflict(product_id) do update set catalogue_code=excluded.catalogue_code,maximum_holders=null,shared_membership=true,updated_at=now();
  insert into public.club_product_entitlements(product_id,organisation_id,position,entitlement_key,scope,location_ids)
  values(family_product,org,0,'gym_access','future_locations','{}')
  on conflict(product_id,position) do update set entitlement_key='gym_access',scope='future_locations',location_ids='{}';
end $$;

create or replace function public.club_guard_membership_holder_limit() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare max_holders integer; is_shared boolean; current_holders integer;
begin
  if exists(select 1 from public.club_membership_holders h where h.membership_id=new.membership_id and h.organisation_id=new.organisation_id and (h.user_id is not distinct from new.user_id or h.customer_id is not distinct from new.customer_id)) then return new; end if;
  select r.maximum_holders,r.shared_membership into max_holders,is_shared from public.club_memberships m
    join public.club_membership_product_rules r on r.product_id=m.product_id and r.organisation_id=m.organisation_id
    where m.id=new.membership_id and m.organisation_id=new.organisation_id;
  if not found then max_holders:=1; is_shared:=false; end if;
  if is_shared and max_holders is null then return new; end if;
  select count(*) into current_holders from public.club_membership_holders where membership_id=new.membership_id and organisation_id=new.organisation_id;
  if current_holders>=coalesce(max_holders,1) then raise exception 'This membership does not cover another person' using errcode='22023'; end if;
  return new;
end $$;

alter table public.club_membership_holders add column if not exists coverage_role text;
alter table public.club_membership_holders drop constraint if exists club_membership_holders_coverage_role_check;
alter table public.club_membership_holders add constraint club_membership_holders_coverage_role_check check(coverage_role is null or coverage_role in ('adult','child','other'));

create table if not exists public.club_membership_shared_contracts (
  membership_id uuid primary key, organisation_id uuid not null, external_contract_reference text,
  arrangement_kind text not null check(arrangement_kind in ('couple','family')),
  default_composition text check(default_composition is null or default_composition in ('2_adults_1_child','1_adult_2_children','existing_contract')),
  responsible_payer_customer_id uuid not null, imported boolean not null default false,
  paid_through_date date, provider_reconciliation_state text not null default 'not_required'
    check(provider_reconciliation_state in ('not_required','pending','reconciled','mismatch')),
  reconciliation_note text, reconciled_by uuid references auth.users(id) on delete set null, reconciled_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organisation_id,external_contract_reference),
  foreign key(membership_id,organisation_id) references public.club_memberships(id,organisation_id) on delete restrict,
  foreign key(responsible_payer_customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete restrict
);
alter table public.club_membership_shared_contracts enable row level security;
revoke all on public.club_membership_shared_contracts from public,anon,authenticated;

-- Imported payers may not have claimed R12 yet; customer identity remains authoritative.
alter table public.club_membership_billing_arrangements alter column user_id drop not null;
alter table public.club_membership_billing_obligations alter column user_id drop not null;
alter table public.club_membership_payment_access_suspensions alter column user_id drop not null;
alter table public.club_membership_billing_arrangements drop constraint if exists club_membership_billing_arrangements_payer_identity_check;
alter table public.club_membership_billing_arrangements add constraint club_membership_billing_arrangements_payer_identity_check check(num_nonnulls(user_id,customer_id)>=1);
alter table public.club_membership_billing_obligations drop constraint if exists club_membership_billing_obligations_payer_identity_check;
alter table public.club_membership_billing_obligations add constraint club_membership_billing_obligations_payer_identity_check check(num_nonnulls(user_id,customer_id)>=1);
alter table public.club_membership_billing_arrangements add column if not exists schedule_source text not null default 'first_successful_payment';
alter table public.club_membership_billing_arrangements add column if not exists anniversary_established_at timestamptz;
alter table public.club_membership_billing_arrangements drop constraint if exists club_membership_billing_arrangements_schedule_source_check;
alter table public.club_membership_billing_arrangements add constraint club_membership_billing_arrangements_schedule_source_check check(schedule_source in ('first_successful_payment','imported_contract'));
update public.club_membership_billing_arrangements a set schedule_source=case when m.source='legacy_import' then 'imported_contract' else 'first_successful_payment' end,
  anniversary_established_at=coalesce(a.last_successful_payment_at,m.starts_at)
from public.club_memberships m where m.id=a.membership_id and m.organisation_id=a.organisation_id and a.anniversary_established_at is null;

alter table public.club_membership_billing_obligations add column if not exists grace_expires_at timestamptz;
create table if not exists public.club_membership_billing_state_history (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null,
  obligation_id uuid not null, previous_state text, state text not null, occurred_at timestamptz not null default now(),
  foreign key(obligation_id,organisation_id) references public.club_membership_billing_obligations(id,organisation_id) on delete restrict
);
alter table public.club_membership_billing_state_history enable row level security;
revoke all on public.club_membership_billing_state_history from public,anon,authenticated;
create or replace function public.club_record_membership_billing_state() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  if tg_op='INSERT' or new.state is distinct from old.state then
    insert into public.club_membership_billing_state_history(organisation_id,obligation_id,previous_state,state)
    values(new.organisation_id,new.id,case when tg_op='UPDATE' then old.state else null end,new.state);
  end if;
  return new;
end $$;
drop trigger if exists club_record_membership_billing_state on public.club_membership_billing_obligations;
create trigger club_record_membership_billing_state after insert or update of state on public.club_membership_billing_obligations
for each row execute function public.club_record_membership_billing_state();
create or replace function public.club_apply_membership_provider_state() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  if new.obligation_id is null then return new; end if;
  if new.event_type='payment_submitted' then
    update public.club_membership_billing_obligations set state='payment_pending',updated_at=now()
    where id=new.obligation_id and organisation_id=new.organisation_id and state not in ('paid','recovered','cancelled','waived');
  elsif new.event_type='payment_failed' then
    update public.club_membership_billing_obligations set state='failed',updated_at=now()
    where id=new.obligation_id and organisation_id=new.organisation_id and state not in ('paid','recovered','cancelled','waived');
  end if;
  return new;
end $$;
drop trigger if exists club_apply_membership_provider_state on public.club_membership_billing_provider_events;
create trigger club_apply_membership_provider_state after insert on public.club_membership_billing_provider_events
for each row execute function public.club_apply_membership_provider_state();
create table if not exists public.club_billing_non_working_dates (
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  non_working_date date not null, label text not null, primary key(organisation_id,non_working_date)
);
alter table public.club_billing_non_working_dates enable row level security;
revoke all on public.club_billing_non_working_dates from public,anon,authenticated;

create or replace function public.club_add_billing_working_days(p_organisation_id uuid,p_start timestamptz,p_days integer)
returns timestamptz language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result timestamptz:=p_start; added integer:=0; local_day date;
begin
  if p_days<0 then raise exception 'Working-day count cannot be negative' using errcode='22023'; end if;
  while added<p_days loop
    result:=result+interval '1 day'; local_day:=(result at time zone 'Europe/London')::date;
    if extract(isodow from local_day)<6 and not exists(select 1 from public.club_billing_non_working_dates d where d.organisation_id=p_organisation_id and d.non_working_date=local_day) then added:=added+1; end if;
  end loop;
  return result;
end $$;

create or replace function public.club_membership_grace_expires_at(p_organisation_id uuid,p_method text,p_failure_at timestamptz)
returns timestamptz language sql stable security definer set search_path=pg_catalog,public as $$
  select case when p_method='cash' then p_failure_at+interval '7 days'
    else public.club_add_billing_working_days(p_organisation_id,p_failure_at,3) end;
$$;

create or replace function public.club_evaluate_membership_billing(p_organisation_id uuid,p_as_of timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare policy public.club_membership_billing_policies%rowtype; o public.club_membership_billing_obligations%rowtype; changed integer:=0; expiry timestamptz; stage text; key text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then raise exception 'Billing evaluation is not permitted' using errcode='42501'; end if;
  select * into policy from public.club_membership_billing_policies where organisation_id=p_organisation_id;
  for o in select obligation.* from public.club_membership_billing_obligations obligation
    left join public.club_membership_shared_contracts contract on contract.membership_id=obligation.membership_id and contract.organisation_id=obligation.organisation_id
    where obligation.organisation_id=p_organisation_id and obligation.state not in ('paid','recovered','cancelled','waived')
      and not (coalesce(contract.imported,false) and contract.provider_reconciliation_state='pending') for update of obligation loop
    if o.next_due_at<=p_as_of and o.state='upcoming' then update public.club_membership_billing_obligations set state='due',updated_at=now() where id=o.id; changed:=changed+1; end if;
    if o.next_due_at<=p_as_of and o.state in ('due','payment_pending','failed') then
      expiry:=coalesce(o.grace_expires_at,public.club_membership_grace_expires_at(p_organisation_id,o.payment_method_family,coalesce(o.grace_started_at,o.next_due_at)));
      update public.club_membership_billing_obligations set state='grace',grace_started_at=coalesce(grace_started_at,o.next_due_at),grace_expires_at=expiry,updated_at=now() where id=o.id;
    else expiry:=o.grace_expires_at; end if;
    if expiry is not null and p_as_of>=expiry and coalesce(policy.access_suspension_enabled,false) then
      update public.club_membership_billing_obligations set state='overdue',recovery_exhausted_at=coalesce(recovery_exhausted_at,p_as_of),updated_at=now() where id=o.id;
      insert into public.club_membership_payment_access_suspensions(organisation_id,membership_id,user_id,obligation_id)
      values(p_organisation_id,o.membership_id,o.user_id,o.id) on conflict(obligation_id) do update set active=true,cleared_at=null;
      stage:='access_suspended';
    else stage:=case when expiry is not null then 'grace_reminder' else 'payment_failed' end; end if;
    key:='billing:'||o.id::text||':'||stage;
    if o.user_id is not null then insert into public.club_membership_billing_notifications(organisation_id,obligation_id,user_id,notification_type,idempotency_key)
      values(p_organisation_id,o.id,o.user_id,stage,key) on conflict(organisation_id,idempotency_key) do nothing; end if;
  end loop;
  return jsonb_build_object('organisation_id',p_organisation_id,'evaluated_at',p_as_of,'changed',changed);
end $$;

create or replace function public.club_import_mapped_value(p_raw jsonb,p_mapping jsonb,p_key text,p_fallback text[])
returns text language sql immutable set search_path=pg_catalog,public as $$
  select nullif(btrim(coalesce(p_raw->>(p_mapping->>p_key),(select p_raw->>x from unnest(p_fallback) x where nullif(btrim(p_raw->>x),'') is not null limit 1))), '');
$$;

-- Keep the proven individual importer intact. Shared-only batches take a separate
-- all-or-nothing path that creates one membership before attaching its people.
alter function public.club_execute_member_import_batch(uuid,uuid) rename to club_execute_member_import_batch_individual_base;
create or replace function public.club_execute_member_import_batch(p_organisation_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_member_import_batches%rowtype; r record; group_row record; c public.club_customers%rowtype; payer public.club_customers%rowtype;
  u uuid; ref text; household_ref text; payer_ref text; product uuid; product_name text; membership public.club_memberships%rowtype;
  start_at timestamptz; end_at timestamptz; status_value text; role_value text; method text; provider_type text; provider_customer text; provider_subscription text;
  next_due date; paid_through date; amount_minor integer; arrangement_id uuid; made integer:=0; linked integer:=0; failed integer:=0;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then raise exception 'Member import is not permitted' using errcode='42501'; end if;
  select * into b from public.club_member_import_batches where id=p_batch_id and organisation_id=p_organisation_id for update;
  if not found or b.status not in ('ready','importing') then raise exception 'Batch is not ready to import' using errcode='22023'; end if;
  if not exists(select 1 from public.club_member_import_rows x where x.batch_id=b.id and public.club_import_mapped_value(x.raw_values,b.mapping,'householdReference',array['shared_contract_id','household_reference']) is not null) then
    return public.club_execute_member_import_batch_individual_base(p_organisation_id,p_batch_id);
  end if;
  if exists(select 1 from public.club_member_import_rows x where x.batch_id=b.id and jsonb_array_length(x.blockers)=0
    and public.club_import_mapped_value(x.raw_values,b.mapping,'householdReference',array['shared_contract_id','household_reference']) is null) then
    raise exception 'Import shared contracts in a separate reviewed CSV from individual memberships' using errcode='22023';
  end if;
  update public.club_member_import_batches set status='importing',import_started_at=coalesce(import_started_at,now()) where id=b.id;
  for r in select * from public.club_member_import_rows where batch_id=b.id and jsonb_array_length(blockers)=0 order by source_row_number for update loop
    u:=r.matched_user_id; ref:=r.normalized_values->>'legacyReference'; c:=null;
    if r.imported_customer_id is not null then select * into c from public.club_customers where id=r.imported_customer_id and organisation_id=p_organisation_id for update; end if;
    if c.id is null then
      insert into public.club_customers(organisation_id,user_id,display_name,email,phone,status)
      values(p_organisation_id,u,coalesce(nullif(r.normalized_values->>'fullName',''),nullif(concat_ws(' ',r.normalized_values->>'firstName',r.normalized_values->>'lastName'),''),'Imported member'),r.normalized_values->>'email',r.normalized_values->>'phone','member') returning * into c; made:=made+1;
    else linked:=linked+1; if c.user_id is null and u is not null then update public.club_customers set user_id=u,updated_at=now() where id=c.id and user_id is null returning * into c; end if; end if;
    if u is not null then insert into public.club_members(organisation_id,user_id,role,active) values(p_organisation_id,u,'member',true) on conflict(organisation_id,user_id) do nothing; end if;
    if ref is not null then
      insert into public.club_member_import_identities(organisation_id,source_system,source_member_reference,customer_id,first_seen_batch_id)
      values(p_organisation_id,'clubmanager',ref,c.id,b.id)
      on conflict(organisation_id,source_system,source_member_reference) do update set customer_id=excluded.customer_id where club_member_import_identities.customer_id=excluded.customer_id;
      if exists(select 1 from public.club_access_credentials where organisation_id=p_organisation_id and credential_hash=extensions.digest(lower(btrim(ref)),'sha256') and customer_id<>c.id) then raise exception 'Credential is already assigned to another member' using errcode='23505'; end if;
      insert into public.club_access_credentials(organisation_id,customer_id,credential_type,credential_hash,display_suffix)
      values(p_organisation_id,c.id,'legacy_member_reference',extensions.digest(lower(btrim(ref)),'sha256'),right(ref,4)) on conflict(organisation_id,credential_hash) do nothing;
    end if;
    update public.club_member_import_rows set imported_customer_id=c.id,updated_at=now() where id=r.id;
  end loop;

  for group_row in select public.club_import_mapped_value(x.raw_values,b.mapping,'householdReference',array['shared_contract_id','household_reference']) household_reference,count(*) holder_count
    from public.club_member_import_rows x where x.batch_id=b.id and jsonb_array_length(x.blockers)=0 group by 1 order by 1 loop
    household_ref:=group_row.household_reference;
    if group_row.holder_count<2 then raise exception 'Shared contract % must include at least two covered people',household_ref using errcode='22023'; end if;
    select pm.club_product_id,p.name into product,product_name from public.club_member_import_rows x
      join public.club_member_import_package_mappings pm on pm.batch_id=b.id and lower(pm.source_package)=lower(x.normalized_values->>'membershipName') and pm.status='mapped'
      join public.club_products p on p.id=pm.club_product_id and p.organisation_id=p_organisation_id
      where x.batch_id=b.id and public.club_import_mapped_value(x.raw_values,b.mapping,'householdReference',array['shared_contract_id','household_reference'])=household_ref limit 1;
    if product_name not in ('Unlimited Gym Couple','Family Membership') then raise exception 'Shared contract % must map to Couple or Family Membership',household_ref using errcode='22023'; end if;
    if product_name='Unlimited Gym Couple' and group_row.holder_count<>2 then raise exception 'Couples memberships require exactly two covered people' using errcode='22023'; end if;
    if exists(select 1 from public.club_member_import_rows x join public.club_member_import_package_mappings pm on pm.batch_id=b.id and lower(pm.source_package)=lower(x.normalized_values->>'membershipName') and pm.status='mapped'
      where x.batch_id=b.id and public.club_import_mapped_value(x.raw_values,b.mapping,'householdReference',array['shared_contract_id','household_reference'])=household_ref and pm.club_product_id<>product) then raise exception 'Shared contract % has inconsistent products',household_ref using errcode='22023'; end if;
    select min(coalesce((x.normalized_values->>'startDate')::date::timestamptz,b.created_at)),max(case when x.normalized_values->>'endDate' is null then null else (x.normalized_values->>'endDate')::date::timestamptz+interval '1 day' end),
      min(coalesce(x.normalized_values->>'membershipStatus','expired')) into start_at,end_at,status_value
    from public.club_member_import_rows x where x.batch_id=b.id and public.club_import_mapped_value(x.raw_values,b.mapping,'householdReference',array['shared_contract_id','household_reference'])=household_ref;
    if (select count(distinct coalesce(x.normalized_values->>'membershipStatus','expired')) from public.club_member_import_rows x where x.batch_id=b.id and public.club_import_mapped_value(x.raw_values,b.mapping,'householdReference',array['shared_contract_id','household_reference'])=household_ref)>1 then raise exception 'Shared contract % has inconsistent membership status',household_ref using errcode='22023'; end if;
    insert into public.club_memberships(organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key,import_batch_id,migration_metadata)
    values(p_organisation_id,product,status_value,start_at,end_at,'legacy_import','shared-member-import:'||b.id::text||':'||household_ref,b.id,
      jsonb_build_object('source_system','clubmanager','shared_contract_reference',household_ref,'billing_evidence','imported_unreconciled')) returning * into membership;
    payer_ref:=public.club_import_mapped_value((select x.raw_values from public.club_member_import_rows x where x.batch_id=b.id and public.club_import_mapped_value(x.raw_values,b.mapping,'householdReference',array['shared_contract_id','household_reference'])=household_ref order by x.source_row_number limit 1),b.mapping,'responsiblePayerReference',array['responsible_payer_member_id','payer_member_id']);
    select c.* into payer from public.club_member_import_rows x join public.club_customers c on c.id=x.imported_customer_id and c.organisation_id=x.organisation_id
      where x.batch_id=b.id and x.normalized_values->>'legacyReference'=payer_ref and public.club_import_mapped_value(x.raw_values,b.mapping,'householdReference',array['shared_contract_id','household_reference'])=household_ref limit 1;
    if payer.id is null then raise exception 'Shared contract % responsible payer must be one of its covered imported people',household_ref using errcode='22023'; end if;
    for r in select * from public.club_member_import_rows x where x.batch_id=b.id and public.club_import_mapped_value(x.raw_values,b.mapping,'householdReference',array['shared_contract_id','household_reference'])=household_ref order by x.source_row_number loop
      role_value:=lower(coalesce(public.club_import_mapped_value(r.raw_values,b.mapping,'householdRole',array['covered_person_role','household_role']),'other'));
      if role_value not in ('adult','child','other') then raise exception 'Covered person role must be adult, child or other' using errcode='22023'; end if;
      select * into c from public.club_customers where id=r.imported_customer_id;
      insert into public.club_membership_holders(membership_id,organisation_id,user_id,customer_id,coverage_role)
      values(membership.id,p_organisation_id,c.user_id,case when c.user_id is null then c.id else null end,role_value);
      if c.user_id is not null then insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
        select c.user_id,p_organisation_id,membership.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,start_at,end_at,'legacy_import'
        from public.club_product_entitlements e where e.product_id=product and status_value='active' on conflict do nothing; end if;
      update public.club_member_import_rows set imported_membership_id=membership.id,outcome=case when action='exact_match' then 'linked' else 'imported' end,updated_at=now() where id=r.id;
    end loop;
    select public.club_import_mapped_value(x.raw_values,b.mapping,'nextPaymentDate',array['next_payment_date'])::date,
      public.club_import_mapped_value(x.raw_values,b.mapping,'paidThroughDate',array['paid_through_date'])::date,
      round(public.club_import_mapped_value(x.raw_values,b.mapping,'billingAmount',array['recurring_amount'])::numeric*100)::integer,
      lower(public.club_import_mapped_value(x.raw_values,b.mapping,'billingMethod',array['payment_method','billing_method'])),
      public.club_import_mapped_value(x.raw_values,b.mapping,'providerCustomerReference',array['provider_customer_reference']),
      public.club_import_mapped_value(x.raw_values,b.mapping,'providerSubscriptionReference',array['provider_subscription_reference','mandate_reference'])
    into next_due,paid_through,amount_minor,method,provider_customer,provider_subscription
    from public.club_member_import_rows x where x.batch_id=b.id and public.club_import_mapped_value(x.raw_values,b.mapping,'householdReference',array['shared_contract_id','household_reference'])=household_ref order by x.source_row_number limit 1;
    if next_due is null or amount_minor is null or amount_minor<=0 then raise exception 'Shared contract % needs a renewal date and positive recurring amount',household_ref using errcode='22023'; end if;
    method:=case when method like '%cash%' then 'cash' when method like '%card%' or method like '%stripe%' then 'recurring_card' when method like '%direct%' or method like '%gocardless%' then 'direct_debit' else 'other' end;
    provider_type:=case when method='direct_debit' then 'gocardless' when method='recurring_card' then 'stripe' else null end;
    insert into public.club_membership_shared_contracts(membership_id,organisation_id,external_contract_reference,arrangement_kind,default_composition,responsible_payer_customer_id,imported,paid_through_date,provider_reconciliation_state)
    values(membership.id,p_organisation_id,household_ref,case when product_name='Unlimited Gym Couple' then 'couple' else 'family' end,case when product_name='Family Membership' then 'existing_contract' else null end,payer.id,true,paid_through,'pending');
    insert into public.club_membership_billing_arrangements(organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,provider_customer_reference,provider_subscription_reference,amount_minor,currency,frequency,next_due_at,state,billing_anchor_day,schedule_source,anniversary_established_at)
    values(p_organisation_id,membership.id,payer.user_id,payer.id,provider_type,method,provider_customer,provider_subscription,amount_minor,'GBP','monthly',next_due::timestamptz,'active',extract(day from next_due)::integer,'imported_contract',start_at) returning id into arrangement_id;
    insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,provider_customer_reference,provider_subscription_reference,amount_minor,currency,frequency,next_due_at,period_key,state,coverage_start_at,coverage_end_at)
    values(p_organisation_id,arrangement_id,membership.id,payer.user_id,payer.id,provider_type,method,provider_customer,provider_subscription,amount_minor,'GBP','monthly',next_due::timestamptz,to_char(next_due,'YYYY-MM-DD'),'upcoming',case when paid_through is null then null else (paid_through-interval '1 month'+interval '1 day')::date end,paid_through);
  end loop;
  update public.club_member_import_rows set outcome='rejected' where batch_id=b.id and jsonb_array_length(blockers)>0 and outcome is null;
  update public.club_member_import_batches set status='completed',completed_at=now(),imported_count=made,linked_count=linked,rejected_count=(select count(*) from public.club_member_import_rows where batch_id=b.id and outcome='rejected'),failed_count=failed,updated_at=now() where id=b.id;
  insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),'member_import.shared_completed','member_import_batch',b.id,jsonb_build_object('imported',made,'linked',linked));
  return public.club_list_member_import_batch(p_organisation_id,b.id);
end $$;

create or replace function public.club_reconcile_imported_shared_contract(p_organisation_id uuid,p_membership_id uuid,p_state text,p_note text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare contract public.club_membership_shared_contracts%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then raise exception 'Billing reconciliation is not permitted' using errcode='42501'; end if;
  if p_state not in ('reconciled','mismatch') or char_length(btrim(coalesce(p_note,''))) not between 3 and 500 then raise exception 'A reconciliation outcome and evidence note are required' using errcode='22023'; end if;
  update public.club_membership_shared_contracts set provider_reconciliation_state=p_state,reconciliation_note=btrim(p_note),reconciled_by=auth.uid(),reconciled_at=now(),updated_at=now()
  where organisation_id=p_organisation_id and membership_id=p_membership_id and imported returning * into contract;
  if not found then raise exception 'Imported shared contract not found' using errcode='P0002'; end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata)
  values(p_organisation_id,auth.uid(),'membership.shared_billing_reconciled','membership',p_membership_id,jsonb_build_object('outcome',p_state,'note',btrim(p_note)));
  return to_jsonb(contract);
end $$;

create or replace function public.club_establish_membership_anniversary() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_membership_billing_arrangements%rowtype; o public.club_membership_billing_obligations%rowtype;
begin
  select * into o from public.club_membership_billing_obligations where id=new.obligation_id;
  select * into a from public.club_membership_billing_arrangements where id=o.arrangement_id for update;
  if a.frequency='monthly' and a.schedule_source='first_successful_payment' and a.anniversary_established_at is null then
    update public.club_membership_billing_arrangements set anniversary_established_at=new.occurred_at,billing_anchor_day=extract(day from new.occurred_at at time zone 'UTC')::integer,updated_at=now() where id=a.id;
    update public.club_memberships set starts_at=new.occurred_at where id=a.membership_id and organisation_id=a.organisation_id and source<>'legacy_import';
  end if;
  return new;
end $$;
drop trigger if exists club_establish_membership_anniversary on public.club_membership_billing_payments;
create trigger club_establish_membership_anniversary after insert on public.club_membership_billing_payments for each row execute function public.club_establish_membership_anniversary();

create or replace function public.club_initialise_membership_anniversary() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  if new.frequency='monthly' and new.schedule_source='first_successful_payment' and new.anniversary_established_at is null and new.last_successful_payment_at is not null then
    new.anniversary_established_at:=new.last_successful_payment_at;
    new.billing_anchor_day:=extract(day from new.last_successful_payment_at at time zone 'UTC')::integer;
  end if;
  return new;
end $$;
drop trigger if exists club_initialise_membership_anniversary on public.club_membership_billing_arrangements;
create trigger club_initialise_membership_anniversary before insert or update of last_successful_payment_at,schedule_source on public.club_membership_billing_arrangements
for each row execute function public.club_initialise_membership_anniversary();

create or replace function public.club_get_membership_household(p_organisation_id uuid,p_membership_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.view') then raise exception 'Member relationships are not available' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('customerId',c.id,'displayName',c.display_name,'coverageRole',coalesce(h.coverage_role,'other'),
    'billingContact',exists(select 1 from public.club_membership_billing_arrangements a where a.organisation_id=p_organisation_id and a.membership_id=p_membership_id and (a.user_id=c.user_id or a.customer_id=c.id))) order by c.display_name)
    from public.club_membership_holders h join public.club_customers c on c.organisation_id=h.organisation_id and (c.id=h.customer_id or c.user_id=h.user_id)
    where h.organisation_id=p_organisation_id and h.membership_id=p_membership_id),'[]'::jsonb);
end $$;

create or replace function public.club_set_membership_household_member(p_organisation_id uuid,p_membership_id uuid,p_customer_id uuid,p_action text,p_reason text,p_coverage_role text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.club_memberships%rowtype; c public.club_customers%rowtype; h public.club_membership_holders%rowtype; holder_count integer; shared boolean;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.assign') then raise exception 'Membership household updates are not permitted' using errcode='42501'; end if;
  if p_action not in ('add','remove') or nullif(btrim(p_reason),'') is null or char_length(btrim(p_reason)) not between 3 and 500 or p_coverage_role not in ('adult','child','other') then raise exception 'Choose an action, covered-person role and short reason' using errcode='22023'; end if;
  select * into m from public.club_memberships where id=p_membership_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Membership not found' using errcode='P0002'; end if;
  select coalesce(r.shared_membership,false) into shared from public.club_membership_product_rules r where r.product_id=m.product_id and r.organisation_id=m.organisation_id;
  if not coalesce(shared,false) then raise exception 'Household controls are only available for shared memberships' using errcode='22023'; end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id for share;
  if not found then raise exception 'Family member is not in this organisation' using errcode='P0002'; end if;
  select * into h from public.club_membership_holders x where x.membership_id=m.id and x.organisation_id=p_organisation_id and (x.customer_id=c.id or (c.user_id is not null and x.user_id=c.user_id)) limit 1 for update;
  if p_action='add' then
    if found then raise exception 'This person is already on the membership' using errcode='23505'; end if;
    insert into public.club_membership_holders(id,membership_id,organisation_id,user_id,customer_id,coverage_role)
    values(gen_random_uuid(),m.id,p_organisation_id,c.user_id,case when c.user_id is null then c.id else null end,p_coverage_role);
    if c.user_id is not null then
      insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
      select c.user_id,m.organisation_id,m.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,m.starts_at,m.ends_at,m.source
      from public.club_product_entitlements e where e.product_id=m.product_id
        and not exists(select 1 from public.club_entitlement_grants g where g.membership_id=m.id and g.user_id=c.user_id and g.entitlement_key=e.entitlement_key);
    end if;
  else
    if not found then raise exception 'This person is not on the membership' using errcode='P0002'; end if;
    select count(*) into holder_count from public.club_membership_holders where membership_id=m.id and organisation_id=p_organisation_id;
    if holder_count<=1 then raise exception 'A membership must keep at least one holder' using errcode='22023'; end if;
    if exists(select 1 from public.club_membership_billing_arrangements a where a.organisation_id=p_organisation_id and a.membership_id=m.id and (a.customer_id=c.id or a.user_id=c.user_id)) then raise exception 'This person is the recorded billing contact. Resolve billing ownership before removing them.' using errcode='22023'; end if;
    delete from public.club_membership_holders where id=h.id;
  end if;
  insert into public.club_membership_household_events(organisation_id,membership_id,customer_id,actor_user_id,action,reason) values(p_organisation_id,m.id,c.id,auth.uid(),case when p_action='add' then 'added' else 'removed' end,btrim(p_reason));
  return jsonb_build_object('membership_id',m.id,'customer_id',c.id,'action',p_action,'coverage_role',p_coverage_role);
end $$;

-- Payment suspension follows the shared membership, not only its payer. A
-- separately valid unsuspended gym entitlement or explicit override still wins.
create or replace function public.club_check_member_location_access(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare base jsonb; induction jsonb; blocked boolean:=false;
begin
  if auth.uid() is null or (auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner'])) then raise exception 'Location eligibility is not permitted' using errcode='42501'; end if;
  select exists(select 1 from public.club_membership_payment_access_suspensions s
    join public.club_membership_holders h on h.membership_id=s.membership_id and h.organisation_id=s.organisation_id and h.user_id=p_user_id
    where s.organisation_id=p_organisation_id and s.active)
    and not exists(select 1 from public.club_entitlement_grants g
      where g.organisation_id=p_organisation_id and g.user_id=p_user_id and g.entitlement_key='gym_access'
        and g.starts_at<=p_at and (g.ends_at is null or g.ends_at>p_at)
        and (g.membership_id is null or not exists(select 1 from public.club_membership_payment_access_suspensions s where s.organisation_id=p_organisation_id and s.membership_id=g.membership_id and s.active))
        and (g.scope='future_locations' or (g.scope='organisation' and (coalesce(cardinality(g.location_ids),0)=0 or p_location_id=any(g.location_ids))) or (g.scope='locations' and p_location_id=any(g.location_ids)))) into blocked;
  if blocked then return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','payment_overdue'); end if;
  base:=public.club_check_member_location_access_base(p_organisation_id,p_user_id,p_location_id,p_at);
  if base->>'allowed'<>'true' then return base; end if;
  induction:=public.club_get_member_induction_state(p_organisation_id,p_user_id,p_location_id,p_at);
  if induction->'state'->>'access_effect'='hold' then return base||jsonb_build_object('allowed',false,'reason','induction_overdue','induction',induction->'state'); end if;
  return base||jsonb_build_object('induction',induction->'state');
end $$;

revoke all on function public.club_set_membership_household_member(uuid,uuid,uuid,text,text) from public,anon,authenticated;
drop function public.club_set_membership_household_member(uuid,uuid,uuid,text,text);

revoke all on function public.club_execute_member_import_batch_individual_base(uuid,uuid),public.club_import_mapped_value(jsonb,jsonb,text,text[]),public.club_add_billing_working_days(uuid,timestamptz,integer),public.club_membership_grace_expires_at(uuid,text,timestamptz),public.club_establish_membership_anniversary(),public.club_initialise_membership_anniversary(),public.club_record_membership_billing_state(),public.club_apply_membership_provider_state() from public,anon,authenticated;
revoke all on function public.club_execute_member_import_batch(uuid,uuid),public.club_set_membership_household_member(uuid,uuid,uuid,text,text,text),public.club_get_membership_household(uuid,uuid),public.club_evaluate_membership_billing(uuid,timestamptz),public.club_reconcile_imported_shared_contract(uuid,uuid,text,text) from public,anon;
grant execute on function public.club_execute_member_import_batch(uuid,uuid),public.club_set_membership_household_member(uuid,uuid,uuid,text,text,text),public.club_get_membership_household(uuid,uuid),public.club_evaluate_membership_billing(uuid,timestamptz),public.club_reconcile_imported_shared_contract(uuid,uuid,text,text) to authenticated;
revoke all on function public.club_check_member_location_access(uuid,uuid,uuid,timestamptz) from public,anon;
grant execute on function public.club_check_member_location_access(uuid,uuid,uuid,timestamptz) to authenticated;

comment on table public.club_membership_shared_contracts is 'One Couple/Family contract, responsible payer and provider-reconciliation state; covered people retain separate identities.';
comment on column public.club_membership_billing_obligations.grace_expires_at is 'Three configured working days for card/direct debit; seven calendar days for cash.';
commit;
