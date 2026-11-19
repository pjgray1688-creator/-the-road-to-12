-- Audited staff operations for existing member records. This migration adds
-- secure projections and management RPCs; it does not alter Auth identities,
-- provider subscriptions, imported customer links, or household payer links.
begin;

do $$
begin
  if to_regclass('public.club_customers') is null
    or to_regclass('public.club_memberships') is null
    or to_regclass('public.club_membership_counter_payments') is null
    or to_regclass('public.club_entitlement_grants') is null
    or to_regclass('public.club_product_entitlements') is null
    or to_regclass('public.club_audit_events') is null
    or to_regprocedure('public.club_capability_allowed(uuid,uuid,text)') is null then
    raise exception 'Member operations prerequisites are missing; no changes applied';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_customers' and column_name='date_of_birth')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_customers' and column_name='address_line_1')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_customers' and column_name='preferred_location_id')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_membership_counter_payments' and column_name='verified_by') then
    raise exception 'Member operations schema signatures do not match; no changes applied';
  end if;
end $$;

alter table public.club_membership_counter_payments
  add column if not exists billing_period_start date,
  add column if not exists billing_period_end date,
  add column if not exists paid_through_date date;

create or replace function public.club_get_customer_profile_details(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.create') then
    raise exception 'Member profile is not available' using errcode='42501';
  end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id;
  if not found then raise exception 'Member profile is not available' using errcode='P0002'; end if;
  return jsonb_build_object('id',c.id,'display_name',c.display_name,'email',c.email,'phone',c.phone,
    'address_line_1',c.address_line_1,'address_line_2',c.address_line_2,'town_city',c.town_city,
    'postcode',c.postcode,'date_of_birth',c.date_of_birth,'preferred_location_id',c.preferred_location_id,
    'user_id',c.user_id);
end $$;
revoke all on function public.club_get_customer_profile_details(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_get_customer_profile_details(uuid,uuid) to authenticated;

create or replace function public.club_update_customer_profile_details(
  p_organisation_id uuid,p_customer_id uuid,p_display_name text,p_email text,p_phone text,
  p_address_line_1 text,p_address_line_2 text,p_town_city text,p_postcode text,
  p_date_of_birth date,p_home_location_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; actor_role text; changed text[]:=array[]::text[]; email_value text:=nullif(btrim(p_email),'');
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.create') then
    raise exception 'Member profile editing is not permitted' using errcode='42501';
  end if;
  if nullif(btrim(p_display_name),'') is null or char_length(btrim(p_display_name))>160
    or char_length(coalesce(p_phone,''))>40 or char_length(coalesce(p_address_line_1,''))>160
    or char_length(coalesce(p_address_line_2,''))>160 or char_length(coalesce(p_town_city,''))>100
    or char_length(coalesce(p_postcode,''))>20 or (email_value is not null and (char_length(email_value)>254 or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    or (p_date_of_birth is not null and (p_date_of_birth<'1900-01-01'::date or p_date_of_birth>=current_date))
    or nullif(btrim(p_reason),'') is null or char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'Enter valid profile details and a short change reason' using errcode='22023';
  end if;
  if p_home_location_id is not null and not exists(select 1 from public.club_locations where id=p_home_location_id and organisation_id=p_organisation_id and active) then
    raise exception 'Home gym must be an active venue in this organisation' using errcode='22023';
  end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Member profile is not available' using errcode='P0002'; end if;
  if c.display_name is distinct from btrim(p_display_name) then changed:=array_append(changed,'display_name'); end if;
  if c.email is distinct from email_value then changed:=array_append(changed,'contact_email'); end if;
  if c.phone is distinct from nullif(btrim(p_phone),'') then changed:=array_append(changed,'phone'); end if;
  if c.address_line_1 is distinct from nullif(btrim(p_address_line_1),'') then changed:=array_append(changed,'address_line_1'); end if;
  if c.address_line_2 is distinct from nullif(btrim(p_address_line_2),'') then changed:=array_append(changed,'address_line_2'); end if;
  if c.town_city is distinct from nullif(btrim(p_town_city),'') then changed:=array_append(changed,'town_city'); end if;
  if c.postcode is distinct from nullif(upper(btrim(p_postcode)),'') then changed:=array_append(changed,'postcode'); end if;
  if c.date_of_birth is distinct from p_date_of_birth then changed:=array_append(changed,'date_of_birth'); end if;
  if c.preferred_location_id is distinct from p_home_location_id then changed:=array_append(changed,'home_gym'); end if;
  update public.club_customers set display_name=btrim(p_display_name),email=email_value,phone=nullif(btrim(p_phone),''),
    address_line_1=nullif(btrim(p_address_line_1),''),address_line_2=nullif(btrim(p_address_line_2),''),
    town_city=nullif(btrim(p_town_city),''),postcode=nullif(upper(btrim(p_postcode)),''),date_of_birth=p_date_of_birth,
    preferred_location_id=p_home_location_id,updated_at=now()
  where id=c.id and organisation_id=p_organisation_id returning * into c;
  if c.user_id is not null and c.preferred_location_id is not null then
    update public.club_members set preferred_location_id=c.preferred_location_id
      where organisation_id=p_organisation_id and user_id=c.user_id;
  end if;
  if cardinality(changed)>0 then
    select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
    insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,reason,metadata)
    values(p_organisation_id,auth.uid(),actor_role,'member.profile_updated','customer',c.id,btrim(p_reason),jsonb_build_object('changed_fields',to_jsonb(changed),'auth_identity_changed',false,'glow_age_verification_changed',false));
  end if;
  return jsonb_build_object('id',c.id,'display_name',c.display_name,'email',c.email,'phone',c.phone,
    'address_line_1',c.address_line_1,'address_line_2',c.address_line_2,'town_city',c.town_city,
    'postcode',c.postcode,'date_of_birth',c.date_of_birth,'preferred_location_id',c.preferred_location_id,'user_id',c.user_id);
end $$;
revoke all on function public.club_update_customer_profile_details(uuid,uuid,text,text,text,text,text,text,text,date,uuid,text) from public,anon,authenticated;
grant execute on function public.club_update_customer_profile_details(uuid,uuid,text,text,text,text,text,text,text,date,uuid,text) to authenticated;

create or replace function public.club_get_membership_management_detail(p_organisation_id uuid,p_membership_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare m public.club_memberships%rowtype; p public.club_products%rowtype; arrangement jsonb; history jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.manage') then
    raise exception 'Membership management is not permitted' using errcode='42501';
  end if;
  select * into m from public.club_memberships where id=p_membership_id and organisation_id=p_organisation_id;
  if not found then raise exception 'Membership is not available' using errcode='P0002'; end if;
  select * into p from public.club_products where id=m.product_id and organisation_id=p_organisation_id;
  select to_jsonb(a) - 'provider_customer_reference' into arrangement
    from public.club_membership_billing_arrangements a where a.membership_id=m.id and a.organisation_id=p_organisation_id
    order by a.created_at desc limit 1;
  select coalesce(jsonb_agg(x.item order by x.occurred_at desc),'[]'::jsonb) into history from (
    select jsonb_build_object('id',cp.id,'kind','counter','method',cp.method,'state',cp.state,'amount_minor',cp.amount_minor,'currency',cp.currency,'payment_received_at',cp.payment_received_at,'external_reference',cp.external_reference,'billing_period_start',cp.billing_period_start,'billing_period_end',cp.billing_period_end,'paid_through_date',cp.paid_through_date,'recorded_by',cp.initiated_by,'verified_by',cp.verified_by,'verified_at',cp.verified_at,'evidence_note',cp.evidence_note) item,cp.payment_received_at occurred_at
      from public.club_membership_counter_payments cp where cp.organisation_id=p_organisation_id and cp.membership_id=m.id
    union all
    select jsonb_build_object('id',pay.id,'kind','billing','method',o.payment_method_family,'state',o.state,'amount_minor',pay.amount_minor,'currency',pay.currency,'payment_received_at',coalesce(pay.receipt_date::timestamptz,pay.occurred_at),'external_reference',pay.provider_reference,'billing_period_start',pay.billing_period_start,'billing_period_end',pay.billing_period_end,'paid_through_date',pay.paid_through_date,'recorded_by',pay.recorded_by,'verified_by',null,'verified_at',null,'evidence_note',pay.verification_note) item,coalesce(pay.occurred_at,pay.created_at) occurred_at
      from public.club_membership_billing_obligations o join public.club_membership_billing_payments pay on pay.obligation_id=o.id and pay.organisation_id=o.organisation_id
      where o.organisation_id=p_organisation_id and o.membership_id=m.id
  ) x;
  return jsonb_build_object('id',m.id,'product_id',m.product_id,'product_name',p.name,'product_kind',p.kind,'billing',p.billing,
    'is_lifetime',p.is_lifetime,'status',m.status,'starts_at',m.starts_at,'ends_at',m.ends_at,'source',m.source,
    'migration_metadata',m.migration_metadata,'billing_arrangement',arrangement,'payments',history,
    'shared_contract',exists(select 1 from public.club_membership_shared_contracts s where s.membership_id=m.id and s.organisation_id=p_organisation_id),
    'has_billing_obligation',exists(select 1 from public.club_membership_billing_obligations o where o.membership_id=m.id and o.organisation_id=p_organisation_id));
end $$;
revoke all on function public.club_get_membership_management_detail(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_get_membership_management_detail(uuid,uuid) to authenticated;

create or replace function public.club_update_manual_membership(
  p_organisation_id uuid,p_membership_id uuid,p_product_id uuid,p_status text,p_starts_on date,p_ends_on date,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.club_memberships%rowtype; old_product uuid; old_status text; p public.club_products%rowtype; actor_role text; old_ends timestamptz; new_ends timestamptz; changed_product boolean;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.manage') then
    raise exception 'Membership management is not permitted' using errcode='42501';
  end if;
  if p_status not in ('active','paused','expired') or p_starts_on is null or nullif(btrim(p_reason),'') is null or char_length(btrim(p_reason)) not between 8 and 500 then
    raise exception 'Choose a valid status and membership dates, and record a reason' using errcode='22023';
  end if;
  select * into m from public.club_memberships where id=p_membership_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Membership is not available' using errcode='P0002'; end if;
  if m.status='cancelled' or m.ended_at is not null then raise exception 'Cancelled or ended membership requires a separate reviewed process' using errcode='22023'; end if;
  if m.source not in ('legacy_import','staff_assignment','manual') then raise exception 'This membership source is not editable here' using errcode='22023'; end if;
  if exists(select 1 from public.club_membership_billing_arrangements a where a.membership_id=m.id and a.organisation_id=p_organisation_id)
    or exists(select 1 from public.club_membership_billing_obligations o where o.membership_id=m.id and o.organisation_id=p_organisation_id) then
    raise exception 'A billing record controls this membership; manage it through its verified payment record' using errcode='55000';
  end if;
  if exists(select 1 from public.club_membership_shared_contracts s where s.membership_id=m.id and s.organisation_id=p_organisation_id) then
    raise exception 'This membership belongs to a shared payer contract; manage its coverage through the contract record' using errcode='55000';
  end if;
  select * into p from public.club_products where id=p_product_id and organisation_id=p_organisation_id for share;
  if not found or p.kind<>'membership' or ((p.archived_at is not null or p.legacy_import_category is not null) and p.id is distinct from m.product_id) then
    raise exception 'Choose a current membership product; an existing historic product may be retained but not newly assigned' using errcode='22023';
  end if;
  if p_starts_on>current_date and p_status='active' then raise exception 'A future membership cannot be active yet' using errcode='22023'; end if;
  if p_status='active' and p_ends_on is not null and p_ends_on<current_date and not p.is_lifetime then raise exception 'An expired membership cannot be marked active' using errcode='22023'; end if;
  if p.is_lifetime then new_ends:=null;
  elsif p_ends_on is null or p_ends_on<p_starts_on then raise exception 'A valid end date is required for this membership product' using errcode='22023';
  else new_ends:=(p_ends_on+1)::timestamp at time zone 'Europe/London'; end if;
  changed_product:=m.product_id is distinct from p.id;
  if changed_product and exists(select 1 from public.club_entitlement_usage u join public.club_entitlement_grants g on g.id=u.grant_id where g.membership_id=m.id and g.organisation_id=p_organisation_id) then
    raise exception 'This membership has recorded entitlement use; its product cannot be changed here' using errcode='55000';
  end if;
  old_product:=m.product_id; old_status:=m.status; old_ends:=m.ends_at;
  if changed_product then delete from public.club_entitlement_grants where membership_id=m.id and organisation_id=p_organisation_id; end if;
  update public.club_memberships set product_id=p.id,status=p_status,starts_at=(p_starts_on::timestamp at time zone 'Europe/London'),ends_at=new_ends,updated_at=now()
    where id=m.id and organisation_id=p_organisation_id returning * into m;
  if not changed_product then
    update public.club_entitlement_grants set starts_at=m.starts_at,ends_at=m.ends_at
      where membership_id=m.id and organisation_id=p_organisation_id;
  end if;
  if m.status='active' then
    insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,
      allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
    select c.user_id,p_organisation_id,m.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,
      e.discount_percent,e.discount_period,e.discount_max_uses,m.starts_at,m.ends_at,m.source
    from public.club_membership_holders h
    join public.club_customers c on c.organisation_id=h.organisation_id and (c.id=h.customer_id or c.user_id=h.user_id)
    join public.club_members cm on cm.organisation_id=p_organisation_id and cm.user_id=c.user_id and cm.active
    join auth.users u on u.id=c.user_id and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
    join public.club_product_entitlements e on e.product_id=m.product_id and e.organisation_id=p_organisation_id
    where h.membership_id=m.id and h.organisation_id=p_organisation_id and c.user_id is not null
      and not exists(select 1 from public.club_entitlement_grants old where old.user_id=c.user_id and old.organisation_id=p_organisation_id
        and old.membership_id=m.id and old.entitlement_key=e.entitlement_key);
  end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,reason,metadata)
  values(p_organisation_id,auth.uid(),actor_role,'membership.manually_updated','membership',m.id,btrim(p_reason),
    jsonb_build_object('previous_product_id',old_product,'product_id',m.product_id,'previous_status',old_status,'new_status',p_status,'previous_ends_at',old_ends,'new_ends_at',m.ends_at,'provider_authority_changed',false));
  return jsonb_build_object('id',m.id,'product_id',m.product_id,'status',m.status,'starts_at',m.starts_at,'ends_at',m.ends_at);
end $$;
revoke all on function public.club_update_manual_membership(uuid,uuid,uuid,text,date,date,text) from public,anon,authenticated;
grant execute on function public.club_update_manual_membership(uuid,uuid,uuid,text,date,date,text) to authenticated;

create or replace function public.club_record_existing_membership_cash_payment(
  p_organisation_id uuid,p_customer_id uuid,p_membership_id uuid,p_location_id uuid,p_amount_minor integer,
  p_receipt_date date,p_period_start date,p_period_end date,p_paid_through date,p_note text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.club_memberships%rowtype; p public.club_products%rowtype; pay public.club_membership_counter_payments%rowtype; actor_role text; received_at timestamptz; start_at timestamptz; paid_end timestamptz;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.manage')
    or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.record_cash') then
    raise exception 'Membership cash recording is not permitted' using errcode='42501';
  end if;
  if not exists(select 1 from public.club_members me where me.organisation_id=p_organisation_id and me.user_id=auth.uid() and me.active and me.role in ('owner','gym_admin')) then
    raise exception 'Only authorised management may record this membership cash payment' using errcode='42501';
  end if;
  if p_amount_minor is null or p_amount_minor<=0 or p_receipt_date is null or p_receipt_date>current_date
    or p_period_start is null or p_period_end is null or p_period_end<p_period_start or p_paid_through is null or p_paid_through<>p_period_end
    or nullif(btrim(p_note),'') is null or char_length(btrim(p_note)) not between 8 and 500
    or nullif(btrim(p_idempotency_key),'') is null or char_length(btrim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'Enter a valid cash amount, receipt date, matching purchased period and audit note' using errcode='22023';
  end if;
  if not exists(select 1 from public.club_locations l where l.id=p_location_id and l.organisation_id=p_organisation_id and l.active)
    or not public.club_location_authorized(p_organisation_id,p_location_id) then raise exception 'Choose an authorised active venue' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':'||btrim(p_idempotency_key),0));
  select * into pay from public.club_membership_counter_payments where organisation_id=p_organisation_id and idempotency_key=btrim(p_idempotency_key);
  if found then
    if pay.customer_id<>p_customer_id or pay.membership_id<>p_membership_id or pay.location_id<>p_location_id
      or pay.amount_minor<>p_amount_minor or pay.paid_through_date<>p_paid_through
      or pay.billing_period_start<>p_period_start or pay.billing_period_end<>p_period_end
      or (pay.payment_received_at at time zone 'Europe/London')::date<>p_receipt_date
      or pay.evidence_note<>btrim(p_note) then
      raise exception 'This payment retry key is already in use' using errcode='23505';
    end if;
    return jsonb_build_object('payment_id',pay.id,'membership_id',pay.membership_id,'paid_through_date',pay.paid_through_date,'status','already_recorded');
  end if;
  select * into m from public.club_memberships where id=p_membership_id and organisation_id=p_organisation_id for update;
  if not found or not exists(select 1 from public.club_membership_holders h where h.membership_id=m.id and h.organisation_id=p_organisation_id and (h.customer_id=p_customer_id or exists(select 1 from public.club_customers c where c.id=p_customer_id and c.organisation_id=p_organisation_id and c.user_id=h.user_id))) then
    raise exception 'The selected membership does not belong to this customer' using errcode='42501';
  end if;
  if m.status='cancelled' or m.ended_at is not null then raise exception 'Cancelled or ended memberships cannot be reopened by cash recording' using errcode='22023'; end if;
  select * into p from public.club_products where id=m.product_id and organisation_id=p_organisation_id;
  if not found or p.kind<>'membership' or p.is_lifetime or p.legacy_import_category is not null then raise exception 'This product needs a separate reviewed payment process' using errcode='22023'; end if;
  if exists(select 1 from public.club_membership_billing_arrangements a where a.membership_id=m.id and a.organisation_id=p_organisation_id) then
    raise exception 'Membership payments must be recorded against its existing billing arrangement' using errcode='55000';
  end if;
  if exists(select 1 from public.club_membership_shared_contracts s where s.membership_id=m.id and s.organisation_id=p_organisation_id) then
    raise exception 'Record shared-contract payments against the verified payer contract' using errcode='55000';
  end if;
  if exists(select 1 from public.club_membership_billing_obligations o where o.membership_id=m.id and o.organisation_id=p_organisation_id) then
    raise exception 'This membership has a billing schedule; record cash against its existing obligation' using errcode='55000';
  end if;
  if exists(select 1 from public.club_membership_counter_payments prior where prior.organisation_id=p_organisation_id
    and prior.membership_id=m.id and prior.method='cash' and prior.state<>'rejected'
    and prior.billing_period_start<=p_period_end and prior.billing_period_end>=p_period_start) then
    raise exception 'Cash has already been recorded for some or all of this membership period' using errcode='23505';
  end if;
  received_at:=make_timestamptz(extract(year from p_receipt_date)::integer,extract(month from p_receipt_date)::integer,extract(day from p_receipt_date)::integer,12,0,0,'Europe/London');
  start_at:=p_period_start::timestamp at time zone 'Europe/London'; paid_end:=(p_paid_through+1)::timestamp at time zone 'Europe/London';
  if p_period_start>current_date or (m.ends_at is not null and p_period_start<(m.ends_at at time zone 'Europe/London')::date)
    or (m.ends_at is not null and paid_end<m.ends_at) then
    raise exception 'Cash payment must cover a new, non-overlapping period and cannot shorten current paid-through access' using errcode='22023';
  end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  insert into public.club_membership_counter_payments(organisation_id,product_id,customer_id,membership_id,location_id,method,amount_minor,currency,state,reconciliation_state,evidence_note,starts_at,payment_received_at,initiated_by,verified_by,verified_at,verification_note,idempotency_key,billing_period_start,billing_period_end,paid_through_date)
  values(p_organisation_id,m.product_id,p_customer_id,m.id,p_location_id,'cash',p_amount_minor,'GBP','confirmed','verified',btrim(p_note),start_at,received_at,auth.uid(),auth.uid(),now(),btrim(p_note),btrim(p_idempotency_key),p_period_start,p_period_end,p_paid_through)
  returning * into pay;
  update public.club_memberships set status='active',ends_at=paid_end,updated_at=now() where id=m.id and organisation_id=p_organisation_id;
  update public.club_entitlement_grants set ends_at=paid_end where membership_id=m.id and organisation_id=p_organisation_id;
  insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,
    allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
  select c.user_id,p_organisation_id,m.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,
    e.discount_percent,e.discount_period,e.discount_max_uses,m.starts_at,paid_end,m.source
  from public.club_membership_holders h
  join public.club_customers c on c.organisation_id=h.organisation_id and (c.id=h.customer_id or c.user_id=h.user_id)
  join public.club_members cm on cm.organisation_id=p_organisation_id and cm.user_id=c.user_id and cm.active
  join auth.users u on u.id=c.user_id and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
  join public.club_product_entitlements e on e.product_id=m.product_id and e.organisation_id=p_organisation_id
  where h.membership_id=m.id and h.organisation_id=p_organisation_id and c.user_id is not null
    and not exists(select 1 from public.club_entitlement_grants old where old.user_id=c.user_id and old.organisation_id=p_organisation_id
      and old.membership_id=m.id and old.entitlement_key=e.entitlement_key);
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata)
  values(p_organisation_id,auth.uid(),actor_role,'membership.cash_payment_recorded','membership',m.id,p_location_id,btrim(p_note),jsonb_build_object('payment_id',pay.id,'customer_id',p_customer_id,'amount_minor',p_amount_minor,'currency','GBP','receipt_date',p_receipt_date,'billing_period_start',p_period_start,'billing_period_end',p_period_end,'paid_through_date',p_paid_through,'idempotency_key',p_idempotency_key));
  return jsonb_build_object('payment_id',pay.id,'membership_id',m.id,'paid_through_date',p_paid_through,'status','recorded');
end $$;
revoke all on function public.club_record_existing_membership_cash_payment(uuid,uuid,uuid,uuid,integer,date,date,date,date,text,text) from public,anon,authenticated;
grant execute on function public.club_record_existing_membership_cash_payment(uuid,uuid,uuid,uuid,integer,date,date,date,date,text,text) to authenticated;

commit;
