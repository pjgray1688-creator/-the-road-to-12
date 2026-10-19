-- Madhouse Golden Ticket memberships are lifetime, non-billing memberships.
-- Keep legacy source expiry evidence, but never use it as the effective end.

alter table public.club_products
  add column if not exists is_lifetime boolean not null default false;

alter table public.club_products
  drop constraint if exists club_products_lifetime_billing_check;
alter table public.club_products
  add constraint club_products_lifetime_billing_check
  check (not is_lifetime or (billing='one_off' and duration_days is null));

create or replace function public.club_enforce_golden_ticket_lifetime_product()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.club_organisations o where o.id=new.organisation_id and o.slug='madhouse-gym')
     and new.name='Golden Ticket Founding Membership' then
    new.is_lifetime:=true;
    new.billing:='one_off';
    new.duration_days:=null;
    new.sellable:=false;
  end if;
  if new.is_lifetime and (new.billing<>'one_off' or new.duration_days is not null) then
    raise exception 'Lifetime Club products must be one-off and have no fixed duration' using errcode='22023';
  end if;
  return new;
end; $$;
revoke all on function public.club_enforce_golden_ticket_lifetime_product() from public,anon,authenticated;
drop trigger if exists club_golden_ticket_lifetime_product on public.club_products;
create trigger club_golden_ticket_lifetime_product
before insert or update of organisation_id,name,billing,duration_days,is_lifetime,sellable
on public.club_products for each row
execute function public.club_enforce_golden_ticket_lifetime_product();

-- Correct only the canonical Madhouse product. Its existing entitlement rows,
-- including the founding discount and future_locations gym access, are retained.
update public.club_products p
set is_lifetime=true,billing='one_off',duration_days=null,sellable=false
from public.club_organisations o
where o.id=p.organisation_id and o.slug='madhouse-gym'
  and p.name='Golden Ticket Founding Membership';

-- Club Manager exports may contain artificial or locale-formatted expiry
-- strings. Once staff explicitly map that exact source package to a database
-- lifetime product, expiry validation is evidence-only and cannot block the
-- row or become an effective entitlement date.
create or replace function public.club_allow_lifetime_import_expiry_evidence()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.normalized_values->>'endDate' is not null and exists(
    select 1
    from public.club_member_import_package_mappings pm
    join public.club_products p on p.id=pm.club_product_id and p.organisation_id=pm.organisation_id
    where pm.batch_id=new.batch_id and pm.organisation_id=new.organisation_id and pm.status='mapped'
      and lower(pm.source_package)=lower(new.normalized_values->>'membershipName') and p.is_lifetime
  ) then
    new.blockers:=coalesce(new.blockers,'[]'::jsonb)
      - 'End date must be YYYY-MM-DD' - 'End date is invalid' - 'End date cannot be before start date';
  end if;
  return new;
end; $$;
revoke all on function public.club_allow_lifetime_import_expiry_evidence() from public,anon,authenticated;
drop trigger if exists club_lifetime_import_expiry_evidence on public.club_member_import_rows;
create trigger club_lifetime_import_expiry_evidence
before update of normalized_values,blockers on public.club_member_import_rows
for each row execute function public.club_allow_lifetime_import_expiry_evidence();

-- Revalidate immediately after staff explicitly map a source package. This
-- lets a Golden Ticket row with a locale-formatted artificial expiry become
-- reviewable before the UI's valid-row authorization step, without importing
-- or authorizing it automatically.
create or replace function public.club_revalidate_import_after_package_mapping()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status='mapped' then
    perform public.club_revalidate_member_import_batch(new.organisation_id,new.batch_id);
  end if;
  return new;
end; $$;
revoke all on function public.club_revalidate_import_after_package_mapping() from public,anon,authenticated;
drop trigger if exists club_revalidate_after_package_mapping on public.club_member_import_package_mappings;
create trigger club_revalidate_after_package_mapping
after insert or update of club_product_id,status on public.club_member_import_package_mappings
for each row execute function public.club_revalidate_import_after_package_mapping();

-- Do not proceed if a live R12 billing schedule or unresolved obligation is
-- attached to Golden Ticket. Preserve evidence and require a reviewed resolution.
do $golden_billing_preflight$
declare active_arrangements integer; open_obligations integer;
begin
  select count(*)::integer into active_arrangements
  from public.club_membership_billing_arrangements a
  join public.club_memberships m on m.id=a.membership_id and m.organisation_id=a.organisation_id
  join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id
  where p.is_lifetime and a.state='active';
  select count(*)::integer into open_obligations
  from public.club_membership_billing_obligations b
  join public.club_memberships m on m.id=b.membership_id and m.organisation_id=b.organisation_id
  join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id
  where p.is_lifetime and b.state not in ('paid','recovered','cancelled','waived');
  if active_arrangements>0 or open_obligations>0 then
    raise exception 'Golden Ticket lifetime migration stopped: % active billing arrangements and % open obligations require reviewed resolution',active_arrangements,open_obligations
      using errcode='55000';
  end if;
end;
$golden_billing_preflight$;

create or replace function public.club_enforce_lifetime_membership_expiry()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare lifetime_product boolean;
begin
  select p.is_lifetime into lifetime_product
  from public.club_products p
  where p.id=new.product_id and p.organisation_id=new.organisation_id;
  if coalesce(lifetime_product,false) then
    if new.ends_at is not null then
      new.migration_metadata:=coalesce(new.migration_metadata,'{}'::jsonb)||jsonb_build_object(
        'lifetime_expiry_input_at',new.ends_at,
        'lifetime_expiry_normalized_at',now()
      );
    end if;
    new.ends_at:=null;
  end if;
  return new;
end; $$;
revoke all on function public.club_enforce_lifetime_membership_expiry() from public,anon,authenticated;
drop trigger if exists club_lifetime_membership_expiry on public.club_memberships;
create trigger club_lifetime_membership_expiry
before insert or update of product_id,ends_at on public.club_memberships
for each row execute function public.club_enforce_lifetime_membership_expiry();

-- Preserve artificial legacy expiry in immutable import provenance while making
-- membership and matching materialised entitlement validity truly open-ended.
with legacy_expiries as (
  select m.id,m.ends_at
  from public.club_memberships m
  join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id
  where p.is_lifetime and m.ends_at is not null
)
update public.club_entitlement_grants g
set ends_at=null
from legacy_expiries e
where g.membership_id=e.id and g.ends_at=e.ends_at;

update public.club_memberships m
set ends_at=null,
    migration_metadata=coalesce(m.migration_metadata,'{}'::jsonb)||jsonb_build_object(
      'legacy_expiry_at',m.ends_at,
      'lifetime_expiry_normalized_at',now()
    )
from public.club_products p
where p.id=m.product_id and p.organisation_id=m.organisation_id
  and p.is_lifetime and m.ends_at is not null;

create or replace function public.club_reject_lifetime_billing_arrangement()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.club_memberships m join public.club_products p
      on p.id=m.product_id and p.organisation_id=m.organisation_id
      where m.id=new.membership_id and m.organisation_id=new.organisation_id and p.is_lifetime) then
    raise exception 'Golden Ticket lifetime memberships cannot have billing arrangements' using errcode='22023';
  end if;
  return new;
end; $$;
revoke all on function public.club_reject_lifetime_billing_arrangement() from public,anon,authenticated;
drop trigger if exists club_reject_lifetime_billing_arrangement on public.club_membership_billing_arrangements;
create trigger club_reject_lifetime_billing_arrangement
before insert or update of membership_id,organisation_id,frequency,provider_type,payment_method_family,state
on public.club_membership_billing_arrangements for each row
execute function public.club_reject_lifetime_billing_arrangement();

create or replace function public.club_reject_lifetime_billing_obligation()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.club_memberships m join public.club_products p
      on p.id=m.product_id and p.organisation_id=m.organisation_id
      where m.id=new.membership_id and m.organisation_id=new.organisation_id and p.is_lifetime) then
    raise exception 'Golden Ticket lifetime memberships cannot have billing obligations' using errcode='22023';
  end if;
  return new;
end; $$;
revoke all on function public.club_reject_lifetime_billing_obligation() from public,anon,authenticated;
drop trigger if exists club_reject_lifetime_billing_obligation on public.club_membership_billing_obligations;
create trigger club_reject_lifetime_billing_obligation
before insert or update of membership_id,organisation_id,arrangement_id,frequency
on public.club_membership_billing_obligations for each row
execute function public.club_reject_lifetime_billing_obligation();

-- Retain the established import identity/reconciliation flow. Only an explicit
-- package mapping to a database-marked lifetime product activates this rule.
create or replace function public.club_execute_member_import_batch(p_organisation_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_member_import_batches%rowtype; r record; c public.club_customers%rowtype; u uuid; ref text; product uuid;
  product_is_lifetime boolean; ms public.club_memberships%rowtype; ms_status text; start_at timestamptz; end_at timestamptz;
  legacy_expiry_date text; made integer:=0; linked integer:=0; skipped integer:=0; failed integer:=0; was_linked boolean;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then raise exception 'Member import is not permitted' using errcode='42501'; end if;
 select * into b from public.club_member_import_batches where id=p_batch_id and organisation_id=p_organisation_id for update;
 if not found or b.status not in ('ready','importing') then raise exception 'Batch is not ready to import' using errcode='22023'; end if;
 update public.club_member_import_batches set status='importing',import_started_at=coalesce(import_started_at,now()) where id=b.id;
 for r in select * from public.club_member_import_rows where batch_id=b.id and jsonb_array_length(blockers)=0 order by source_row_number for update loop
  begin
   if r.outcome in ('imported','linked','skipped_existing') then skipped:=skipped+1; continue; end if;
   c:=null; u:=r.matched_user_id; ref:=r.normalized_values->>'legacyReference'; was_linked:=false;
   if r.imported_customer_id is not null then select * into c from public.club_customers where id=r.imported_customer_id and organisation_id=p_organisation_id for update; end if;
   if c.id is null then insert into public.club_customers(organisation_id,user_id,display_name,email,phone,status) values(p_organisation_id,u,coalesce(nullif(r.normalized_values->>'fullName',''),nullif(concat_ws(' ',r.normalized_values->>'firstName',r.normalized_values->>'lastName'),''),'Imported member'),r.normalized_values->>'email',r.normalized_values->>'phone','member') returning * into c; made:=made+1;
   else linked:=linked+1; was_linked:=true; if c.user_id is null and u is not null then update public.club_customers set user_id=u,updated_at=now() where id=c.id and user_id is null returning * into c; end if; end if;
   if u is not null then insert into public.club_members(organisation_id,user_id,role,active) values(p_organisation_id,u,'member',true) on conflict(organisation_id,user_id) do nothing; end if;
   if ref is not null then
    insert into public.club_member_import_identities(organisation_id,source_system,source_member_reference,customer_id,first_seen_batch_id)
    values(p_organisation_id,'clubmanager',ref,c.id,b.id)
    on conflict(organisation_id,source_system,source_member_reference) do update set customer_id=excluded.customer_id where club_member_import_identities.customer_id=excluded.customer_id;
    if exists(select 1 from public.club_access_credentials where organisation_id=p_organisation_id and credential_hash=extensions.digest(lower(btrim(ref)),'sha256') and customer_id<>c.id) then raise exception 'Credential is already assigned to another member' using errcode='23505'; end if;
    insert into public.club_access_credentials(organisation_id,customer_id,credential_type,credential_hash,display_suffix)
    values(p_organisation_id,c.id,'legacy_member_reference',extensions.digest(lower(btrim(ref)),'sha256'),right(ref,4)) on conflict(organisation_id,credential_hash) do nothing;
   end if;
   if r.normalized_values->>'membershipName' is not null then
    select club_product_id into product from public.club_member_import_package_mappings where batch_id=b.id and lower(source_package)=lower(r.normalized_values->>'membershipName') and status='mapped';
    select p.is_lifetime into product_is_lifetime from public.club_products p where p.id=product and p.organisation_id=p_organisation_id;
    ms_status:=coalesce(r.normalized_values->>'membershipStatus','expired');
    start_at:=coalesce((r.normalized_values->>'startDate')::date::timestamptz,b.created_at);
    legacy_expiry_date:=r.normalized_values->>'endDate';
    end_at:=case when coalesce(product_is_lifetime,false) or legacy_expiry_date is null then null else legacy_expiry_date::date::timestamptz+interval '1 day' end;
    if not coalesce(product_is_lifetime,false) and end_at is not null and end_at<=now() then ms_status:='expired'; end if;
    insert into public.club_memberships(organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key,import_batch_id,import_row_id,migration_metadata)
    values(p_organisation_id,product,ms_status,start_at,end_at,'legacy_import','member-import:'||r.id,b.id,r.id,
      jsonb_build_object('source_system','clubmanager','billing_evidence','not_imported','source_status',r.normalized_values->>'membershipStatus',
        'billing_method_label',r.normalized_values->>'billingMethod',
        'legacy_expiry_date',case when coalesce(product_is_lifetime,false) then legacy_expiry_date else null end,
        'expiry_policy',case when coalesce(product_is_lifetime,false) then 'lifetime_no_effective_expiry' else null end))
    on conflict(organisation_id,assignment_idempotency_key) do nothing returning * into ms;
    if ms.id is null then select * into ms from public.club_memberships where organisation_id=p_organisation_id and assignment_idempotency_key='member-import:'||r.id; end if;
    if u is null then insert into public.club_membership_holders(membership_id,organisation_id,customer_id) values(ms.id,p_organisation_id,c.id) on conflict do nothing;
    else
     insert into public.club_membership_holders(membership_id,organisation_id,user_id) values(ms.id,p_organisation_id,u) on conflict do nothing;
     insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
     select u,p_organisation_id,ms.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,start_at,end_at,'legacy_import'
     from public.club_product_entitlements e where e.product_id=product and ms_status='active' on conflict do nothing;
    end if;
   end if;
   update public.club_member_import_rows set imported_customer_id=c.id,imported_membership_id=ms.id,outcome=case when was_linked then 'linked' else 'imported' end,updated_at=now() where id=r.id;
  exception when others then failed:=failed+1; update public.club_member_import_rows set outcome='rejected',blockers=blockers||jsonb_build_array('Import failed safely; review this row'),updated_at=now() where id=r.id; end;
 end loop;
 update public.club_member_import_rows set outcome='rejected' where batch_id=b.id and jsonb_array_length(blockers)>0 and outcome is null;
 update public.club_member_import_batches set status='completed',completed_at=now(),imported_count=made,linked_count=linked,skipped_count=skipped,rejected_count=(select count(*) from public.club_member_import_rows where batch_id=b.id and outcome='rejected'),failed_count=failed,updated_at=now() where id=b.id returning * into b;
 insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),'member_import.completed','member_import_batch',b.id,jsonb_build_object('imported',made,'linked',linked,'skipped',skipped,'rejected',b.rejected_count));
 return public.club_list_member_import_batch(p_organisation_id,b.id);
end; $$;

comment on column public.club_products.is_lifetime is 'When true, membership validity has no end date; billing arrangements and obligations are forbidden.';
comment on function public.club_execute_member_import_batch(uuid,uuid) is 'Imports an explicitly mapped Golden Ticket as lifetime, preserving the ClubManager expiry only in migration provenance.';
