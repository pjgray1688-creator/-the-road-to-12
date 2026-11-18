-- Enforce the approved Madhouse Off-Peak windows at the existing access-decision
-- audit boundary. No credentials, memberships, grants or attendance rows change.
begin;

-- The product and its access guard are installed atomically below. This avoids
-- publishing a sellable membership before the approved hours are enforced.
do $$
declare v_org_id uuid; v_product_id uuid; v_product_count integer; v_count integer;
begin
  if to_regclass('public.club_product_entitlements') is null
     or to_regclass('public.club_membership_initial_charges') is null then
    raise exception 'Off-Peak product entitlement or joining-charge prerequisites are missing';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_products' and column_name='is_lifetime')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_products' and column_name='pricing_on_request')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_membership_product_rules' and column_name='shared_membership') then
    raise exception 'Off-Peak product schema does not match the reviewed Madhouse contract';
  end if;
  select id into v_org_id from public.club_organisations where slug='madhouse-gym' and active;
  if v_org_id is null or (select count(*) from public.club_organisations where slug='madhouse-gym' and active)<>1 then
    raise exception 'Exactly one active Madhouse organisation is required';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_org_id::text),hashtext('madhouse-off-peak-product-restoration'));

  select count(*) into v_product_count from public.club_products where organisation_id=v_org_id and name='Off Peak';
  if v_product_count>1 then raise exception 'Duplicate Madhouse Off Peak product; manual review required'; end if;
  if v_product_count=0 then
    insert into public.club_products(organisation_id,name,kind,price_minor,currency,billing,duration_days,
      pricing_on_request,is_lifetime,sellable,archived_at)
    values(v_org_id,'Off Peak','membership',1499,'GBP','recurring',null,false,false,true,null)
    returning id into v_product_id;
  else
    select id into v_product_id from public.club_products where organisation_id=v_org_id and name='Off Peak';
    if not exists(select 1 from public.club_products where id=v_product_id and organisation_id=v_org_id
      and kind='membership' and price_minor=1499 and currency='GBP' and billing='recurring'
      and duration_days is null and not pricing_on_request and not is_lifetime and sellable and archived_at is null) then
      raise exception 'Existing Off Peak product terms differ from the approved contract; no changes made';
    end if;
  end if;

  select count(*) into v_count from public.club_membership_product_rules
    where organisation_id=v_org_id and (product_id=v_product_id or catalogue_code='madhouse.membership.off-peak.v1');
  if v_count=0 then
    insert into public.club_membership_product_rules(product_id,organisation_id,catalogue_code,maximum_holders,
      shared_membership,eligibility_verification_required,access_timezone,access_weekdays,access_opens_at,access_closes_at)
    values(v_product_id,v_org_id,'madhouse.membership.off-peak.v1',1,false,false,'Europe/London',array[1,2,3,4,5],'10:00','15:00');
  elsif v_count<>1 or not exists(select 1 from public.club_membership_product_rules where product_id=v_product_id
      and organisation_id=v_org_id and catalogue_code='madhouse.membership.off-peak.v1' and maximum_holders=1
      and not shared_membership and not eligibility_verification_required and access_timezone='Europe/London'
      and access_weekdays=array[1,2,3,4,5] and access_opens_at='10:00' and access_closes_at='15:00') then
    raise exception 'Existing Off Peak membership rule differs from the approved contract; no changes made';
  end if;

  select count(*) into v_count from public.club_product_entitlements where organisation_id=v_org_id and product_id=v_product_id;
  if v_count=0 then
    insert into public.club_product_entitlements(product_id,organisation_id,position,entitlement_key,scope,location_ids)
    values(v_product_id,v_org_id,0,'gym_access','future_locations','{}');
  elsif v_count<>1 or not exists(select 1 from public.club_product_entitlements where product_id=v_product_id
      and organisation_id=v_org_id and position=0 and entitlement_key='gym_access' and scope='future_locations'
      and coalesce(cardinality(location_ids),0)=0 and allowance_quantity is null and allowance_period is null
      and discount_percent is null and discount_period is null and discount_max_uses is null) then
    raise exception 'Existing Off Peak product entitlements differ from the approved gym-access contract';
  end if;

  select count(*) into v_count from public.club_membership_initial_charges
    where organisation_id=v_org_id and product_id=v_product_id and charge_type='joining_fee';
  if v_count=0 then
    insert into public.club_membership_initial_charges(organisation_id,product_id,charge_type,amount_minor,currency,required,active,position)
    values(v_org_id,v_product_id,'joining_fee',2200,'GBP',true,true,0);
  elsif v_count<>1 or not exists(select 1 from public.club_membership_initial_charges where organisation_id=v_org_id
      and product_id=v_product_id and charge_type='joining_fee' and amount_minor=2200 and currency='GBP' and required and active) then
    raise exception 'Existing Off Peak joining fee differs from the approved £22 charge; no changes made';
  end if;
  -- Existing membership promotion rows are neither edited nor newly created.
end;
$$;

do $$
declare product_count integer; rules_count integer;
begin
  if to_regclass('public.club_organisations') is null or to_regclass('public.club_products') is null
     or to_regclass('public.club_membership_product_rules') is null
     or to_regclass('public.club_memberships') is null or to_regclass('public.club_entitlement_grants') is null
     or to_regclass('public.club_access_decisions') is null then
    raise exception 'Off-Peak access-window prerequisites are missing';
  end if;
  if to_regprocedure('public.club_access_decide_customer(uuid,uuid,uuid,text,text,uuid,text)') is null then
    raise exception 'Authoritative Club access-decision function is missing';
  end if;
  if pg_get_function_result(to_regprocedure('public.club_access_decide_customer(uuid,uuid,uuid,text,text,uuid,text)'))<>'jsonb' then
    raise exception 'Authoritative Club access-decision return type does not match the deployed contract';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_access_decisions' and column_name='membership_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_access_decisions' and column_name='decision')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_access_decisions' and column_name='decided_at')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_membership_product_rules' and column_name='catalogue_code')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_membership_product_rules' and column_name='product_id' and data_type='uuid')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_membership_product_rules' and column_name='organisation_id' and data_type='uuid')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_membership_product_rules' and column_name='access_timezone')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_membership_product_rules' and column_name='access_weekdays')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_membership_product_rules' and column_name='access_opens_at')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_membership_product_rules' and column_name='access_closes_at')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_membership_product_rules' and column_name='updated_at') then
    raise exception 'Off-Peak access-window columns do not match the deployed contract';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_organisations' and column_name='id' and data_type='uuid')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_organisations' and column_name='slug')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_products' and column_name='id' and data_type='uuid')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_products' and column_name='organisation_id' and data_type='uuid')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_products' and column_name='kind')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_products' and column_name='sellable')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_products' and column_name='archived_at')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_memberships' and column_name='id' and data_type='uuid')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_memberships' and column_name='organisation_id' and data_type='uuid')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_memberships' and column_name='product_id' and data_type='uuid')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_entitlement_grants' and column_name='organisation_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_entitlement_grants' and column_name='membership_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_entitlement_grants' and column_name='entitlement_key')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_entitlement_grants' and column_name='starts_at')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_entitlement_grants' and column_name='ends_at') then
    raise exception 'Off-Peak catalogue or entitlement dependencies do not match the deployed contract';
  end if;
  select count(*) into product_count from public.club_membership_product_rules r
   join public.club_organisations o on o.id=r.organisation_id
   where o.slug='madhouse-gym' and r.catalogue_code='madhouse.membership.off-peak.v1';
  select count(*) into rules_count from public.club_membership_product_rules r
   join public.club_products p on p.id=r.product_id and p.organisation_id=r.organisation_id
   join public.club_organisations o on o.id=r.organisation_id
   where o.slug='madhouse-gym' and r.catalogue_code='madhouse.membership.off-peak.v1'
     and p.kind='membership' and p.sellable and p.archived_at is null;
  if product_count<>1 or rules_count<>1 then
    raise exception 'Exactly one sellable Madhouse Off-Peak membership rule is required before installing its door windows';
  end if;
  if not exists(select 1 from pg_constraint c where c.conrelid='public.club_products'::regclass and c.contype='u'
     and pg_get_constraintdef(c.oid)='UNIQUE (id, organisation_id)') then
    raise exception 'Organisation-scoped club_products key is missing';
  end if;
end;
$$;

create table if not exists public.club_membership_access_windows (
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  product_id uuid not null,
  weekday smallint not null check(weekday between 1 and 7),
  opens_at time not null,
  closes_at time not null,
  created_at timestamptz not null default now(),
  primary key(organisation_id,product_id,weekday,opens_at),
  foreign key(product_id,organisation_id) references public.club_products(id,organisation_id) on delete restrict,
  check(opens_at<>closes_at)
);
alter table public.club_membership_access_windows enable row level security;
revoke all on public.club_membership_access_windows from public,anon,authenticated,service_role;

do $$
declare v_org_id uuid; v_product_id uuid;
begin
  select o.id,r.product_id into v_org_id,v_product_id
   from public.club_membership_product_rules r join public.club_organisations o on o.id=r.organisation_id
   where o.slug='madhouse-gym' and r.catalogue_code='madhouse.membership.off-peak.v1';
  update public.club_membership_product_rules set access_timezone='Europe/London',access_weekdays=array[1,2,3,4,5],
    access_opens_at='10:00'::time,access_closes_at='15:00'::time,updated_at=now()
   where organisation_id=v_org_id and product_id=v_product_id;
  insert into public.club_membership_access_windows(organisation_id,product_id,weekday,opens_at,closes_at)
  select v_org_id,v_product_id,d.weekday,d.opens_at,d.closes_at from (values
    (1,'10:00'::time,'15:00'::time),(1,'22:00'::time,'03:00'::time),
    (2,'10:00'::time,'15:00'::time),(2,'22:00'::time,'03:00'::time),
    (3,'10:00'::time,'15:00'::time),(3,'22:00'::time,'03:00'::time),
    (4,'10:00'::time,'15:00'::time),(4,'22:00'::time,'03:00'::time),
    (5,'10:00'::time,'15:00'::time),(5,'22:00'::time,'03:00'::time)
  ) as d(weekday,opens_at,closes_at)
  on conflict(organisation_id,product_id,weekday,opens_at) do update set closes_at=excluded.closes_at;
end;
$$;

create or replace function public.club_membership_access_window_allows(p_membership_id uuid,p_at timestamptz default now())
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_org_id uuid; v_product_id uuid; tz text; local_value timestamp; local_day integer; local_time time; has_window_rows boolean;
  legacy_weekdays integer[]; legacy_opens time; legacy_closes time;
begin
  -- One-off eligible passes can have no membership row; their authoritative
  -- validity is already checked in club_access_decide_customer.
  if p_membership_id is null then return true; end if;
  select m.organisation_id,m.product_id into v_org_id,v_product_id from public.club_memberships m where m.id=p_membership_id;
  if not found then return false; end if;
  select r.access_timezone into tz from public.club_membership_product_rules r
   where r.organisation_id=v_org_id and r.product_id=v_product_id;
  if not found or tz is null then return true; end if;
  if exists(select 1 from public.club_entitlement_grants g where g.organisation_id=v_org_id and g.membership_id=p_membership_id
    and g.entitlement_key='off_peak_access_override' and g.starts_at<=p_at and (g.ends_at is null or g.ends_at>p_at)) then
    return true;
  end if;
  local_value:=p_at at time zone tz;
  local_day:=extract(isodow from local_value)::integer;
  local_time:=local_value::time;
  select exists(select 1 from public.club_membership_access_windows w where w.organisation_id=v_org_id and w.product_id=v_product_id) into has_window_rows;
  if has_window_rows then
    return exists(
      select 1 from public.club_membership_access_windows w
      where w.organisation_id=v_org_id and w.product_id=v_product_id and (
        (w.weekday=local_day and ((w.opens_at<w.closes_at and local_time>=w.opens_at and local_time<w.closes_at)
          or (w.opens_at>w.closes_at and local_time>=w.opens_at)))
        or (((local_day+5)%7)+1=w.weekday and w.opens_at>w.closes_at and local_time<w.closes_at)
      )
    );
  end if;
  -- Preserve existing single-interval policies for every other membership.
  select r.access_weekdays,r.access_opens_at,r.access_closes_at into legacy_weekdays,legacy_opens,legacy_closes
   from public.club_membership_product_rules r where r.organisation_id=v_org_id and r.product_id=v_product_id;
  return coalesce(local_day=any(legacy_weekdays) and local_time>=legacy_opens and local_time<legacy_closes,false);
end;
$$;

create or replace function public.club_guard_membership_access_window() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.decision='allow' and not public.club_membership_access_window_allows(new.membership_id,new.decided_at) then
    raise exception 'Membership access is outside the permitted window' using errcode='42501';
  end if;
  return new;
end;
$$;
drop trigger if exists club_membership_access_window_guard on public.club_access_decisions;
create trigger club_membership_access_window_guard before insert on public.club_access_decisions
  for each row execute function public.club_guard_membership_access_window();
revoke all on function public.club_membership_access_window_allows(uuid,timestamptz),public.club_guard_membership_access_window() from public,anon,authenticated,service_role;

commit;
