-- Keep pgcrypto outside SECURITY DEFINER search paths and qualify its calls.
-- These replacements correct effective functions from earlier migrations
-- without rewriting migration history.

create or replace function public.coach_claim_referral(p_token text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_email text;
  v_owner uuid;
  i public.coach_referral_invites%rowtype;
  r public.coach_relationships%rowtype;
begin
  select lower(email) into v_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if v_email is null then raise exception 'A verified email is required' using errcode='42501'; end if;
  select * into i from public.coach_referral_invites
    where (token_hash=encode(extensions.digest(btrim(p_token),'sha256'),'hex') or token_hash=md5(btrim(p_token)))
      and revoked_at is null and claimed_at is null and expires_at>now()
    for update;
  if not found then raise exception 'This coaching invitation is no longer available' using errcode='42501'; end if;
  if i.intended_email is not null and lower(i.intended_email)<>v_email then
    raise exception 'This invitation was sent to a different email address' using errcode='42501';
  end if;
  select * into r from public.coach_relationships where id=i.relationship_id and status='pending' for update;
  if not found then raise exception 'This coaching invitation is no longer available' using errcode='42501'; end if;

  if r.relationship_type='primary' then
    if exists(select 1 from public.coach_relationships where client_user_id=auth.uid() and relationship_type='primary' and status='active')
       or exists(select 1 from public.coach_client_assignments where client_user_id=auth.uid() and relationship_type='primary' and active) then
      raise exception 'This account already has a primary PT' using errcode='23505';
    end if;
    v_owner:=r.coach_user_id;
  else
    select coalesce(p.programme_owner_user_id,p.coach_user_id) into v_owner
      from public.coach_relationships p
      where p.client_user_id=auth.uid() and p.relationship_type='primary' and p.status='active'
        and (r.organisation_id is null or p.organisation_id is not distinct from r.organisation_id)
      order by p.accepted_at nulls last,p.created_at limit 1;
    if v_owner is null then
      select coalesce(a.programme_owner_user_id,a.coach_user_id) into v_owner
        from public.coach_client_assignments a
        where a.client_user_id=auth.uid() and a.relationship_type='primary' and a.active
          and (r.organisation_id is null or a.organisation_id is not distinct from r.organisation_id)
        order by a.created_at limit 1;
    end if;
    if v_owner is null then
      raise exception 'Your Coach needs an active primary PT before a cover connection can be accepted' using errcode='22023';
    end if;
  end if;

  update public.coach_relationships
    set client_user_id=auth.uid(),programme_owner_user_id=v_owner,status='active',accepted_by=auth.uid(),accepted_at=now(),updated_at=now()
    where id=r.id;
  update public.coach_referral_invites set claimed_at=now() where id=i.id;
  return jsonb_build_object('relationshipId',r.id,'status','active','programmeOwnerUserId',v_owner);
end; $$;

create or replace function public.club_execute_member_import_batch(p_organisation_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_member_import_batches%rowtype; r record; c public.club_customers%rowtype; u uuid; ref text; product uuid; ms public.club_memberships%rowtype; ms_status text; start_at timestamptz; end_at timestamptz; made integer:=0; linked integer:=0; skipped integer:=0; failed integer:=0; was_linked boolean;
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
    insert into public.club_member_import_identities(organisation_id,source_system,source_member_reference,customer_id,first_seen_batch_id) values(p_organisation_id,'clubmanager',ref,c.id,b.id) on conflict(organisation_id,source_system,source_member_reference) do update set customer_id=excluded.customer_id where club_member_import_identities.customer_id=excluded.customer_id;
    if exists(select 1 from public.club_access_credentials where organisation_id=p_organisation_id and credential_hash=extensions.digest(lower(btrim(ref)),'sha256') and customer_id<>c.id) then raise exception 'Credential is already assigned to another member' using errcode='23505'; end if;
    insert into public.club_access_credentials(organisation_id,customer_id,credential_type,credential_hash,display_suffix) values(p_organisation_id,c.id,'legacy_member_reference',extensions.digest(lower(btrim(ref)),'sha256'),right(ref,4)) on conflict(organisation_id,credential_hash) do nothing;
   end if;
   if r.normalized_values->>'membershipName' is not null then
    select club_product_id into product from public.club_member_import_package_mappings where batch_id=b.id and lower(source_package)=lower(r.normalized_values->>'membershipName') and status='mapped';
    ms_status:=coalesce(r.normalized_values->>'membershipStatus','expired'); start_at:=coalesce((r.normalized_values->>'startDate')::date::timestamptz,b.created_at); end_at:=case when r.normalized_values->>'endDate' is null then null else (r.normalized_values->>'endDate')::date::timestamptz+interval '1 day' end;
    if end_at is not null and end_at<=now() then ms_status:='expired'; end if;
    insert into public.club_memberships(organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key,import_batch_id,import_row_id,migration_metadata) values(p_organisation_id,product,ms_status,start_at,end_at,'legacy_import','member-import:'||r.id,b.id,r.id,jsonb_build_object('source_system','clubmanager','billing_evidence','not_imported','source_status',r.normalized_values->>'membershipStatus','billing_method_label',r.normalized_values->>'billingMethod')) on conflict(organisation_id,assignment_idempotency_key) do nothing returning * into ms;
    if ms.id is null then select * into ms from public.club_memberships where organisation_id=p_organisation_id and assignment_idempotency_key='member-import:'||r.id; end if;
    if u is null then insert into public.club_membership_holders(membership_id,organisation_id,customer_id) values(ms.id,p_organisation_id,c.id) on conflict do nothing; else
      insert into public.club_membership_holders(membership_id,organisation_id,user_id) values(ms.id,p_organisation_id,u) on conflict do nothing;
      insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source) select u,p_organisation_id,ms.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,start_at,end_at,'legacy_import' from public.club_product_entitlements e where e.product_id=product and ms_status='active' on conflict do nothing;
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

create or replace function public.club_reception_access_decision(p_organisation_id uuid,p_location_id uuid,p_credential text,p_credential_type text default 'legacy_member_reference')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid; a uuid;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.view') then raise exception 'Access decisions require reception authority' using errcode='42501'; end if;
 if nullif(btrim(p_credential),'') is null or p_credential_type not in ('legacy_member_reference','barcode','qr') then raise exception 'Invalid access credential' using errcode='22023'; end if;
 select customer_id into c from public.club_access_credentials where organisation_id=p_organisation_id and credential_hash=extensions.digest(lower(btrim(p_credential)),'sha256') and credential_type=p_credential_type and status='active';
 if c is null and exists(select 1 from public.club_access_credentials where organisation_id<>p_organisation_id and credential_hash=extensions.digest(lower(btrim(p_credential)),'sha256') and credential_type=p_credential_type and status='active') then insert into public.club_access_decisions(organisation_id,location_id,actor_user_id,decision,reason,credential_type,source) values(p_organisation_id,p_location_id,auth.uid(),'deny','wrong_club',p_credential_type,'reception') returning id into a; return jsonb_build_object('allowed',false,'decision','deny','reason','wrong_club','decidedAt',now(),'auditReference',a); end if;
 return public.club_access_decide_customer(p_organisation_id,p_location_id,c,p_credential_type,'reception');
end; $$;

revoke all on function public.coach_claim_referral(text),public.club_execute_member_import_batch(uuid,uuid),public.club_reception_access_decision(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.coach_claim_referral(text),public.club_execute_member_import_batch(uuid,uuid),public.club_reception_access_decision(uuid,uuid,text,text) to authenticated;
