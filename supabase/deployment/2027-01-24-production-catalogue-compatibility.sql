-- Manual production compatibility completion for the January 24 Madhouse
-- catalogue release after the January 25 and January 26 migrations succeeded.
--
-- Review and execute this file once in Supabase SQL Editor. Do not execute the
-- original 2027-01-24 migration afterward. This script is intentionally
-- fail-closed: it validates the existing catalogue and never creates, renames,
-- reprices or archives a product; never changes an existing entitlement; and
-- never touches memberships, contracts, billing, access grants or providers.

begin;

select pg_advisory_xact_lock(hashtextextended('r12:madhouse-catalogue-compatibility:2027-01-24',0));

do $$
begin
  if to_regclass('public.club_membership_product_rules') is null then
    raise exception 'club_membership_product_rules is missing; January 25 is not installed';
  end if;
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='club_membership_product_rules' and column_name='shared_membership'
  ) then
    raise exception 'club_membership_product_rules.shared_membership is missing; January 25 is incomplete';
  end if;
end $$;

create table if not exists public.club_membership_eligibility_verifications (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  join_request_id uuid not null,
  product_id uuid not null,
  customer_id uuid not null,
  status text not null check(status in ('approved','rejected')),
  evidence_note text not null check(char_length(btrim(evidence_note)) between 3 and 500),
  verified_by uuid not null references auth.users(id),
  verified_at timestamptz not null default now(),
  unique(organisation_id,join_request_id),
  foreign key(join_request_id,organisation_id) references public.club_membership_join_requests(id,organisation_id) on delete restrict,
  foreign key(product_id,organisation_id) references public.club_products(id,organisation_id) on delete restrict,
  foreign key(customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete restrict
);
alter table public.club_membership_eligibility_verifications enable row level security;
revoke all on public.club_membership_eligibility_verifications from public,anon,authenticated;

-- Bind only exact, already-existing membership products. Any missing, duplicate
-- or drifted catalogue row aborts the whole transaction without changing data.
do $$
declare
  org uuid;
  item record;
  product public.club_products%rowtype;
  matching integer;
begin
  select id into org from public.club_organisations where slug='madhouse-gym';
  if org is null then raise exception 'Madhouse organisation is missing'; end if;

  for item in select * from (values
    ('madhouse.membership.day.v1','Day Pass',500,'one_off',1,1,false,null::text,null::integer[],null::time,null::time),
    ('madhouse.membership.week.v1','1 Week Pass',1200,'one_off',7,1,false,null,null,null,null),
    ('madhouse.membership.unlimited.v1','Unlimited Gym',2700,'recurring',null,1,false,null,null,null,null),
    ('madhouse.membership.off-peak.v1','Off Peak',1499,'recurring',null,1,false,'Europe/London',array[1,2,3,4,5],'10:00'::time,'15:00'::time),
    ('madhouse.membership.discount.v1','Unlimited Gym Discount',2200,'recurring',null,1,true,null,null,null,null),
    ('madhouse.membership.yearly.v1','Yearly Membership',27500,'one_off',365,1,false,null,null,null,null)
  ) as x(code,name,price,billing,duration,max_holders,verify_required,tz,weekdays,opens,closes)
  loop
    select count(*) into matching from public.club_products where organisation_id=org and name=item.name;
    if matching<>1 then raise exception 'Expected exactly one existing Madhouse product: %',item.name; end if;
    select * into product from public.club_products where organisation_id=org and name=item.name;
    if product.kind<>'membership' or product.price_minor<>item.price or product.currency<>'GBP'
      or product.billing<>item.billing or product.duration_days is distinct from item.duration
      or not product.sellable or product.archived_at is not null then
      raise exception 'Existing Madhouse product does not match its authorised catalogue definition: %',item.name;
    end if;
    if not exists(
      select 1 from public.club_product_entitlements e
      where e.product_id=product.id and e.organisation_id=org and e.entitlement_key='gym_access' and e.scope='future_locations'
    ) then
      raise exception 'Existing Madhouse product is missing its approved both-gym entitlement: %',item.name;
    end if;
    insert into public.club_membership_product_rules(
      product_id,organisation_id,catalogue_code,maximum_holders,shared_membership,
      eligibility_verification_required,access_timezone,access_weekdays,access_opens_at,access_closes_at
    ) values(
      product.id,org,item.code,item.max_holders,false,item.verify_required,item.tz,item.weekdays,item.opens,item.closes
    ) on conflict(product_id) do update set
      catalogue_code=excluded.catalogue_code,
      maximum_holders=excluded.maximum_holders,
      shared_membership=false,
      eligibility_verification_required=excluded.eligibility_verification_required,
      access_timezone=excluded.access_timezone,
      access_weekdays=excluded.access_weekdays,
      access_opens_at=excluded.access_opens_at,
      access_closes_at=excluded.access_closes_at,
      updated_at=now();
  end loop;

  if not exists(
    select 1 from public.club_products p
    join public.club_membership_product_rules r on r.product_id=p.id and r.organisation_id=p.organisation_id
    where p.id='892195bf-2f53-4580-ad9d-108effbce011' and p.organisation_id=org
      and p.name='Couples Membership' and p.kind='membership' and p.price_minor=4500
      and p.currency='GBP' and p.billing='recurring' and p.sellable and p.archived_at is null
      and r.catalogue_code='madhouse.membership.couple.v1' and r.maximum_holders=2 and r.shared_membership
  ) then raise exception 'The authorised production Couples Membership binding is missing or drifted'; end if;

  if not exists(
    select 1 from public.club_products p
    join public.club_membership_product_rules r on r.product_id=p.id and r.organisation_id=p.organisation_id
    where p.organisation_id=org and p.name='Family Membership' and p.kind='membership'
      and p.currency='GBP' and p.billing='recurring' and not p.sellable and p.pricing_on_request
      and p.archived_at is null and r.catalogue_code='madhouse.membership.family.v1'
      and r.maximum_holders is null and r.shared_membership
  ) then raise exception 'The production Family Membership binding is missing or drifted'; end if;
end $$;

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

-- Service-package rows must already exist with their authorised identity and
-- prices. Only the enforcement metadata is installed here.
do $$
declare org uuid; item record; product public.club_commerce_products%rowtype; matching integer;
begin
  select id into org from public.club_organisations where slug='madhouse-gym';
  for item in select * from (values
    ('MH-SVC-TRANS-BRONZE','Transformation Bronze',25000,'transformation',70,1,1),
    ('MH-SVC-TRANS-SILVER','Transformation Silver',40000,'transformation',70,2,1),
    ('MH-SVC-TRANS-GOLD','Transformation Gold',52500,'transformation',70,3,1),
    ('MH-SVC-PT-10','10 PT Session Block',20000,'pt_block',null::integer,null::integer,null::integer)
  ) as x(sku,name,price,kind,duration,pt_week,class_week)
  loop
    select count(*) into matching from public.club_commerce_products where organisation_id=org and sku=item.sku;
    if matching<>1 then raise exception 'Expected exactly one existing Madhouse commerce product: %',item.sku; end if;
    select * into product from public.club_commerce_products where organisation_id=org and sku=item.sku;
    if product.name<>item.name or product.sell_price_minor<>item.price or product.currency<>'GBP'
      or product.category<>'Services' or not product.active or product.stock_tracked
      or product.service_id is null or product.stripe_merchant_entity<>'madhouse_products_services' then
      raise exception 'Existing Madhouse commerce product does not match its authorised catalogue definition: %',item.sku;
    end if;
    insert into public.club_commerce_package_rules(
      commerce_product_id,organisation_id,package_kind,duration_days,weekly_pt_quantity,
      weekly_class_quantity,requires_active_gym_membership
    ) values(
      product.id,org,item.kind,item.duration,item.pt_week,item.class_week,item.kind='transformation'
    ) on conflict(commerce_product_id) do update set
      package_kind=excluded.package_kind,
      duration_days=excluded.duration_days,
      weekly_pt_quantity=excluded.weekly_pt_quantity,
      weekly_class_quantity=excluded.weekly_class_quantity,
      requires_active_gym_membership=excluded.requires_active_gym_membership;
  end loop;
end $$;

create or replace function public.club_verify_membership_eligibility(
  p_organisation_id uuid,p_join_request_id uuid,p_status text,p_evidence_note text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; v public.club_membership_eligibility_verifications%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.assign') then
    raise exception 'Eligibility verification is not permitted' using errcode='42501';
  end if;
  if p_status not in ('approved','rejected') or char_length(btrim(coalesce(p_evidence_note,''))) not between 3 and 500 then
    raise exception 'Record a valid decision and evidence note' using errcode='22023';
  end if;
  select * into r from public.club_membership_join_requests
    where id=p_join_request_id and organisation_id=p_organisation_id for update;
  if not found or r.membership_id is not null or r.status in ('payment_pending','active','completed','cancelled') then
    raise exception 'Joining request is not available' using errcode='P0002';
  end if;
  if not exists(
    select 1 from public.club_membership_product_rules
    where product_id=r.product_id and organisation_id=r.organisation_id and eligibility_verification_required
  ) then raise exception 'This membership does not require eligibility verification' using errcode='22023'; end if;
  insert into public.club_membership_eligibility_verifications(
    organisation_id,join_request_id,product_id,customer_id,status,evidence_note,verified_by
  ) values(r.organisation_id,r.id,r.product_id,r.customer_id,p_status,btrim(p_evidence_note),auth.uid())
  on conflict(organisation_id,join_request_id) do update set
    status=excluded.status,evidence_note=excluded.evidence_note,verified_by=auth.uid(),verified_at=now()
  returning * into v;
  return to_jsonb(v);
end $$;
revoke all on function public.club_verify_membership_eligibility(uuid,uuid,text,text) from public,anon;
grant execute on function public.club_verify_membership_eligibility(uuid,uuid,text,text) to authenticated;

create or replace function public.club_guard_membership_checkout_eligibility() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status='payment_pending' and old.status is distinct from new.status
    and exists(select 1 from public.club_membership_product_rules r where r.product_id=new.product_id and r.organisation_id=new.organisation_id and r.eligibility_verification_required)
    and not exists(select 1 from public.club_membership_eligibility_verifications v where v.organisation_id=new.organisation_id and v.join_request_id=new.id and v.status='approved')
  then raise exception 'Membership eligibility must be verified before checkout' using errcode='22023'; end if;
  return new;
end $$;
drop trigger if exists club_membership_checkout_eligibility on public.club_membership_join_requests;
create trigger club_membership_checkout_eligibility before update of status on public.club_membership_join_requests
  for each row execute function public.club_guard_membership_checkout_eligibility();

create or replace function public.club_guard_service_package_purchase() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare rule public.club_commerce_package_rules%rowtype; ord public.club_orders%rowtype; member_user uuid;
begin
  select * into rule from public.club_commerce_package_rules where commerce_product_id=new.product_id and organisation_id=new.organisation_id;
  if not found or not rule.requires_active_gym_membership then return new; end if;
  select * into ord from public.club_orders where id=new.order_id and organisation_id=new.organisation_id;
  member_user:=ord.user_id;
  if member_user is null and ord.customer_id is not null then
    select user_id into member_user from public.club_customers where id=ord.customer_id and organisation_id=ord.organisation_id;
  end if;
  if member_user is null or not exists(
    select 1 from public.club_memberships m
    join public.club_membership_holders h on h.membership_id=m.id and h.organisation_id=m.organisation_id
    join public.club_product_entitlements e on e.product_id=m.product_id and e.organisation_id=m.organisation_id and e.entitlement_key='gym_access'
    where m.organisation_id=ord.organisation_id and h.user_id=member_user and m.status='active'
      and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())
  ) then raise exception 'An active gym membership is required before buying a transformation package' using errcode='22023'; end if;
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
  select * into item from public.club_order_items where id=new.commerce_order_item_id and organisation_id=new.organisation_id;
  select * into rule from public.club_commerce_package_rules where commerce_product_id=item.product_id and organisation_id=item.organisation_id and package_kind='transformation';
  if not found then return new; end if;
  select * into customer from public.club_customers where id=new.customer_id and organisation_id=new.organisation_id;
  if customer.user_id is null then raise exception 'A linked R12 member is required for transformation entitlements' using errcode='22023'; end if;
  finish:=now()+make_interval(days=>rule.duration_days);
  insert into public.club_entitlement_grants(
    user_id,organisation_id,entitlement_key,scope,allowance_quantity,allowance_period,starts_at,ends_at,source
  ) select customer.user_id,new.organisation_id,x.key,'organisation',x.quantity,x.period,now(),finish,'commerce_order:'||item.order_id::text
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

create or replace function public.club_membership_access_window_allows(
  p_membership_id uuid,p_at timestamptz default now()
) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce((select case when r.product_id is null or r.access_timezone is null then true
    when exists(select 1 from public.club_entitlement_grants g where g.membership_id=p_membership_id and g.entitlement_key='off_peak_access_override'
      and g.starts_at<=p_at and (g.ends_at is null or g.ends_at>p_at)) then true
    else extract(isodow from p_at at time zone r.access_timezone)::integer=any(r.access_weekdays)
      and (p_at at time zone r.access_timezone)::time>=r.access_opens_at
      and (p_at at time zone r.access_timezone)::time<r.access_closes_at end
  from public.club_memberships m left join public.club_membership_product_rules r
    on r.product_id=m.product_id and r.organisation_id=m.organisation_id
  where m.id=p_membership_id),false);
$$;

create or replace function public.club_guard_membership_access_window() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.decision='allow' and not public.club_membership_access_window_allows(new.membership_id,new.decided_at) then
    raise exception 'Membership access is outside the permitted window' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists club_membership_access_window_guard on public.club_access_decisions;
create trigger club_membership_access_window_guard before insert on public.club_access_decisions
  for each row execute function public.club_guard_membership_access_window();

revoke all on function public.club_guard_membership_checkout_eligibility(),
  public.club_guard_service_package_purchase(),
  public.club_grant_paid_transformation_package(),
  public.club_membership_access_window_allows(uuid,timestamptz),
  public.club_guard_membership_access_window()
from public,anon,authenticated;

commit;
