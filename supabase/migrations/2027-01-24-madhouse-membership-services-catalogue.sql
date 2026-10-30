-- SUPERSEDED FOR PRODUCTION: do not execute this migration.
-- Production retained its established membership names/prices and January 25/26
-- were applied first. Use the two reviewed, manual scripts in supabase/deployment
-- for membership compatibility and service-package seeding instead.
begin;

create table if not exists public.club_membership_product_rules (
  product_id uuid primary key,
  organisation_id uuid not null,
  catalogue_code text not null,
  maximum_holders integer not null default 1 check(maximum_holders between 1 and 2),
  eligibility_verification_required boolean not null default false,
  access_timezone text,
  access_weekdays integer[],
  access_opens_at time,
  access_closes_at time,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organisation_id,catalogue_code),
  foreign key(product_id,organisation_id) references public.club_products(id,organisation_id) on delete restrict,
  check((access_timezone is null and access_weekdays is null and access_opens_at is null and access_closes_at is null)
    or (access_timezone='Europe/London' and access_weekdays <@ array[1,2,3,4,5,6,7] and cardinality(access_weekdays)>0
      and access_opens_at is not null and access_closes_at is not null and access_opens_at<access_closes_at))
);
alter table public.club_membership_product_rules enable row level security;
revoke all on public.club_membership_product_rules from public,anon,authenticated;

create table if not exists public.club_membership_eligibility_verifications (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null,
  join_request_id uuid not null, product_id uuid not null, customer_id uuid not null,
  status text not null check(status in ('approved','rejected')),
  evidence_note text not null check(char_length(btrim(evidence_note)) between 3 and 500),
  verified_by uuid not null references auth.users(id), verified_at timestamptz not null default now(),
  unique(organisation_id,join_request_id),
  foreign key(join_request_id,organisation_id) references public.club_membership_join_requests(id,organisation_id) on delete restrict,
  foreign key(product_id,organisation_id) references public.club_products(id,organisation_id) on delete restrict,
  foreign key(customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete restrict
);
alter table public.club_membership_eligibility_verifications enable row level security;
revoke all on public.club_membership_eligibility_verifications from public,anon,authenticated;

-- Preserve canonical product IDs referenced by memberships. Rename only an exact
-- legacy row when its target name is absent; ambiguity fails the migration.
do $$
declare org uuid; duplicate_name text;
begin
  select id into org from public.club_organisations where slug='madhouse-gym';
  if org is null then raise exception 'Madhouse organisation is missing'; end if;
  select name into duplicate_name from public.club_products where organisation_id=org
    and name in ('Gym Day Pass','Day Pass','Week Pass','1 Week Pass','Standard Monthly','Unlimited Gym','Concession Monthly','Unlimited Gym Discount','Couples Membership','Unlimited Gym Couple','Off Peak','Yearly Membership')
    group by name having count(*)>1 limit 1;
  if duplicate_name is not null then raise exception 'Duplicate Madhouse product: %',duplicate_name; end if;
  if exists(select 1 from public.club_products where organisation_id=org and name='Gym Day Pass') and exists(select 1 from public.club_products where organisation_id=org and name='Day Pass') then raise exception 'Both legacy and canonical Day Pass products exist'; end if;
  if exists(select 1 from public.club_products where organisation_id=org and name='Week Pass') and exists(select 1 from public.club_products where organisation_id=org and name='1 Week Pass') then raise exception 'Both legacy and canonical Week Pass products exist'; end if;
  if exists(select 1 from public.club_products where organisation_id=org and name='Standard Monthly') and exists(select 1 from public.club_products where organisation_id=org and name='Unlimited Gym') then raise exception 'Both legacy and canonical Unlimited Gym products exist'; end if;
  if exists(select 1 from public.club_products where organisation_id=org and name='Concession Monthly') and exists(select 1 from public.club_products where organisation_id=org and name='Unlimited Gym Discount') then raise exception 'Both legacy and canonical Discount products exist'; end if;
  if exists(select 1 from public.club_products where organisation_id=org and name='Couples Membership') and exists(select 1 from public.club_products where organisation_id=org and name='Unlimited Gym Couple') then raise exception 'Both canonical and legacy Couple products exist'; end if;
  update public.club_products set name='Day Pass' where organisation_id=org and name='Gym Day Pass'
    and not exists(select 1 from public.club_products where organisation_id=org and name='Day Pass');
  update public.club_products set name='1 Week Pass' where organisation_id=org and name='Week Pass'
    and not exists(select 1 from public.club_products where organisation_id=org and name='1 Week Pass');
  update public.club_products set name='Unlimited Gym' where organisation_id=org and name='Standard Monthly'
    and not exists(select 1 from public.club_products where organisation_id=org and name='Unlimited Gym');
  update public.club_products set name='Unlimited Gym Discount' where organisation_id=org and name='Concession Monthly'
    and not exists(select 1 from public.club_products where organisation_id=org and name='Unlimited Gym Discount');
  update public.club_products set name='Couples Membership' where organisation_id=org and name='Unlimited Gym Couple'
    and not exists(select 1 from public.club_products where organisation_id=org and name='Couples Membership');
end $$;

do $$
declare org uuid; item record; product uuid;
begin
  select id into org from public.club_organisations where slug='madhouse-gym';
  for item in select * from (values
    ('madhouse.membership.day.v1','Day Pass',500,'one_off',1,1,false,null::text,null::integer[],null::time,null::time),
    ('madhouse.membership.week.v1','1 Week Pass',1200,'one_off',7,1,false,null,null,null,null),
    ('madhouse.membership.unlimited.v1','Unlimited Gym',2700,'recurring',null,1,false,null,null,null,null),
    ('madhouse.membership.off-peak.v1','Off Peak',1499,'recurring',null,1,false,'Europe/London',array[1,2,3,4,5],'10:00'::time,'15:00'::time),
    ('madhouse.membership.discount.v1','Unlimited Gym Discount',2200,'recurring',null,1,true,null,null,null,null),
    ('madhouse.membership.couple.v1','Couples Membership',4500,'recurring',null,2,false,null,null,null,null),
    ('madhouse.membership.yearly.v1','Yearly Membership',27500,'one_off',365,1,false,null,null,null,null)
  ) as x(code,name,price,billing,duration,max_holders,verify_required,tz,weekdays,opens,closes)
  loop
    select id into product from public.club_products where organisation_id=org and name=item.name;
    if product is null then
      insert into public.club_products(organisation_id,name,kind,price_minor,currency,billing,duration_days,sellable)
      values(org,item.name,'membership',item.price,'GBP',item.billing,item.duration,true) returning id into product;
    elsif item.name='Couples Membership' then
      if not exists(select 1 from public.club_products where id=product and organisation_id=org and kind='membership'
        and price_minor=4500 and currency='GBP' and billing='recurring' and sellable) then
        raise exception 'Existing Madhouse Couples Membership configuration does not match the authorised £45 recurring product';
      end if;
    else
      update public.club_products set kind='membership',price_minor=item.price,currency='GBP',billing=item.billing,
        duration_days=item.duration,sellable=true,archived_at=null where id=product and organisation_id=org;
    end if;
    insert into public.club_membership_product_rules(product_id,organisation_id,catalogue_code,maximum_holders,
      eligibility_verification_required,access_timezone,access_weekdays,access_opens_at,access_closes_at)
    values(product,org,item.code,item.max_holders,item.verify_required,item.tz,item.weekdays,item.opens,item.closes)
    on conflict(product_id) do update set catalogue_code=excluded.catalogue_code,maximum_holders=excluded.maximum_holders,
      eligibility_verification_required=excluded.eligibility_verification_required,access_timezone=excluded.access_timezone,
      access_weekdays=excluded.access_weekdays,access_opens_at=excluded.access_opens_at,access_closes_at=excluded.access_closes_at,updated_at=now();
    insert into public.club_product_entitlements(product_id,organisation_id,position,entitlement_key,scope,location_ids)
      values(product,org,0,'gym_access','future_locations','{}')
      on conflict(product_id,position) do update set entitlement_key='gym_access',scope='future_locations',location_ids='{}',
        allowance_quantity=null,allowance_period=null,discount_percent=null,discount_period=null,discount_max_uses=null;
  end loop;
end $$;

-- Transformation packages are services, not memberships. Remove the historic
-- gym-access promise while preserving the established 70-day/weekly benefits.
delete from public.club_product_entitlements e using public.club_products p,public.club_organisations o
where e.product_id=p.id and p.organisation_id=o.id and o.slug='madhouse-gym'
  and p.name in ('Transformation Bronze','Transformation Silver','Transformation Gold') and e.entitlement_key='gym_access';
update public.club_products p set price_minor=case p.name when 'Transformation Bronze' then 25000 when 'Transformation Silver' then 40000 else 52500 end,
  kind='transformation',billing='one_off',duration_days=70,sellable=true,archived_at=null
from public.club_organisations o where p.organisation_id=o.id and o.slug='madhouse-gym'
  and p.name in ('Transformation Bronze','Transformation Silver','Transformation Gold');
update public.club_products p set price_minor=20000,kind='pt',billing='one_off',sellable=true,archived_at=null
from public.club_organisations o where p.organisation_id=o.id and o.slug='madhouse-gym' and p.name='10 PT Session Block';

create table if not exists public.club_commerce_package_rules (
  commerce_product_id uuid primary key, organisation_id uuid not null,
  package_kind text not null check(package_kind in ('transformation','pt_block')),
  duration_days integer, weekly_pt_quantity integer, weekly_class_quantity integer,
  requires_active_gym_membership boolean not null default false,
  foreign key(commerce_product_id,organisation_id) references public.club_commerce_products(id,organisation_id) on delete restrict,
  check((package_kind='transformation' and duration_days=70 and weekly_pt_quantity between 1 and 3 and weekly_class_quantity=1 and requires_active_gym_membership)
    or (package_kind='pt_block' and duration_days is null and weekly_pt_quantity is null and weekly_class_quantity is null))
);
alter table public.club_commerce_package_rules enable row level security;
revoke all on public.club_commerce_package_rules from public,anon,authenticated;

do $$
declare org uuid; item record; service uuid; commerce uuid; matching integer;
begin
  select id into org from public.club_organisations where slug='madhouse-gym';
  for item in select * from (values
    ('MH-SVC-TRANS-BRONZE','Transformation Bronze',25000,'transformation',70,1,1,null::integer,
      '10-week transformation: weekly PT and class credits, individual programme, nutrition and coaching support.'),
    ('MH-SVC-TRANS-SILVER','Transformation Silver',40000,'transformation',70,2,1,null,
      '10-week transformation: two weekly PT sessions, weekly class credit, individual programme, nutrition and coaching support.'),
    ('MH-SVC-TRANS-GOLD','Transformation Gold',52500,'transformation',70,3,1,null,
      '10-week transformation: three weekly PT sessions, weekly class credit, individual programme, nutrition and coaching support.'),
    ('MH-SVC-PT-10','10 PT Session Block',20000,'pt_block',null,null,null,10,
      'Ten one-to-one PT sessions. Nutrition and transformation benefits are not included.')
  ) as x(sku,name,price,kind,duration,pt_week,class_week,block_credit,description)
  loop
    insert into public.club_services(organisation_id,name,description,category,price_minor,currency,active,package_credit_quantity,package_validity_days)
    values(org,item.name,item.description,'Services',item.price,'GBP',true,item.block_credit,null)
    on conflict(organisation_id,location_id,name) do update set description=excluded.description,category='Services',price_minor=excluded.price_minor,
      currency='GBP',active=true,package_credit_quantity=excluded.package_credit_quantity,package_validity_days=null,updated_at=now()
    returning id into service;
    select count(*) into matching from public.club_commerce_products where organisation_id=org and name=item.name;
    if matching>1 then raise exception 'Duplicate Madhouse commerce product: %',item.name; end if;
    if exists(select 1 from public.club_commerce_products where organisation_id=org and name=item.name and sku is not null and sku<>item.sku) then
      raise exception 'Madhouse commerce product has an unexpected SKU: %',item.name;
    end if;
    update public.club_commerce_products set sku=item.sku where organisation_id=org and name=item.name and sku is null
      and not exists(select 1 from public.club_commerce_products where organisation_id=org and sku=item.sku);
    insert into public.club_commerce_products(organisation_id,sku,name,description,category,active,stock_tracked,sell_price_minor,
      currency,media,sales_channels,unit_label,service_id,service_credit_quantity,service_validity_days,stripe_merchant_entity)
    values(org,item.sku,item.name,item.description,'Services',true,false,item.price,'GBP',
      jsonb_build_object('placeholder','madhouse-approved-service'),array['pos','online'],'package',service,item.block_credit,null,'madhouse_products_services')
    on conflict(organisation_id,sku) do update set name=excluded.name,description=excluded.description,category='Services',active=true,
      stock_tracked=false,sell_price_minor=excluded.sell_price_minor,currency='GBP',sales_channels=array['pos','online'],unit_label='package',
      service_id=excluded.service_id,service_credit_quantity=excluded.service_credit_quantity,service_validity_days=null,
      stripe_merchant_entity='madhouse_products_services',updated_at=now()
    returning id into commerce;
    insert into public.club_commerce_package_rules(commerce_product_id,organisation_id,package_kind,duration_days,weekly_pt_quantity,weekly_class_quantity,requires_active_gym_membership)
    values(commerce,org,item.kind,item.duration,item.pt_week,item.class_week,item.kind='transformation')
    on conflict(commerce_product_id) do update set package_kind=excluded.package_kind,duration_days=excluded.duration_days,
      weekly_pt_quantity=excluded.weekly_pt_quantity,weekly_class_quantity=excluded.weekly_class_quantity,
      requires_active_gym_membership=excluded.requires_active_gym_membership;
  end loop;
end $$;

create or replace function public.club_verify_membership_eligibility(p_organisation_id uuid,p_join_request_id uuid,p_status text,p_evidence_note text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; v public.club_membership_eligibility_verifications%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.assign') then raise exception 'Eligibility verification is not permitted' using errcode='42501'; end if;
  if p_status not in ('approved','rejected') or char_length(btrim(coalesce(p_evidence_note,''))) not between 3 and 500 then raise exception 'Record a valid decision and evidence note' using errcode='22023'; end if;
  select * into r from public.club_membership_join_requests where id=p_join_request_id and organisation_id=p_organisation_id for update;
  if not found or r.membership_id is not null or r.status in ('payment_pending','active','completed','cancelled') then raise exception 'Joining request is not available' using errcode='P0002'; end if;
  if not exists(select 1 from public.club_membership_product_rules where product_id=r.product_id and organisation_id=r.organisation_id and eligibility_verification_required) then raise exception 'This membership does not require eligibility verification' using errcode='22023'; end if;
  insert into public.club_membership_eligibility_verifications(organisation_id,join_request_id,product_id,customer_id,status,evidence_note,verified_by)
  values(r.organisation_id,r.id,r.product_id,r.customer_id,p_status,btrim(p_evidence_note),auth.uid())
  on conflict(organisation_id,join_request_id) do update set status=excluded.status,evidence_note=excluded.evidence_note,verified_by=auth.uid(),verified_at=now()
  returning * into v; return to_jsonb(v);
end $$;
revoke all on function public.club_verify_membership_eligibility(uuid,uuid,text,text) from public,anon;
grant execute on function public.club_verify_membership_eligibility(uuid,uuid,text,text) to authenticated;

create or replace function public.club_guard_membership_checkout_eligibility() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  if new.status='payment_pending' and old.status is distinct from new.status
    and exists(select 1 from public.club_membership_product_rules r where r.product_id=new.product_id and r.organisation_id=new.organisation_id and r.eligibility_verification_required)
    and not exists(select 1 from public.club_membership_eligibility_verifications v where v.organisation_id=new.organisation_id and v.join_request_id=new.id and v.status='approved')
  then raise exception 'Membership eligibility must be verified before checkout' using errcode='22023'; end if; return new;
end $$;
drop trigger if exists club_membership_checkout_eligibility on public.club_membership_join_requests;
create trigger club_membership_checkout_eligibility before update of status on public.club_membership_join_requests for each row execute function public.club_guard_membership_checkout_eligibility();

create or replace function public.club_guard_membership_holder_limit() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$ declare max_holders integer; current_holders integer; begin
  if exists(select 1 from public.club_membership_holders h where h.membership_id=new.membership_id and h.organisation_id=new.organisation_id and (h.user_id is not distinct from new.user_id or h.customer_id is not distinct from new.customer_id)) then return new; end if;
  select r.maximum_holders into max_holders from public.club_memberships m join public.club_membership_product_rules r on r.product_id=m.product_id and r.organisation_id=m.organisation_id where m.id=new.membership_id and m.organisation_id=new.organisation_id;
  if max_holders is null then max_holders:=1; end if;
  select count(*) into current_holders from public.club_membership_holders where membership_id=new.membership_id and organisation_id=new.organisation_id;
  if current_holders>=max_holders then raise exception 'This membership does not cover another person' using errcode='22023'; end if; return new;
end $$;
drop trigger if exists club_membership_holder_limit on public.club_membership_holders;
create trigger club_membership_holder_limit before insert on public.club_membership_holders for each row execute function public.club_guard_membership_holder_limit();

create or replace function public.club_guard_service_package_purchase() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare rule public.club_commerce_package_rules%rowtype; ord public.club_orders%rowtype; member_user uuid;
begin
  select * into rule from public.club_commerce_package_rules where commerce_product_id=new.product_id and organisation_id=new.organisation_id;
  if not found or not rule.requires_active_gym_membership then return new; end if;
  select * into ord from public.club_orders where id=new.order_id and organisation_id=new.organisation_id;
  member_user:=ord.user_id; if member_user is null and ord.customer_id is not null then select user_id into member_user from public.club_customers where id=ord.customer_id and organisation_id=ord.organisation_id; end if;
  if member_user is null or not exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.organisation_id=m.organisation_id join public.club_product_entitlements e on e.product_id=m.product_id and e.organisation_id=m.organisation_id and e.entitlement_key='gym_access' where m.organisation_id=ord.organisation_id and h.user_id=member_user and m.status='active' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())) then
    raise exception 'An active gym membership is required before buying a transformation package' using errcode='22023';
  end if; return new;
end $$;
drop trigger if exists club_service_package_membership_required on public.club_order_items;
create trigger club_service_package_membership_required before insert on public.club_order_items for each row execute function public.club_guard_service_package_purchase();

create or replace function public.club_grant_paid_transformation_package() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare rule public.club_commerce_package_rules%rowtype; item public.club_order_items%rowtype; customer public.club_customers%rowtype; finish timestamptz;
begin
  if new.payment_status not in ('paid','waived') or new.commerce_order_item_id is null then return new; end if;
  select * into item from public.club_order_items where id=new.commerce_order_item_id and organisation_id=new.organisation_id;
  select * into rule from public.club_commerce_package_rules where commerce_product_id=item.product_id and organisation_id=item.organisation_id and package_kind='transformation';
  if not found then return new; end if;
  select * into customer from public.club_customers where id=new.customer_id and organisation_id=new.organisation_id;
  if customer.user_id is null then raise exception 'A linked R12 member is required for transformation entitlements' using errcode='22023'; end if;
  finish:=now()+make_interval(days=>rule.duration_days);
  insert into public.club_entitlement_grants(user_id,organisation_id,entitlement_key,scope,allowance_quantity,allowance_period,starts_at,ends_at,source)
  select customer.user_id,new.organisation_id,x.key,'organisation',x.quantity,x.period,now(),finish,'commerce_order:'||item.order_id::text
  from (values ('enhanced_training',null::integer,null::text),('nutrition',null,null),('trainer_managed',null,null),
    ('pt_session_credit',rule.weekly_pt_quantity,'week'),('included_class_credit',rule.weekly_class_quantity,'week')) x(key,quantity,period)
  where not exists(select 1 from public.club_entitlement_grants g where g.user_id=customer.user_id and g.organisation_id=new.organisation_id and g.source='commerce_order:'||item.order_id::text and g.entitlement_key=x.key);
  return new;
end $$;
drop trigger if exists club_paid_transformation_entitlements on public.club_service_transactions;
create trigger club_paid_transformation_entitlements after insert on public.club_service_transactions for each row execute function public.club_grant_paid_transformation_package();

create or replace function public.club_membership_access_window_allows(p_membership_id uuid,p_at timestamptz default now())
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce((select case when r.product_id is null or r.access_timezone is null then true
    when exists(select 1 from public.club_entitlement_grants g where g.membership_id=p_membership_id and g.entitlement_key='off_peak_access_override'
      and g.starts_at<=p_at and (g.ends_at is null or g.ends_at>p_at)) then true
    else extract(isodow from p_at at time zone r.access_timezone)::integer=any(r.access_weekdays)
      and (p_at at time zone r.access_timezone)::time>=r.access_opens_at
      and (p_at at time zone r.access_timezone)::time<r.access_closes_at end
  from public.club_memberships m left join public.club_membership_product_rules r on r.product_id=m.product_id and r.organisation_id=m.organisation_id
  where m.id=p_membership_id),false);
$$;

-- This narrow fail-closed boundary leaves the canonical access decision engine
-- untouched. An out-of-window allow cannot be recorded or returned as an unlock.
create or replace function public.club_guard_membership_access_window() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  if new.decision='allow' and not public.club_membership_access_window_allows(new.membership_id,new.decided_at) then
    raise exception 'Membership access is outside the permitted window' using errcode='42501';
  end if; return new;
end $$;
drop trigger if exists club_membership_access_window_guard on public.club_access_decisions;
create trigger club_membership_access_window_guard before insert on public.club_access_decisions for each row execute function public.club_guard_membership_access_window();

revoke all on function public.club_guard_membership_checkout_eligibility(),public.club_guard_membership_holder_limit(),public.club_guard_service_package_purchase(),public.club_grant_paid_transformation_package(),public.club_membership_access_window_allows(uuid,timestamptz),public.club_guard_membership_access_window() from public,anon,authenticated;

commit;
