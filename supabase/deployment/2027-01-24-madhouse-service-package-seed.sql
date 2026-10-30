-- Manual, idempotent seed for the four approved Madhouse service packages.
-- Production currently has no matching club_commerce_products rows because the
-- January 24 catalogue migration was never applied. This script creates only
-- catalogue/service definitions and their enforcement metadata. It creates no
-- order, checkout, payment, provider object, membership or entitlement grant.

begin;

select pg_advisory_xact_lock(hashtextextended('r12:madhouse-service-package-seed:2027-01-24',0));

create table if not exists public.club_commerce_package_rules (
  commerce_product_id uuid primary key,
  organisation_id uuid not null,
  package_kind text not null check(package_kind in ('transformation','pt_block')),
  duration_days integer,
  weekly_pt_quantity integer,
  weekly_class_quantity integer,
  requires_active_gym_membership boolean not null default false,
  foreign key(commerce_product_id,organisation_id) references public.club_commerce_products(id,organisation_id) on delete restrict,
  check((package_kind='transformation' and duration_days=70 and weekly_pt_quantity between 1 and 3
      and weekly_class_quantity=1 and requires_active_gym_membership)
    or (package_kind='pt_block' and duration_days is null and weekly_pt_quantity is null
      and weekly_class_quantity is null and not requires_active_gym_membership))
);
alter table public.club_commerce_package_rules enable row level security;
revoke all on public.club_commerce_package_rules from public,anon,authenticated;

do $$
declare
  org uuid;
  item record;
  service public.club_services%rowtype;
  product public.club_commerce_products%rowtype;
  matching integer;
begin
  select id into org from public.club_organisations where slug='madhouse-gym';
  if org is null then raise exception 'Madhouse organisation is missing'; end if;

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
    select count(*) into matching from public.club_services
      where organisation_id=org and location_id is null and name=item.name;
    if matching>1 then raise exception 'Duplicate Madhouse service: %',item.name; end if;
    if matching=0 then
      insert into public.club_services(
        organisation_id,location_id,name,description,category,price_minor,currency,active,
        package_credit_quantity,package_validity_days
      ) values(org,null,item.name,item.description,'Services',item.price,'GBP',true,item.block_credit,null)
      returning * into service;
    else
      select * into service from public.club_services
        where organisation_id=org and location_id is null and name=item.name;
      if service.price_minor<>item.price or service.currency<>'GBP' or service.category<>'Services'
        or not service.active or service.package_credit_quantity is distinct from item.block_credit
        or service.package_validity_days is not null then
        raise exception 'Existing Madhouse service does not match the approved definition: %',item.name;
      end if;
    end if;

    select count(*) into matching from public.club_commerce_products
      where organisation_id=org and (sku=item.sku or name=item.name);
    if matching>1 then raise exception 'Ambiguous Madhouse commerce product: %',item.name; end if;
    if matching=0 then
      insert into public.club_commerce_products(
        organisation_id,sku,name,description,category,active,stock_tracked,sell_price_minor,
        currency,media,sales_channels,unit_label,service_id,service_credit_quantity,
        service_validity_days,stripe_merchant_entity
      ) values(
        org,item.sku,item.name,item.description,'Services',true,false,item.price,'GBP',
        jsonb_build_object('placeholder','madhouse-approved-service'),array['pos','online'],'package',
        service.id,item.block_credit,null,'madhouse_products_services'
      ) returning * into product;
    else
      select * into product from public.club_commerce_products
        where organisation_id=org and (sku=item.sku or name=item.name);
      if product.sku is distinct from item.sku or product.name<>item.name
        or product.sell_price_minor<>item.price or product.currency<>'GBP'
        or product.category<>'Services' or not product.active or product.stock_tracked
        or product.service_id<>service.id or product.service_credit_quantity is distinct from item.block_credit
        or product.service_validity_days is not null
        or product.stripe_merchant_entity<>'madhouse_products_services' then
        raise exception 'Existing Madhouse commerce product does not match the approved definition: %',item.sku;
      end if;
    end if;

    insert into public.club_commerce_package_rules(
      commerce_product_id,organisation_id,package_kind,duration_days,weekly_pt_quantity,
      weekly_class_quantity,requires_active_gym_membership
    ) values(product.id,org,item.kind,item.duration,item.pt_week,item.class_week,item.kind='transformation')
    on conflict(commerce_product_id) do nothing;

    if not exists(
      select 1 from public.club_commerce_package_rules r
      where r.commerce_product_id=product.id and r.organisation_id=org
        and r.package_kind=item.kind and r.duration_days is not distinct from item.duration
        and r.weekly_pt_quantity is not distinct from item.pt_week
        and r.weekly_class_quantity is not distinct from item.class_week
        and r.requires_active_gym_membership=(item.kind='transformation')
    ) then raise exception 'Existing Madhouse package rule does not match the approved definition: %',item.sku; end if;
  end loop;
end $$;

create or replace function public.club_guard_service_package_purchase() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare rule public.club_commerce_package_rules%rowtype; ord public.club_orders%rowtype; member_user uuid;
begin
  select * into rule from public.club_commerce_package_rules
    where commerce_product_id=new.product_id and organisation_id=new.organisation_id;
  if not found or not rule.requires_active_gym_membership then return new; end if;
  select * into ord from public.club_orders where id=new.order_id and organisation_id=new.organisation_id;
  member_user:=ord.user_id;
  if member_user is null and ord.customer_id is not null then
    select user_id into member_user from public.club_customers
      where id=ord.customer_id and organisation_id=ord.organisation_id;
  end if;
  if member_user is null or not exists(
    select 1 from public.club_memberships m
    join public.club_membership_holders h on h.membership_id=m.id and h.organisation_id=m.organisation_id
    join public.club_product_entitlements e on e.product_id=m.product_id
      and e.organisation_id=m.organisation_id and e.entitlement_key='gym_access'
    where m.organisation_id=ord.organisation_id and h.user_id=member_user and m.status='active'
      and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())
  ) then
    raise exception 'An active gym membership is required before buying a transformation package' using errcode='22023';
  end if;
  return new;
end $$;
drop trigger if exists club_service_package_membership_required on public.club_order_items;
create trigger club_service_package_membership_required before insert on public.club_order_items
  for each row execute function public.club_guard_service_package_purchase();

create or replace function public.club_grant_paid_transformation_package() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare rule public.club_commerce_package_rules%rowtype; item public.club_order_items%rowtype; customer public.club_customers%rowtype; finish timestamptz;
begin
  if new.payment_status not in ('paid','waived') or new.commerce_order_item_id is null then return new; end if;
  select * into item from public.club_order_items
    where id=new.commerce_order_item_id and organisation_id=new.organisation_id;
  select * into rule from public.club_commerce_package_rules
    where commerce_product_id=item.product_id and organisation_id=item.organisation_id and package_kind='transformation';
  if not found then return new; end if;
  select * into customer from public.club_customers
    where id=new.customer_id and organisation_id=new.organisation_id;
  if customer.user_id is null then
    raise exception 'A linked R12 member is required for transformation entitlements' using errcode='22023';
  end if;
  finish:=now()+make_interval(days=>rule.duration_days);
  insert into public.club_entitlement_grants(
    user_id,organisation_id,entitlement_key,scope,allowance_quantity,allowance_period,starts_at,ends_at,source
  ) select customer.user_id,new.organisation_id,x.key,'organisation',x.quantity,x.period,now(),finish,
      'commerce_order:'||item.order_id::text
    from (values
      ('enhanced_training',null::integer,null::text),('nutrition',null,null),('trainer_managed',null,null),
      ('pt_session_credit',rule.weekly_pt_quantity,'week'),('included_class_credit',rule.weekly_class_quantity,'week')
    ) x(key,quantity,period)
    where not exists(
      select 1 from public.club_entitlement_grants g
      where g.user_id=customer.user_id and g.organisation_id=new.organisation_id
        and g.source='commerce_order:'||item.order_id::text and g.entitlement_key=x.key
    );
  return new;
end $$;
drop trigger if exists club_paid_transformation_entitlements on public.club_service_transactions;
create trigger club_paid_transformation_entitlements after insert on public.club_service_transactions
  for each row execute function public.club_grant_paid_transformation_package();

revoke all on function public.club_guard_service_package_purchase(),
  public.club_grant_paid_transformation_package()
from public,anon,authenticated;

commit;
