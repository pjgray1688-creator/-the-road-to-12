-- Manual production compatibility completion for the January 24 Madhouse
-- catalogue release after the January 25 and January 26 migrations succeeded.
--
-- Review and execute this file once in Supabase SQL Editor. Do not execute the
-- original 2027-01-24 migration afterward. This script is intentionally
-- fail-closed: it binds the confirmed existing catalogue and never creates,
-- renames, reprices or archives a product; never changes an entitlement; and
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
    ('madhouse.membership.day.v1','Gym Day Pass',500,1,false),
    ('madhouse.membership.week.v1','Week Pass',1200,1,false),
    ('madhouse.membership.unlimited.v1','Standard Monthly',2700,1,false),
    ('madhouse.membership.discount.v1','Concession Monthly',2200,1,true),
    ('madhouse.membership.yearly.v1','Yearly Membership',25000,1,false)
  ) as x(code,name,price,max_holders,verify_required)
  loop
    select count(*) into matching from public.club_products where organisation_id=org and name=item.name;
    if matching<>1 then raise exception 'Expected exactly one existing Madhouse product: %',item.name; end if;
    select * into product from public.club_products where organisation_id=org and name=item.name;
    if product.price_minor<>item.price or product.currency<>'GBP' or product.archived_at is not null then
      raise exception 'Existing Madhouse product does not match its authorised catalogue definition: %',item.name;
    end if;
    insert into public.club_membership_product_rules(
      product_id,organisation_id,catalogue_code,maximum_holders,shared_membership,
      eligibility_verification_required,access_timezone,access_weekdays,access_opens_at,access_closes_at
    ) values(
      product.id,org,item.code,item.max_holders,false,item.verify_required,null,null,null,null
    ) on conflict(product_id) do update set
      catalogue_code=excluded.catalogue_code,
      maximum_holders=excluded.maximum_holders,
      shared_membership=false,
      eligibility_verification_required=excluded.eligibility_verification_required,
      updated_at=now();
  end loop;

  if not exists(
    select 1 from public.club_products p
    join public.club_membership_product_rules r on r.product_id=p.id and r.organisation_id=p.organisation_id
    where p.id='892195bf-2f53-4580-ad9d-108effbce011' and p.organisation_id=org
      and p.name='Couples Membership' and p.price_minor=4500 and p.currency='GBP' and p.archived_at is null
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

revoke all on function public.club_guard_membership_checkout_eligibility() from public,anon,authenticated;

commit;
