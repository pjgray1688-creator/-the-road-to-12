-- Fix the individual importer to infer the partial assignment-key index,
-- derive counters from committed row outcomes, and expose safe SQLSTATE-only
-- diagnostics. The recovery RPC is deliberately scoped to the confirmed batch.
begin;

create or replace function public.club_execute_member_import_batch_individual_base(p_organisation_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  b public.club_member_import_batches%rowtype;
  r record;
  c public.club_customers%rowtype;
  u uuid;
  ref text;
  product uuid;
  product_is_lifetime boolean;
  ms public.club_memberships%rowtype;
  ms_status text;
  start_at timestamptz;
  end_at timestamptz;
  legacy_expiry_date text;
  made integer:=0;
  linked integer:=0;
  skipped integer:=0;
  failed integer:=0;
  rejected integer:=0;
  was_linked boolean;
  safe_sqlstate text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then
    raise exception 'Member import is not permitted' using errcode='42501';
  end if;
  select * into b from public.club_member_import_batches where id=p_batch_id and organisation_id=p_organisation_id for update;
  if not found or b.status not in ('ready','importing') then raise exception 'Batch is not ready to import' using errcode='22023'; end if;
  update public.club_member_import_batches set status='importing',import_started_at=coalesce(import_started_at,now()) where id=b.id;

  for r in select * from public.club_member_import_rows where batch_id=b.id and jsonb_array_length(blockers)=0 order by source_row_number for update loop
    begin
      if r.outcome in ('imported','linked','skipped_existing') then skipped:=skipped+1; continue; end if;
      c:=null; u:=r.matched_user_id; ref:=r.normalized_values->>'legacyReference'; was_linked:=false; ms:=null;
      if r.imported_customer_id is not null then
        select * into c from public.club_customers where id=r.imported_customer_id and organisation_id=p_organisation_id for update;
      end if;
      if c.id is null then
        insert into public.club_customers(organisation_id,user_id,display_name,email,phone,status)
        values(p_organisation_id,u,coalesce(nullif(r.normalized_values->>'fullName',''),nullif(concat_ws(' ',r.normalized_values->>'firstName',r.normalized_values->>'lastName'),''),'Imported member'),r.normalized_values->>'email',r.normalized_values->>'phone','member') returning * into c;
      else
        was_linked:=true;
        if c.user_id is null and u is not null then
          update public.club_customers set user_id=u,updated_at=now() where id=c.id and user_id is null returning * into c;
        end if;
      end if;
      if u is not null then
        insert into public.club_members(organisation_id,user_id,role,active) values(p_organisation_id,u,'member',true) on conflict(organisation_id,user_id) do nothing;
      end if;
      if ref is not null then
        insert into public.club_member_import_identities(organisation_id,source_system,source_member_reference,customer_id,first_seen_batch_id)
        values(p_organisation_id,'clubmanager',ref,c.id,b.id)
        on conflict(organisation_id,source_system,source_member_reference) do update set customer_id=excluded.customer_id
          where club_member_import_identities.customer_id=excluded.customer_id;
        if exists(select 1 from public.club_access_credentials where organisation_id=p_organisation_id
          and credential_hash=extensions.digest(lower(btrim(ref)),'sha256') and customer_id<>c.id) then
          raise exception 'Credential is already assigned to another member' using errcode='23505';
        end if;
        insert into public.club_access_credentials(organisation_id,customer_id,credential_type,credential_hash,display_suffix)
        values(p_organisation_id,c.id,'legacy_member_reference',extensions.digest(lower(btrim(ref)),'sha256'),right(ref,4))
        on conflict(organisation_id,credential_hash) do nothing;
      end if;
      if r.normalized_values->>'membershipName' is not null then
        select club_product_id into product from public.club_member_import_package_mappings
          where batch_id=b.id and organisation_id=p_organisation_id
            and lower(source_package)=lower(r.normalized_values->>'membershipName') and status='mapped';
        select p.is_lifetime into product_is_lifetime from public.club_products p
          where p.id=product and p.organisation_id=p_organisation_id;
        ms_status:=coalesce(r.normalized_values->>'membershipStatus','expired');
        start_at:=coalesce((r.normalized_values->>'startDate')::date::timestamptz,b.created_at);
        legacy_expiry_date:=r.normalized_values->>'endDate';
        end_at:=case when coalesce(product_is_lifetime,false) or legacy_expiry_date is null then null
          else legacy_expiry_date::date::timestamptz+interval '1 day' end;
        if not coalesce(product_is_lifetime,false) and end_at is not null and end_at<=now() then ms_status:='expired'; end if;
        insert into public.club_memberships(organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key,import_batch_id,import_row_id,migration_metadata)
        values(p_organisation_id,product,ms_status,start_at,end_at,'legacy_import','member-import:'||r.id,b.id,r.id,
          jsonb_build_object('source_system','clubmanager','billing_evidence','not_imported','source_status',r.normalized_values->>'membershipStatus',
            'billing_method_label',r.normalized_values->>'billingMethod',
            'legacy_expiry_date',case when coalesce(product_is_lifetime,false) then legacy_expiry_date else null end,
            'expiry_policy',case when coalesce(product_is_lifetime,false) then 'lifetime_no_effective_expiry' else null end))
        on conflict (organisation_id,assignment_idempotency_key) where assignment_idempotency_key is not null
        do nothing returning * into ms;
        if ms.id is null then
          select * into ms from public.club_memberships where organisation_id=p_organisation_id and assignment_idempotency_key='member-import:'||r.id;
        end if;
        if ms.id is null then raise exception 'Membership import idempotency row could not be resolved' using errcode='P0002'; end if;
        if u is null then
          insert into public.club_membership_holders(membership_id,organisation_id,customer_id)
          values(ms.id,p_organisation_id,c.id) on conflict do nothing;
        else
          insert into public.club_membership_holders(membership_id,organisation_id,user_id)
          values(ms.id,p_organisation_id,u) on conflict do nothing;
          insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,
            allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
          select u,p_organisation_id,ms.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,
            e.discount_percent,e.discount_period,e.discount_max_uses,ms.starts_at,ms.ends_at,'legacy_import'
          from public.club_product_entitlements e where e.product_id=product and ms_status='active' on conflict do nothing;
        end if;
      end if;
      update public.club_member_import_rows set imported_customer_id=c.id,imported_membership_id=ms.id,
        outcome=case when was_linked then 'linked' else 'imported' end,updated_at=now() where id=r.id and batch_id=b.id;
    exception when others then
      get stacked diagnostics safe_sqlstate = returned_sqlstate;
      failed:=failed+1;
      update public.club_member_import_rows set outcome='rejected',
        blockers=blockers||jsonb_build_array('Import failed safely (SQLSTATE '||left(safe_sqlstate,5)||'); review this row'),
        updated_at=now() where id=r.id and batch_id=b.id;
    end;
  end loop;

  update public.club_member_import_rows set outcome='rejected'
    where batch_id=b.id and jsonb_array_length(blockers)>0 and outcome is null;
  select count(*) filter(where outcome='imported'),count(*) filter(where outcome='linked'),
         count(*) filter(where outcome='skipped_existing'),count(*) filter(where outcome='rejected')
    into made,linked,skipped,rejected from public.club_member_import_rows where batch_id=b.id;
  update public.club_member_import_batches set status='completed',completed_at=now(),imported_count=made,
    linked_count=linked,skipped_count=skipped,rejected_count=rejected,failed_count=failed,updated_at=now()
    where id=b.id returning * into b;
  insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata)
    values(p_organisation_id,auth.uid(),'member_import.completed','member_import_batch',b.id,
      jsonb_build_object('imported',made,'linked',linked,'skipped',skipped,'rejected',rejected,'runtime_failures',failed));
  return public.club_list_member_import_batch(p_organisation_id,b.id);
end; $$;
revoke all on function public.club_execute_member_import_batch_individual_base(uuid,uuid) from public,anon,authenticated;

-- One-shot recovery: only the known batch shape is eligible. Completed rows
-- remain untouched and the established idempotency keys prevent duplicate
-- customer or membership records. A later call after success is a read-only no-op.
create or replace function public.club_recover_rejected_member_import_batch(p_organisation_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_member_import_batches%rowtype; rejected_count integer; success_count integer; target_count integer; result jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then
    raise exception 'Member import recovery is not permitted' using errcode='42501';
  end if;
  if p_batch_id is distinct from '6bf9d303-525a-4565-88a4-b4121fac7f98'::uuid then
    raise exception 'This recovery procedure is scoped to the verified Madhouse batch' using errcode='42501';
  end if;
  select * into b from public.club_member_import_batches where id=p_batch_id and organisation_id=p_organisation_id for update;
  if not found or b.source_system<>'clubmanager' then raise exception 'Import batch is unavailable' using errcode='P0002'; end if;
  select count(*) filter(where outcome in ('imported','linked')),
         count(*) filter(where outcome='rejected'),
         count(*) filter(where outcome='rejected' and imported_membership_id is null
           and normalized_values ? 'membershipName' and nullif(btrim(normalized_values->>'membershipName'),'') is not null
           and blockers='["Import failed safely; review this row"]'::jsonb)
    into success_count,rejected_count,target_count from public.club_member_import_rows
    where organisation_id=p_organisation_id and batch_id=p_batch_id;

  if b.status='completed' and success_count=702 and rejected_count=0 and b.row_count=702 then
    return public.club_list_member_import_batch(p_organisation_id,p_batch_id);
  end if;
  if b.status<>'completed' or success_count<>225 or rejected_count<>477 or target_count<>477
     or b.row_count<>702 then
    raise exception 'Recovery preflight mismatch; no rows were changed' using errcode='55000';
  end if;

  update public.club_member_import_rows set blockers='[]'::jsonb,outcome=null,updated_at=now()
    where organisation_id=p_organisation_id and batch_id=p_batch_id and outcome='rejected'
      and imported_membership_id is null and normalized_values ? 'membershipName'
      and nullif(btrim(normalized_values->>'membershipName'),'') is not null
      and blockers='["Import failed safely; review this row"]'::jsonb;
  if not found then raise exception 'Recovery target changed; no import was started' using errcode='40001'; end if;
  update public.club_member_import_batches set status='ready',completed_at=null,updated_at=now()
    where id=p_batch_id and organisation_id=p_organisation_id;
  result:=public.club_execute_member_import_batch_individual_base(p_organisation_id,p_batch_id);
  return jsonb_build_object('recovered',true,'preserved_successful_rows',225,'target_rows',477,'batch',result);
end; $$;
revoke all on function public.club_recover_rejected_member_import_batch(uuid,uuid) from public,anon;
grant execute on function public.club_recover_rejected_member_import_batch(uuid,uuid) to authenticated;

commit;
