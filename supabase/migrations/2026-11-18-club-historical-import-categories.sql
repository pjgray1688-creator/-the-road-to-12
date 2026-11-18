-- Import-only categories for former memberships and passes.
-- These archived, non-sellable markers have no entitlements or billing and
-- can only be selected by the explicit member-import mapping workflow.
begin;

alter table public.club_products
  add column if not exists legacy_import_category text;

do $migration$
begin
  if not exists (select 1 from public.club_organisations where slug='madhouse-gym') then
    raise exception 'Madhouse Gym organisation is required before adding historical import categories';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.club_products'::regclass
      and conname='club_products_legacy_import_category_check'
  ) then
    alter table public.club_products
      add constraint club_products_legacy_import_category_check
      check (legacy_import_category is null or legacy_import_category in (
        'historical_membership','historical_pass','historical_classes_pass'
      ));
  end if;
end;
$migration$;

create unique index if not exists club_products_legacy_import_category_uq
  on public.club_products(organisation_id,legacy_import_category)
  where legacy_import_category is not null;

do $historical_product_guard$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.club_products'::regclass and conname='club_products_legacy_import_only_check') then
    alter table public.club_products add constraint club_products_legacy_import_only_check
      check (legacy_import_category is null or (kind='membership' and price_minor=0 and billing='manual'
        and duration_days is null and not sellable and archived_at is not null and not is_lifetime));
  end if;
end;
$historical_product_guard$;

insert into public.club_products(
  organisation_id,name,kind,price_minor,currency,billing,duration_days,
  sellable,archived_at,legacy_import_category
)
select o.id,c.name,'membership',0,'GBP','manual',null,false,now(),c.category
from public.club_organisations o
cross join (values
  ('Historical Membership','historical_membership'),
  ('Historical Pass','historical_pass'),
  ('Historical Classes Pass','historical_classes_pass')
) as c(name,category)
where o.slug='madhouse-gym'
on conflict (organisation_id,legacy_import_category)
  where legacy_import_category is not null do nothing;

comment on column public.club_products.legacy_import_category is
  'Marks archived zero-value product rows used only to classify historical ClubManager imports; never a live offer.';

create or replace function public.club_reject_historical_import_entitlement()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.club_products p where p.id=new.product_id
    and p.organisation_id=new.organisation_id and p.legacy_import_category is not null) then
    raise exception 'Historical import categories cannot grant entitlements' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function public.club_reject_historical_import_entitlement() from public,anon,authenticated;
drop trigger if exists club_reject_historical_import_entitlement on public.club_product_entitlements;
create trigger club_reject_historical_import_entitlement
before insert or update of product_id,organisation_id on public.club_product_entitlements
for each row execute function public.club_reject_historical_import_entitlement();

create or replace function public.club_reject_active_historical_import_membership()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status not in ('expired','cancelled') and exists(select 1 from public.club_products p
    where p.id=new.product_id and p.organisation_id=new.organisation_id and p.legacy_import_category is not null) then
    raise exception 'Historical import records cannot have active membership status' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function public.club_reject_active_historical_import_membership() from public,anon,authenticated;
drop trigger if exists club_reject_active_historical_import_membership on public.club_memberships;
create trigger club_reject_active_historical_import_membership
before insert or update of product_id,organisation_id,status on public.club_memberships
for each row execute function public.club_reject_active_historical_import_membership();

create or replace function public.club_reject_historical_import_billing()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.club_memberships m
    join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id
    where m.id=new.membership_id and m.organisation_id=new.organisation_id
      and p.legacy_import_category is not null) then
    raise exception 'Historical import categories cannot have recurring billing' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function public.club_reject_historical_import_billing() from public,anon,authenticated;
drop trigger if exists club_reject_historical_import_billing on public.club_membership_billing_arrangements;
create trigger club_reject_historical_import_billing
before insert or update of membership_id,organisation_id on public.club_membership_billing_arrangements
for each row execute function public.club_reject_historical_import_billing();

create or replace function public.club_capture_historical_import_source()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare source_row public.club_member_import_rows%rowtype; source_batch public.club_member_import_batches%rowtype; category text;
begin
  if new.import_row_id is null then return new; end if;
  select p.legacy_import_category into category from public.club_products p
    where p.id=new.product_id and p.organisation_id=new.organisation_id;
  if category is null then return new; end if;
  select * into source_row from public.club_member_import_rows r
    where r.id=new.import_row_id and r.organisation_id=new.organisation_id;
  if not found then return new; end if;
  select * into source_batch from public.club_member_import_batches b
    where b.id=source_row.batch_id and b.organisation_id=new.organisation_id;
  if not found then return new; end if;
  update public.club_memberships set migration_metadata=coalesce(migration_metadata,'{}'::jsonb)||jsonb_build_object(
    'source_package_name',source_row.normalized_values->>'membershipName',
    'source_status',coalesce(source_row.raw_values->>(source_batch.mapping->>'membershipStatus'),source_row.raw_values->>'membership_status',source_row.raw_values->>'status'),
    'legacy_category',category,
    'legacy_start_date',source_row.normalized_values->>'startDate',
    'legacy_expiry_date',source_row.normalized_values->>'endDate'
  ) where id=new.id and organisation_id=new.organisation_id;
  return new;
end; $$;
revoke all on function public.club_capture_historical_import_source() from public,anon,authenticated;
drop trigger if exists club_capture_historical_import_source on public.club_memberships;
create trigger club_capture_historical_import_source
after insert on public.club_memberships
for each row execute function public.club_capture_historical_import_source();

-- Preserve the currently deployed 21-column and household-aware importer RPCs.
-- Historical rows are marked expired during revalidation; shared-contract rows
-- stay reviewable because the existing household path creates billing records.
create or replace function public.club_prepare_historical_import_row()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  b public.club_member_import_batches%rowtype;
  category text;
  expiry text;
  status_value text;
  reason text;
begin
  if coalesce(new.normalized_values->>'membershipName','')='' then return new; end if;
  select p.legacy_import_category into category
  from public.club_member_import_package_mappings pm
  join public.club_products p on p.id=pm.club_product_id and p.organisation_id=pm.organisation_id
  where pm.organisation_id=new.organisation_id and pm.batch_id=new.batch_id
    and pm.status='mapped' and lower(pm.source_package)=lower(new.normalized_values->>'membershipName');
  if category is null then return new; end if;
  select * into b from public.club_member_import_batches
  where id=new.batch_id and organisation_id=new.organisation_id;
  if not found then raise exception 'Import batch is unavailable' using errcode='P0002'; end if;

  if nullif(btrim(coalesce(new.raw_values->>(b.mapping->>'householdReference'),new.raw_values->>'shared_contract_id',new.raw_values->>'household_reference')),'') is not null then
    reason:='Historical household membership requires separate billing-free review';
  end if;
  expiry:=new.normalized_values->>'endDate';
  status_value:=coalesce(new.normalized_values->>'membershipStatus','');
  if reason is null and (
    (expiry ~ '^\d{4}-\d{2}-\d{2}$' and expiry>=current_date::text)
    or (status_value not in ('expired','cancelled') and
      (expiry is null or expiry !~ '^\d{4}-\d{2}-\d{2}$' or expiry>=current_date::text))
  ) then
    reason:='Current or unexpired membership cannot be mapped to a historical category; map it to its actual live product';
  end if;

  if reason is not null then
    if not coalesce(new.blockers,'[]'::jsonb) @> jsonb_build_array(reason) then
      new.blockers:=coalesce(new.blockers,'[]'::jsonb)||jsonb_build_array(reason);
    end if;
    new.action:='invalid';
  else
    new.normalized_values:=jsonb_set(new.normalized_values,'{membershipStatus}','"expired"'::jsonb,true);
  end if;
  return new;
end; $$;
revoke all on function public.club_prepare_historical_import_row() from public,anon,authenticated;
drop trigger if exists club_prepare_historical_import_row on public.club_member_import_rows;
create trigger club_prepare_historical_import_row
before insert or update on public.club_member_import_rows
for each row execute function public.club_prepare_historical_import_row();

create or replace function public.club_map_member_import_package(
  p_organisation_id uuid,p_batch_id uuid,p_source_package text,
  p_club_product_id uuid,p_status text default 'mapped'
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_member_import_package_mappings%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then
    raise exception 'Member import is not permitted' using errcode='42501';
  end if;
  if nullif(btrim(p_source_package),'') is null or p_status not in ('mapped','manual')
     or not exists(select 1 from public.club_member_import_batches where id=p_batch_id and organisation_id=p_organisation_id) then
    raise exception 'Invalid package mapping' using errcode='22023';
  end if;
  if p_status='mapped' and not exists(
    select 1 from public.club_products p
    where p.id=p_club_product_id and p.organisation_id=p_organisation_id and p.kind='membership'
      and (
        (p.legacy_import_category is null)
        or (p.legacy_import_category is not null and p.archived_at is not null and not p.sellable
          and p.billing='manual' and p.price_minor=0 and not exists(
            select 1 from public.club_product_entitlements e
            where e.organisation_id=p.organisation_id and e.product_id=p.id
          ))
      )
  ) then
    raise exception 'Membership package is not available for import mapping' using errcode='22023';
  end if;
  insert into public.club_member_import_package_mappings(
    organisation_id,batch_id,source_package,club_product_id,status
  ) values(p_organisation_id,p_batch_id,btrim(p_source_package),p_club_product_id,p_status)
  on conflict(batch_id,source_package) do update
    set club_product_id=excluded.club_product_id,status=excluded.status
  returning * into r;
  perform public.club_revalidate_member_import_batch(p_organisation_id,p_batch_id);
  insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata)
  values(p_organisation_id,auth.uid(),'member_import.package_mapped','member_import_batch',p_batch_id,
    jsonb_build_object('source_package',p_source_package,'status',p_status));
  return to_jsonb(r);
end; $$;

revoke all on function public.club_map_member_import_package(uuid,uuid,text,uuid,text) from public,anon;
grant execute on function public.club_map_member_import_package(uuid,uuid,text,uuid,text) to authenticated;

commit;
