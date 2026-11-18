-- Configurable non-recurring membership terms and audited staff assignment.
-- No members, payments, mandates, subscriptions or entitlements are created here.
begin;

alter table public.club_products
  add column if not exists fixed_term_value integer,
  add column if not exists fixed_term_unit text;

do $constraints$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.club_products'::regclass and conname='club_products_fixed_term_pair_check') then
    alter table public.club_products add constraint club_products_fixed_term_pair_check
      check ((fixed_term_value is null and fixed_term_unit is null) or
        (fixed_term_value is not null and fixed_term_unit is not null and fixed_term_value between 1 and 1200 and fixed_term_unit in ('day','week','month') and kind='membership' and billing='one_off' and not is_lifetime and legacy_import_category is null));
  end if;
end;
$constraints$;

create or replace function public.club_fixed_term_end(p_starts_at timestamptz,p_value integer,p_unit text)
returns timestamptz language plpgsql stable set search_path=pg_catalog as $$
declare local_start timestamp; local_end timestamp;
begin
  if p_starts_at is null or p_value is null or p_value not between 1 and 1200 or p_unit is null or p_unit not in ('day','week','month') then
    raise exception 'Invalid fixed membership term' using errcode='22023';
  end if;
  local_start:=p_starts_at at time zone 'Europe/London';
  local_end:=case p_unit
    when 'day' then local_start + make_interval(days=>p_value)
    when 'week' then local_start + make_interval(days=>p_value*7)
    when 'month' then local_start + make_interval(months=>p_value)
  end;
  return local_end at time zone 'Europe/London';
end; $$;
revoke all on function public.club_fixed_term_end(timestamptz,integer,text) from public,anon,authenticated;

-- Managers configure one-off products through one atomic RPC. A joining fee is
-- stored in the existing initial-charge ledger; no collection is initiated here.
create or replace function public.club_save_fixed_term_membership_product(
  p_organisation_id uuid,p_product_id uuid,p_name text,p_price_minor integer,p_duration_value integer,
  p_duration_unit text,p_sellable boolean,p_joining_fee_minor integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.club_products%rowtype; fee public.club_membership_initial_charges%rowtype; actor_role text;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['owner','gym_admin']) then
    raise exception 'Fixed-term product administration is not permitted' using errcode='42501';
  end if;
  if nullif(btrim(p_name),'') is null or char_length(btrim(p_name))>120 or p_price_minor is null or p_price_minor not between 0 and 100000000
     or p_duration_value is null or p_duration_value not between 1 and 1200 or p_duration_unit is null or p_duration_unit not in ('day','week','month')
     or p_sellable is null or (p_joining_fee_minor is not null and p_joining_fee_minor not between 0 and 100000000) then
    raise exception 'Invalid fixed-term product settings' using errcode='22023';
  end if;
  if p_product_id is null then
    insert into public.club_products(organisation_id,name,kind,price_minor,currency,billing,duration_days,fixed_term_value,fixed_term_unit,is_lifetime,sellable)
      values(p_organisation_id,btrim(p_name),'membership',p_price_minor,'GBP','one_off',null,p_duration_value,p_duration_unit,false,p_sellable)
      returning * into p;
    insert into public.club_product_entitlements(product_id,organisation_id,position,entitlement_key,scope,location_ids)
      values(p.id,p_organisation_id,0,'gym_access','future_locations','{}'::uuid[]);
  else
    select * into p from public.club_products where id=p_product_id and organisation_id=p_organisation_id for update;
    if not found or p.kind<>'membership' or p.billing<>'one_off' or p.legacy_import_category is not null or p.is_lifetime then
      raise exception 'Only live non-lifetime membership products can be configured as fixed-term' using errcode='22023';
    end if;
    update public.club_products set name=btrim(p_name),price_minor=p_price_minor,currency='GBP',billing='one_off',duration_days=null,
      fixed_term_value=p_duration_value,fixed_term_unit=p_duration_unit,sellable=p_sellable
      where id=p.id returning * into p;
    if not exists(select 1 from public.club_product_entitlements where product_id=p.id and organisation_id=p_organisation_id and entitlement_key='gym_access') then
      insert into public.club_product_entitlements(product_id,organisation_id,position,entitlement_key,scope,location_ids)
        values(p.id,p_organisation_id,coalesce((select max(position)+1 from public.club_product_entitlements where product_id=p.id),0),'gym_access','future_locations','{}'::uuid[]);
    end if;
  end if;
  if p_joining_fee_minor is not null then
    insert into public.club_membership_initial_charges(organisation_id,product_id,charge_type,amount_minor,currency,required,active,position)
      values(p_organisation_id,p.id,'joining_fee',p_joining_fee_minor,'GBP',true,p_joining_fee_minor>0,0)
      on conflict(organisation_id,product_id,charge_type) do update set amount_minor=excluded.amount_minor,currency='GBP',required=true,active=excluded.active,position=0,updated_at=now()
      returning * into fee;
  end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    values(p_organisation_id,auth.uid(),actor_role,'membership.fixed_term_product_saved','club_product',p.id,
      jsonb_build_object('product_name',p.name,'price_minor',p.price_minor,'billing','one_off','duration_value',p_duration_value,'duration_unit',p_duration_unit,'sellable',p_sellable,
        'joining_fee_configured',p_joining_fee_minor is not null,'joining_fee_minor',p_joining_fee_minor));
  return to_jsonb(p);
end; $$;
revoke all on function public.club_save_fixed_term_membership_product(uuid,uuid,text,integer,integer,text,boolean,integer) from public,anon;
grant execute on function public.club_save_fixed_term_membership_product(uuid,uuid,text,integer,integer,text,boolean,integer) to authenticated;

-- A recorded prepaid/complimentary decision is an auditable grant only. This
-- function never writes to payment, mandate, subscription or obligation tables.
create or replace function public.club_assign_fixed_term_membership(
  p_organisation_id uuid,p_product_id uuid,p_customer_id uuid,p_holder_user_ids uuid[],p_starts_on date,
  p_expires_on date,p_grant_type text,p_reason text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.club_products%rowtype; v_start timestamptz; v_end timestamptz; result jsonb; m_id uuid; actor_role text; existed boolean;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['owner','gym_admin'])
     or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.assign') then
    raise exception 'Fixed-term membership assignment is not permitted' using errcode='42501';
  end if;
  if p_grant_type is null or p_grant_type not in ('prepaid','complimentary') or nullif(btrim(p_reason),'') is null or char_length(btrim(p_reason))<8
     or char_length(p_reason)>500 or p_starts_on is null or nullif(btrim(p_idempotency_key),'') is null
     or char_length(p_idempotency_key)>160 or (p_expires_on is not null and p_expires_on<p_starts_on) then
    raise exception 'A valid term, grant classification and audit reason are required' using errcode='22023';
  end if;
  select * into p from public.club_products where id=p_product_id and organisation_id=p_organisation_id for share;
  if not found or p.kind<>'membership' or p.billing<>'one_off' or p.fixed_term_value is null or p.archived_at is not null or p.legacy_import_category is not null or p.is_lifetime
     or (p.price_minor=0 and p_grant_type='prepaid') then
    raise exception 'Choose an available fixed-term membership product' using errcode='22023';
  end if;
  v_start:=p_starts_on::timestamp at time zone 'Europe/London';
  if p_expires_on is not null then
    v_end:=(p_expires_on+1)::timestamp at time zone 'Europe/London';
  else
    v_end:=public.club_fixed_term_end(v_start,p.fixed_term_value,p.fixed_term_unit);
  end if;
  select exists(select 1 from public.club_memberships where organisation_id=p_organisation_id and assignment_idempotency_key=p_idempotency_key) into existed;
  result:=public.club_assign_membership(p_organisation_id,p_product_id,p_customer_id,coalesce(p_holder_user_ids,'{}'::uuid[]),v_start,v_end,'staff_assignment',p_idempotency_key);
  m_id:=(result->'membership'->>'id')::uuid;
  if not existed then
    select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
    insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,reason,metadata)
      values(p_organisation_id,auth.uid(),actor_role,'membership.fixed_term_granted','membership',m_id,btrim(p_reason),
        jsonb_build_object('grant_type',p_grant_type,'product_id',p.id,'starts_on',p_starts_on,'expires_on',p_expires_on,'billing_created',false));
  end if;
  return result;
end; $$;
revoke all on function public.club_assign_fixed_term_membership(uuid,uuid,uuid,uuid[],date,date,text,text,text) from public,anon;
grant execute on function public.club_assign_fixed_term_membership(uuid,uuid,uuid,uuid[],date,date,text,text,text) to authenticated;

-- Snapshot configured duration at joining/order creation so later catalogue
-- edits cannot alter an already agreed purchase.
alter table public.club_membership_join_requests
  add column if not exists fixed_term_value_snapshot integer,
  add column if not exists fixed_term_unit_snapshot text;
alter table public.club_paypal_pay_in_3_orders
  add column if not exists fixed_term_value_snapshot integer,
  add column if not exists fixed_term_unit_snapshot text;

create or replace function public.club_snapshot_fixed_term_join_request()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  select p.fixed_term_value,p.fixed_term_unit into new.fixed_term_value_snapshot,new.fixed_term_unit_snapshot
    from public.club_products p where p.id=new.product_id and p.organisation_id=new.organisation_id;
  return new;
end; $$;
revoke all on function public.club_snapshot_fixed_term_join_request() from public,anon,authenticated;
drop trigger if exists club_snapshot_fixed_term_join_request on public.club_membership_join_requests;
create trigger club_snapshot_fixed_term_join_request before insert or update of product_id on public.club_membership_join_requests
  for each row execute function public.club_snapshot_fixed_term_join_request();
update public.club_membership_join_requests j set fixed_term_value_snapshot=p.fixed_term_value,fixed_term_unit_snapshot=p.fixed_term_unit
  from public.club_products p where p.id=j.product_id and p.organisation_id=j.organisation_id
    and j.fixed_term_value_snapshot is null and p.fixed_term_value is not null;

create or replace function public.club_snapshot_fixed_term_paypal_order()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  select p.fixed_term_value,p.fixed_term_unit into new.fixed_term_value_snapshot,new.fixed_term_unit_snapshot
    from public.club_products p where p.id=new.product_id and p.organisation_id=new.organisation_id;
  return new;
end; $$;
revoke all on function public.club_snapshot_fixed_term_paypal_order() from public,anon,authenticated;
drop trigger if exists club_snapshot_fixed_term_paypal_order on public.club_paypal_pay_in_3_orders;
create trigger club_snapshot_fixed_term_paypal_order before insert or update of product_id on public.club_paypal_pay_in_3_orders
  for each row execute function public.club_snapshot_fixed_term_paypal_order();

-- Product-specific fixed-term fee rows use the existing initial-charge source.
-- Existing discount/waiver promotion rules can continue targeting joining_fee.
create or replace function public.club_apply_fixed_term_joining_charge()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare fee integer;
begin
  if new.checkout_kind<>'monthly_recurring' then
    select coalesce(sum(c.amount_minor),0)::integer into fee from public.club_membership_initial_charges c
      where c.organisation_id=new.organisation_id and c.product_id=new.product_id and c.charge_type='joining_fee' and c.required and c.active;
    if exists(select 1 from public.club_products p where p.id=new.product_id and p.organisation_id=new.organisation_id and p.fixed_term_value is not null) and fee>0 then
      new.joining_fee_minor:=fee;
      new.upfront_amount_minor:=new.first_period_minor+fee;
      new.upfront_provider:='stripe';
      new.upfront_payment_state:='unavailable';
      new.payment_state:='unavailable';
      if new.status='ready_to_activate' then new.status:='payment_required'; end if;
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.club_apply_fixed_term_joining_charge() from public,anon,authenticated;
drop trigger if exists club_apply_fixed_term_joining_charge on public.club_membership_join_requests;
create trigger club_apply_fixed_term_joining_charge before insert or update of product_id,checkout_kind,first_period_minor on public.club_membership_join_requests
  for each row execute function public.club_apply_fixed_term_joining_charge();

-- The existing access RPCs consume membership/grant ends_at with an exclusive
-- boundary. Imported expiry dates are inclusive local dates and become midnight
-- Europe/London on the following day. Explicit CSV dates always win over product
-- duration; the product term is only a fallback when source expiry is absent.
create or replace function public.club_set_fixed_term_membership_boundary()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.club_products%rowtype; j public.club_membership_join_requests%rowtype; po public.club_paypal_pay_in_3_orders%rowtype;
  row_data public.club_member_import_rows%rowtype; start_date date; expiry_date date; term_value integer; term_unit text;
begin
  select * into p from public.club_products where id=new.product_id and organisation_id=new.organisation_id;
  if not found or p.is_lifetime then return new; end if;
  if new.source='legacy_import' and new.import_row_id is not null then
    select * into row_data from public.club_member_import_rows where id=new.import_row_id and organisation_id=new.organisation_id;
    if found then
      if row_data.normalized_values->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$' then start_date:=(row_data.normalized_values->>'startDate')::date; end if;
      if row_data.normalized_values->>'endDate' ~ '^\d{4}-\d{2}-\d{2}$' then expiry_date:=(row_data.normalized_values->>'endDate')::date; end if;
    end if;
    if start_date is not null then new.starts_at:=start_date::timestamp at time zone 'Europe/London'; end if;
    if expiry_date is not null then new.ends_at:=(expiry_date+1)::timestamp at time zone 'Europe/London';
    elsif new.ends_at is null and p.fixed_term_value is not null then new.ends_at:=public.club_fixed_term_end(new.starts_at,p.fixed_term_value,p.fixed_term_unit); end if;
    if new.ends_at is not null and new.ends_at<=now() then new.status:='expired'; end if;
    return new;
  end if;
  if new.source in ('purchase','member_join') then
    if new.assignment_idempotency_key like 'join:%' then
      select * into j from public.club_membership_join_requests where id=substring(new.assignment_idempotency_key from 6)::uuid and organisation_id=new.organisation_id;
      if found then term_value:=j.fixed_term_value_snapshot; term_unit:=j.fixed_term_unit_snapshot; end if;
    elsif new.assignment_idempotency_key like 'paypal-pay-in-3:%' then
      select * into po from public.club_paypal_pay_in_3_orders where id=substring(new.assignment_idempotency_key from 17)::uuid and organisation_id=new.organisation_id;
      if found then term_value:=po.fixed_term_value_snapshot; term_unit:=po.fixed_term_unit_snapshot; end if;
    end if;
    if term_value is not null then new.ends_at:=public.club_fixed_term_end(new.starts_at,term_value,term_unit); end if;
  elsif new.source='staff_assignment' and new.ends_at is null and p.fixed_term_value is not null then
    new.ends_at:=public.club_fixed_term_end(new.starts_at,p.fixed_term_value,p.fixed_term_unit);
  end if;
  return new;
end; $$;
revoke all on function public.club_set_fixed_term_membership_boundary() from public,anon,authenticated;
drop trigger if exists club_set_fixed_term_membership_boundary on public.club_memberships;
create trigger club_set_fixed_term_membership_boundary before insert or update of product_id,starts_at,ends_at,source,assignment_idempotency_key,import_row_id
  on public.club_memberships for each row execute function public.club_set_fixed_term_membership_boundary();

create or replace function public.club_sync_imported_membership_grant_boundary()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.source='legacy_import' and new.membership_id is not null then
    select m.starts_at,m.ends_at into new.starts_at,new.ends_at from public.club_memberships m
      where m.id=new.membership_id and m.organisation_id=new.organisation_id;
  end if;
  return new;
end; $$;
revoke all on function public.club_sync_imported_membership_grant_boundary() from public,anon,authenticated;
drop trigger if exists club_sync_imported_membership_grant_boundary on public.club_entitlement_grants;
create trigger club_sync_imported_membership_grant_boundary before insert or update of membership_id,starts_at,ends_at,source
  on public.club_entitlement_grants for each row execute function public.club_sync_imported_membership_grant_boundary();

-- Preserve the public joinable-products contract while exposing term metadata.
create or replace function public.club_list_joinable_memberships(p_organisation_id uuid)
returns setof jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object('id',p.id,'organisation_id',p.organisation_id,'name',p.name,'kind',p.kind,'price_minor',p.price_minor,
    'currency',p.currency,'billing',p.billing,'duration_days',p.duration_days,'fixed_term_value',p.fixed_term_value,
    'fixed_term_unit',p.fixed_term_unit,'sellable',p.sellable,
    'joining_fee_minor',case when p.billing='recurring' or (o.slug='madhouse-gym' and (p.duration_days>=365 or p.fixed_term_value is not null)) then coalesce(charges.joining_fee_minor,0) else 0 end,
    'joining_fee_configured',case when p.price_minor=0 or p.fixed_term_value is not null or not (p.billing='recurring' or (o.slug='madhouse-gym' and p.duration_days>=365)) then true else coalesce(charges.configured,false) end,
    'checkout_kind',case when p.price_minor=0 then 'free' when p.billing='recurring' then 'monthly_recurring'
      when p.fixed_term_value is not null then 'one_off'
      when p.duration_days=1 then 'day_pass' when p.duration_days=7 then 'week_pass'
      when p.duration_days>=365 then 'annual_one_off' else 'one_off' end)
  from public.club_products p join public.club_organisations o on o.id=p.organisation_id and o.active and o.member_joinable
  left join lateral (select sum(c.amount_minor)::integer joining_fee_minor,count(*)>0 configured from public.club_membership_initial_charges c
    where c.organisation_id=p.organisation_id and c.product_id=p.id and c.charge_type='joining_fee' and c.required and c.active) charges on true
  where p.organisation_id=p_organisation_id and p.kind='membership' and p.sellable and p.archived_at is null
    and (o.slug<>'madhouse-gym' or p.price_minor>0) order by p.name;
$$;
revoke all on function public.club_list_joinable_memberships(uuid) from public,anon,authenticated;
grant execute on function public.club_list_joinable_memberships(uuid) to anon,authenticated;

commit;
