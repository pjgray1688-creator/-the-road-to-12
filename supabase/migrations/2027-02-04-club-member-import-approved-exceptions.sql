-- Narrow extension to the installed batch recovery. This is not a general
-- importer: it handles only the confirmed Madhouse batch and three reviewed rows.
begin;

do $prerequisites$
begin
  if to_regprocedure('public.club_recover_rejected_member_import_batch(uuid,uuid)') is null then
    raise exception 'The 2027-02-03 member import recovery migration must be installed first';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_products' and column_name='fixed_term_value')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_products' and column_name='fixed_term_unit') then
    raise exception 'The fixed-term membership schema must be installed before this exception recovery migration';
  end if;
end;
$prerequisites$;

-- A non-sellable, zero-price, 74-day import-only access product preserves the
-- source's Gold transformation identity without mapping Jake to a recurring
-- gym plan. The only granted product entitlement is gym access; this migration
-- creates no commerce order, service transaction, PT credit, or payment.
do $gold_access_product$
declare org uuid; product uuid; matches integer; entitlement_count integer;
begin
  select count(*) into matches from public.club_organisations where slug='madhouse-gym' and active;
  if matches<>1 then raise exception 'Exactly one active Madhouse Gym organisation is required'; end if;
  select id into org from public.club_organisations where slug='madhouse-gym' and active;
  select count(*) into matches from public.club_products
    where organisation_id=org and name='Legacy Gold Transformation Gym Access';
  if matches>1 then raise exception 'Duplicate exception access products exist'; end if;
  if matches=0 then
    insert into public.club_products(organisation_id,name,kind,price_minor,currency,billing,duration_days,
      fixed_term_value,fixed_term_unit,is_lifetime,sellable)
    values(org,'Legacy Gold Transformation Gym Access','membership',0,'GBP','one_off',null,74,'day',false,false)
    returning id into product;
  else
    select id into product from public.club_products
      where organisation_id=org and name='Legacy Gold Transformation Gym Access';
    if not exists(select 1 from public.club_products where id=product and organisation_id=org and kind='membership'
       and price_minor=0 and currency='GBP' and billing='one_off' and duration_days is null
       and fixed_term_value=74 and fixed_term_unit='day' and not is_lifetime and not sellable and archived_at is null
       and legacy_import_category is null) then
      raise exception 'The exact Jake Pepper fixed-term access product has conflicting configuration';
    end if;
  end if;
  select count(*) into entitlement_count from public.club_product_entitlements
    where organisation_id=org and product_id=product;
  if entitlement_count=0 then
    insert into public.club_product_entitlements(product_id,organisation_id,position,entitlement_key,scope,location_ids)
    values(product,org,0,'gym_access','future_locations','{}'::uuid[]);
  elsif entitlement_count<>1 or not exists(select 1 from public.club_product_entitlements
      where organisation_id=org and product_id=product and position=0 and entitlement_key='gym_access'
        and scope='future_locations' and coalesce(cardinality(location_ids),0)=0) then
    raise exception 'The Jake Pepper exception product has unexpected entitlements';
  end if;
end;
$gold_access_product$;

create or replace function public.club_recover_rejected_member_import_batch(p_organisation_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  b public.club_member_import_batches%rowtype;
  jake public.club_member_import_rows%rowtype;
  daniel public.club_member_import_rows%rowtype;
  rebecca public.club_member_import_rows%rowtype;
  marie public.club_member_import_rows%rowtype;
  jake_mapping_count integer;
  marie_mapping_count integer;
  org uuid;
  exception_product uuid;
  package_name text;
  success_count integer;
  imported_count integer;
  linked_count integer;
  rejected_count integer;
  generic_target_count integer;
  changed_count integer;
  unsupported_households integer;
  unsupported_provider_refs integer;
  unmapped_count integer;
  existing_membership_count integer;
  identity_conflicts integer;
  duplicate_source_refs integer;
  final_rejected integer;
  final_memberships integer;
  result jsonb;
  marie_product uuid;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then
    raise exception 'Member import recovery is not permitted' using errcode='42501';
  end if;
  if p_batch_id is distinct from '6bf9d303-525a-4565-88a4-b4121fac7f98'::uuid then
    raise exception 'This recovery procedure is restricted to the verified Madhouse batch' using errcode='42501';
  end if;
  select * into b from public.club_member_import_batches where id=p_batch_id and organisation_id=p_organisation_id for update;
  if not found or b.source_system<>'clubmanager' then raise exception 'Import batch is unavailable' using errcode='P0002'; end if;
  select id into org from public.club_organisations where slug='madhouse-gym' and active;
  if org is distinct from p_organisation_id then raise exception 'Batch organisation does not match Madhouse Gym' using errcode='42501'; end if;

  select count(*) filter(where outcome in ('imported','linked')),
         count(*) filter(where outcome='imported'),
         count(*) filter(where outcome='linked'),
         count(*) filter(where outcome='rejected'),
         count(*) filter(where outcome='rejected' and imported_membership_id is null
           and blockers='["Import failed safely; review this row"]'::jsonb)
    into success_count,imported_count,linked_count,rejected_count,generic_target_count
    from public.club_member_import_rows where organisation_id=org and batch_id=p_batch_id;

  if b.status='completed' and b.row_count=702 and success_count=702 and rejected_count=0 then
    select count(*) into final_memberships from public.club_member_import_rows
      where organisation_id=org and batch_id=p_batch_id and imported_membership_id is not null;
    if final_memberships<>475
       or not exists(select 1 from public.club_member_import_rows r join public.club_memberships m
          on m.organisation_id=r.organisation_id and m.import_row_id=r.id
          where r.organisation_id=org and r.batch_id=b.id and r.source_row_number=9
            and m.product_id=(select id from public.club_products where organisation_id=org and name='Legacy Gold Transformation Gym Access')
            and m.starts_at=('2026-09-27'::date::timestamp at time zone 'Europe/London')
            and m.ends_at=('2026-12-10'::date::timestamp at time zone 'Europe/London'))
       or exists(select 1 from public.club_member_import_rows r where r.organisation_id=org and r.batch_id=b.id
          and r.source_row_number in (33,49) and (r.imported_membership_id is not null
            or r.normalized_values->>'membershipDisposition'<>'waiting_list'
            or r.normalized_values ? 'membershipName')) then
      raise exception 'Completed batch has an unexpected exception mapping or membership count';
    end if;
    return jsonb_build_object('already_recovered',true,'preserved_successful_rows',225,
      'imported_or_linked_rows',702,'membership_rows',475,'profile_only_waiting_list_rows',2);
  end if;

  if b.status<>'completed' or b.row_count<>702 or success_count<>225 or imported_count<>16
     or linked_count<>209 or rejected_count<>477 or generic_target_count<>477 then
    raise exception 'Recovery preflight mismatch; no rows were changed' using errcode='55000';
  end if;
  select * into jake from public.club_member_import_rows where organisation_id=org and batch_id=b.id and source_row_number=9 for update;
  select * into daniel from public.club_member_import_rows where organisation_id=org and batch_id=b.id and source_row_number=33 for update;
  select * into rebecca from public.club_member_import_rows where organisation_id=org and batch_id=b.id and source_row_number=49 for update;
  select * into marie from public.club_member_import_rows where organisation_id=org and batch_id=b.id and source_row_number=268 for update;
  if jake.id is null or lower(btrim(coalesce(jake.normalized_values->>'fullName',concat_ws(' ',jake.normalized_values->>'firstName',jake.normalized_values->>'lastName'))))<>'jake pepper'
     or lower(btrim(jake.normalized_values->>'membershipName'))<>'gold package , unlimited gym'
     or jake.normalized_values->>'startDate'<>'2026-09-27' or jake.normalized_values->>'endDate'<>'2026-12-09'
     or jake.outcome<>'rejected' or jake.imported_membership_id is not null
     or daniel.id is null or lower(btrim(coalesce(daniel.normalized_values->>'fullName',concat_ws(' ',daniel.normalized_values->>'firstName',daniel.normalized_values->>'lastName'))))<>'daniel dixon'
     or upper(btrim(daniel.normalized_values->>'membershipName'))<>'JOIN WAITING LIST'
     or daniel.outcome<>'rejected' or daniel.imported_membership_id is not null
     or rebecca.id is null or lower(btrim(coalesce(rebecca.normalized_values->>'fullName',concat_ws(' ',rebecca.normalized_values->>'firstName',rebecca.normalized_values->>'lastName'))))<>'rebecca kiely'
     or upper(btrim(rebecca.normalized_values->>'membershipName'))<>'JOIN WAITING LIST'
     or rebecca.outcome<>'rejected' or rebecca.imported_membership_id is not null
     or marie.id is null or lower(btrim(coalesce(marie.normalized_values->>'fullName',concat_ws(' ',marie.normalized_values->>'firstName',marie.normalized_values->>'lastName'))))<>'marie delaney' then
    raise exception 'The three approved exception rows or Marie Delaney row do not match; no rows were changed' using errcode='55000';
  end if;

  select p.id into exception_product from public.club_products p
    where p.organisation_id=org and p.name='Legacy Gold Transformation Gym Access'
      and p.kind='membership' and p.billing='one_off' and p.fixed_term_value=74 and p.fixed_term_unit='day'
      and p.price_minor=0 and not p.sellable and not p.is_lifetime and p.archived_at is null;
  if exception_product is null then raise exception 'Jake Pepper exception product is unavailable'; end if;
  package_name:=jake.normalized_values->>'membershipName';
  if (select count(*) from public.club_member_import_rows where batch_id=b.id and lower(normalized_values->>'membershipName')=lower(package_name))<>1
     or (select count(*) from public.club_member_import_package_mappings where batch_id=b.id and organisation_id=org and lower(source_package)=lower(package_name))<>1 then
    raise exception 'Jake Pepper source package is shared by other rows or its mapping is ambiguous';
  end if;
  select count(*) into marie_mapping_count from public.club_member_import_package_mappings
    where batch_id=b.id and organisation_id=org and lower(source_package)=lower(marie.normalized_values->>'membershipName') and status='mapped';
  if marie_mapping_count<>1 then raise exception 'Marie Delaney existing rolling membership mapping is unavailable or ambiguous'; end if;
  select club_product_id into marie_product from public.club_member_import_package_mappings
    where batch_id=b.id and organisation_id=org and lower(source_package)=lower(marie.normalized_values->>'membershipName') and status='mapped';
  if marie_product is null then raise exception 'Marie Delaney existing rolling membership mapping is unavailable'; end if;

  -- All 474 non-exception candidates must have an approved organisation-scoped
  -- mapping and be individual rows. Any household/provider contract evidence
  -- aborts the complete operation before the batch is touched.
  select count(*) into unmapped_count from public.club_member_import_rows r
    where r.organisation_id=org and r.batch_id=b.id and r.outcome='rejected'
      and r.source_row_number not in (9,33,49)
      and (select count(*) from public.club_member_import_package_mappings pm
        join public.club_products p on p.id=pm.club_product_id and p.organisation_id=pm.organisation_id
        where pm.organisation_id=org and pm.batch_id=b.id and pm.status='mapped'
          and lower(pm.source_package)=lower(r.normalized_values->>'membershipName') and p.kind='membership'
          and (p.legacy_import_category is not null or p.archived_at is null))<>1;
  select count(*) into unsupported_households from public.club_member_import_rows r
    where r.organisation_id=org and r.batch_id=b.id and r.outcome='rejected'
      and public.club_import_mapped_value(r.raw_values,b.mapping,'householdReference',array['shared_contract_id','household_reference']) is not null;
  select count(*) into unsupported_provider_refs from public.club_member_import_rows r
    where r.organisation_id=org and r.batch_id=b.id and r.outcome='rejected'
      and (public.club_import_mapped_value(r.raw_values,b.mapping,'providerSubscriptionReference',array['provider_subscription_reference','mandate_reference','stripe_subscription_id','gocardless_mandate_id','subscription_id']) is not null
        or public.club_import_mapped_value(r.raw_values,b.mapping,'providerCustomerReference',array['provider_customer_reference','stripe_customer_id','gocardless_customer_id']) is not null);
  select count(*) into identity_conflicts from public.club_member_import_rows r
    join public.club_member_import_identities i on i.organisation_id=r.organisation_id
      and i.source_system='clubmanager' and i.source_member_reference=nullif(btrim(r.normalized_values->>'legacyReference'),'')
    where r.organisation_id=org and r.batch_id=b.id and r.outcome='rejected'
      and (r.imported_customer_id is null or r.imported_customer_id is distinct from i.customer_id);
  select count(*) into duplicate_source_refs from (
    select nullif(btrim(normalized_values->>'legacyReference'),'') as source_ref
      from public.club_member_import_rows where organisation_id=org and batch_id=b.id and outcome='rejected'
      and nullif(btrim(normalized_values->>'legacyReference'),'') is not null
    group by 1 having count(*)>1
  ) duplicates;
  if unmapped_count<>0 or unsupported_households<>0 or unsupported_provider_refs<>0
     or identity_conflicts<>0 or duplicate_source_refs<>0 then
    raise exception 'Recovery stopped: a candidate has an unmapped product, ambiguous identity, household contract, or provider contract';
  end if;
  select count(*) into existing_membership_count from public.club_member_import_rows r
    join public.club_memberships m on m.organisation_id=r.organisation_id
      and m.assignment_idempotency_key='member-import:'||r.id::text
    where r.organisation_id=org and r.batch_id=b.id and r.outcome='rejected';
  if existing_membership_count<>0 then raise exception 'Recovery stopped: an idempotent membership key already exists'; end if;
  select count(*) into jake_mapping_count from public.club_member_import_package_mappings
    where organisation_id=org and batch_id=b.id and lower(source_package)=lower(package_name) and status='mapped';
  if jake_mapping_count<>1 then raise exception 'Jake Pepper source mapping is not exactly one approved mapped row'; end if;

  -- Change only Jake's unique source-package mapping. Marie's row 268 mapping is
  -- read-only here. The two waiting-list source labels remain in normalized
  -- evidence and raw CSV, but are removed from membership assignment input.
  update public.club_member_import_package_mappings set club_product_id=exception_product,
    reason='Approved exception: Jake Pepper source row 9; fixed-term Gold transformation gym access, no renewal'
    where organisation_id=org and batch_id=b.id and lower(source_package)=lower(package_name) and status='mapped';
  update public.club_member_import_rows set normalized_values=normalized_values||jsonb_build_object(
      'sourceMembershipStatus',normalized_values->'membershipStatus','membershipStatus','active',
      'approvedMembershipException','jake_pepper_gold_fixed_term_gym_access'),
    blockers='[]'::jsonb,outcome=null,updated_at=now()
    where id=jake.id and organisation_id=org and batch_id=b.id;
  update public.club_member_import_rows set normalized_values=(normalized_values-'membershipName')||jsonb_build_object(
      'sourceMembershipName',normalized_values->'membershipName','membershipDisposition','waiting_list'),
    blockers='[]'::jsonb,outcome=null,updated_at=now()
    where id in (daniel.id,rebecca.id) and organisation_id=org and batch_id=b.id;
  update public.club_member_import_rows set blockers='[]'::jsonb,outcome=null,updated_at=now()
    where organisation_id=org and batch_id=b.id and outcome='rejected'
      and source_row_number not in (9,33,49) and imported_membership_id is null
      and blockers='["Import failed safely; review this row"]'::jsonb;
  get diagnostics changed_count = row_count;
  if changed_count<>474 then raise exception 'Expected exactly 474 mapped rows for recovery'; end if;
  update public.club_member_import_batches set status='ready',completed_at=null,updated_at=now()
    where id=b.id and organisation_id=org;

  result:=public.club_execute_member_import_batch_individual_base(org,b.id);
  select count(*) filter(where outcome='rejected'),
         count(*) filter(where imported_membership_id is not null)
    into final_rejected,final_memberships from public.club_member_import_rows
    where organisation_id=org and batch_id=b.id;
  if final_rejected<>0 or final_memberships<>475 then
    raise exception 'Recovery did not complete the expected 475 membership rows; transaction rolled back';
  end if;
  if exists(select 1 from public.club_membership_billing_arrangements a join public.club_memberships m
      on m.id=a.membership_id and m.organisation_id=a.organisation_id
      where m.organisation_id=org and m.import_batch_id=b.id)
     or exists(select 1 from public.club_membership_billing_obligations o join public.club_memberships m
      on m.id=o.membership_id and m.organisation_id=o.organisation_id
      where m.organisation_id=org and m.import_batch_id=b.id) then
    raise exception 'Recovery unexpectedly created a billing arrangement or obligation; transaction rolled back';
  end if;
  update public.club_memberships set migration_metadata=coalesce(migration_metadata,'{}'::jsonb)||jsonb_build_object(
      'approved_import_exception','jake_pepper_gold_fixed_term_gym_access',
      'source_package_name','gold package , Unlimited gym',
      'source_membership_status',jake.normalized_values->>'sourceMembershipStatus',
      'billing_evidence','not_imported','renewal','none')
    where organisation_id=org and import_row_id=jake.id and product_id=exception_product
      and starts_at=('2026-09-27'::date::timestamp at time zone 'Europe/London')
      and ends_at=('2026-12-10'::date::timestamp at time zone 'Europe/London');
  if not found then raise exception 'Jake Pepper fixed-term dates or product do not match the approved exception'; end if;
  update public.club_entitlement_grants set
      starts_at=('2026-09-27'::date::timestamp at time zone 'Europe/London'),
      ends_at=('2026-12-10'::date::timestamp at time zone 'Europe/London')
    where organisation_id=org and membership_id=(select id from public.club_memberships
      where organisation_id=org and import_row_id=jake.id and product_id=exception_product)
      and source='legacy_import' and entitlement_key='gym_access';
  if exists(select 1 from public.club_entitlement_grants g join public.club_memberships m
      on m.id=g.membership_id and m.organisation_id=g.organisation_id
      where m.organisation_id=org and m.import_row_id=jake.id and g.source='legacy_import'
        and (g.starts_at is distinct from ('2026-09-27'::date::timestamp at time zone 'Europe/London')
          or g.ends_at is distinct from ('2026-12-10'::date::timestamp at time zone 'Europe/London'))) then
    raise exception 'Jake Pepper entitlement boundary does not match the approved London dates';
  end if;
  if (select club_product_id from public.club_member_import_package_mappings
        where batch_id=b.id and organisation_id=org and lower(source_package)=lower(marie.normalized_values->>'membershipName'))
        is distinct from marie_product then
    raise exception 'Marie Delaney package mapping changed unexpectedly';
  end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata)
    values(org,auth.uid(),'member_import.approved_exceptions_recovered','member_import_batch',b.id,
      jsonb_build_object('source_rows',jsonb_build_array(9,33,49),'preserved_successful_rows',225,
        'mapped_rows_recovered',474,'profile_only_waiting_list_rows',2,'billing_records_created',false));
  return jsonb_build_object('recovered',true,'preserved_successful_rows',225,'recovered_mapped_rows',474,
    'exception_rows',3,'membership_rows',475,'profile_only_waiting_list_rows',2,'billing_records_created',false);
end; $$;
revoke all on function public.club_recover_rejected_member_import_batch(uuid,uuid) from public,anon;
grant execute on function public.club_recover_rejected_member_import_batch(uuid,uuid) to authenticated;

commit;
