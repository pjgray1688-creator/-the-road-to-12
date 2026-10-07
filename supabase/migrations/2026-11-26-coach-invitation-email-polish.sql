-- Coach invitation polish.
-- This is additive and forward-only. It replaces notification-producing RPCs
-- with the same relationship/security rules plus complete, safe email payloads.

create or replace function public.coach_request_member_relationship(
  p_organisation_id uuid,p_client_user_id uuid,p_relationship_type text
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_email text;
  v_coach_name text;
  v_organisation_name text;
  v_owner uuid;
  v_existing_assignment uuid;
  existing public.coach_relationships%rowtype;
  result public.coach_relationships%rowtype;
begin
  if auth.uid() is null or not public.coach_has_explicit_access(auth.uid()) then
    raise exception 'Coach access is not available' using errcode='42501';
  end if;
  if p_relationship_type not in ('primary','cover') or p_organisation_id is null then
    raise exception 'Choose a valid member connection' using errcode='22023';
  end if;
  if p_client_user_id=auth.uid() then
    raise exception 'A Coach cannot add their own account' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.coach_permissions cp
    join public.club_members cm on cm.organisation_id=cp.organisation_id and cm.user_id=auth.uid()
      and cm.active and cm.role in ('trainer','gym_staff','gym_admin','owner')
    join public.club_members target on target.organisation_id=cm.organisation_id and target.user_id=p_client_user_id
      and target.active and target.role='member'
    where cp.organisation_id=p_organisation_id and cp.user_id=auth.uid() and cp.active
  ) then raise exception 'That member is not available to this Coach' using errcode='42501'; end if;
  select * into existing from public.coach_relationships
    where coach_user_id=auth.uid() and client_user_id=p_client_user_id
      and organisation_id=p_organisation_id and relationship_type=p_relationship_type and status in ('pending','active')
    limit 1;
  if found then return jsonb_build_object('id',existing.id,'status',existing.status,'alreadyActive',existing.status='active'); end if;
  select id into v_existing_assignment from public.coach_client_assignments
    where organisation_id=p_organisation_id and coach_user_id=auth.uid() and client_user_id=p_client_user_id
      and relationship_type=p_relationship_type and active limit 1;
  if found then return jsonb_build_object('id',v_existing_assignment,'status','active','alreadyActive',true); end if;
  if p_relationship_type='primary' and exists(
    select 1 from public.coach_relationships where client_user_id=p_client_user_id
      and relationship_type='primary' and status='active'
  ) then raise exception 'This client already has a primary PT' using errcode='23505'; end if;
  if p_relationship_type='primary' and exists(
    select 1 from public.coach_client_assignments where client_user_id=p_client_user_id
      and relationship_type='primary' and active
  ) then raise exception 'This client already has a primary PT' using errcode='23505'; end if;
  if p_relationship_type='cover' then
    select programme_owner_user_id into v_owner from public.coach_relationships
      where client_user_id=p_client_user_id and relationship_type='primary' and status='active'
        and organisation_id=p_organisation_id limit 1;
    if v_owner is null then
      select programme_owner_user_id into v_owner from public.coach_client_assignments
        where client_user_id=p_client_user_id and relationship_type='primary' and active
          and organisation_id=p_organisation_id limit 1;
    end if;
    if v_owner is null then raise exception 'A cover PT needs an active primary PT' using errcode='22023'; end if;
  else v_owner:=auth.uid(); end if;
  select lower(email) into v_email from auth.users where id=p_client_user_id;
  select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),display_name,'Your Coach') into v_coach_name from public.profiles where id=auth.uid();
  select name into v_organisation_name from public.club_organisations where id=p_organisation_id;
  insert into public.coach_relationships(organisation_id,coach_user_id,client_user_id,client_email,relationship_type,programme_owner_user_id,requested_by)
    values(p_organisation_id,auth.uid(),p_client_user_id,v_email,p_relationship_type,v_owner,auth.uid()) returning * into result;
  if v_email is not null and not exists(select 1 from public.club_member_notification_intents where organisation_id=p_organisation_id and idempotency_key='coach-relationship:'||result.id) then
    insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
      values(p_organisation_id,p_client_user_id,v_email,'member_service','coach_relationship_invite','pending','coach-relationship:'||result.id,now(),'members',jsonb_build_object('relationshipType',p_relationship_type,'claimPath','/coach/claim','coachName',v_coach_name,'organisationName',v_organisation_name),'coach_relationship',result.id);
  end if;
  return jsonb_build_object('id',result.id,'status','pending','clientFound',true);
end; $$;

create or replace function public.coach_create_referral_invite(
  p_client_email text,p_relationship_type text default 'primary'
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_email text:=nullif(lower(btrim(p_client_email)),'');
  v_coach_name text;
  v_organisation_name text;
  v_owner uuid;
  v_token text:=encode(gen_random_bytes(32),'hex');
  v_existing boolean:=false;
  v_relationship public.coach_relationships%rowtype;
  v_invite public.coach_referral_invites%rowtype;
begin
  if auth.uid() is null or not public.coach_has_explicit_access(auth.uid()) then raise exception 'Coach access is not available' using errcode='42501'; end if;
  if p_relationship_type not in ('primary','cover') then raise exception 'Choose a valid relationship' using errcode='22023'; end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Enter a valid email or leave it blank' using errcode='22023'; end if;
  if v_email is not null and exists(select 1 from auth.users where id=auth.uid() and lower(email)=v_email) then raise exception 'A Coach cannot add their own account' using errcode='22023'; end if;
  if p_relationship_type='primary' then v_owner:=auth.uid(); end if;
  if v_email is not null then
    select * into v_relationship from public.coach_relationships where coach_user_id=auth.uid() and lower(client_email)=v_email and relationship_type=p_relationship_type and status='pending' limit 1;
    v_existing:=found;
  end if;
  if not v_existing then
    insert into public.coach_relationships(coach_user_id,client_email,relationship_type,programme_owner_user_id,requested_by)
      values(auth.uid(),coalesce(v_email,''),p_relationship_type,v_owner,auth.uid()) returning * into v_relationship;
  elsif p_relationship_type='cover' and v_relationship.programme_owner_user_id is not null then
    update public.coach_relationships set programme_owner_user_id=null,updated_at=now() where id=v_relationship.id;
  end if;
  select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),display_name,'Your Coach') into v_coach_name from public.profiles where id=auth.uid();
  select name into v_organisation_name from public.club_organisations where id=v_relationship.organisation_id;
  insert into public.coach_referral_invites(relationship_id,token_hash,intended_email,created_by)
    values(v_relationship.id,encode(digest(v_token,'sha256'),'hex'),v_email,auth.uid()) returning * into v_invite;
  if v_email is not null then
    insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
      values(v_relationship.organisation_id,v_relationship.client_user_id,v_email,'member_service','coach_relationship_invite','pending','coach-referral:'||v_invite.id,now(),'members',jsonb_build_object('relationshipType',p_relationship_type,'invitePath','/coach/join/'||v_token,'coachName',v_coach_name,'organisationName',v_organisation_name,'expiresAt',v_invite.expires_at),'coach_relationship',v_relationship.id);
  end if;
  return jsonb_build_object('id',v_relationship.id,'status','pending','invitePath','/coach/join/'||v_token,'expiresAt',v_invite.expires_at,'emailQueued',v_email is not null);
end; $$;

create or replace function public.coach_resend_referral_invite(p_relationship_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  r public.coach_relationships%rowtype;
  v_token text:=encode(gen_random_bytes(32),'hex');
  v_email text;
  v_coach_name text;
  v_organisation_name text;
  i public.coach_referral_invites%rowtype;
begin
  select * into r from public.coach_relationships where id=p_relationship_id and coach_user_id=auth.uid() and status='pending' for update;
  if not found then raise exception 'Pending coaching request not found' using errcode='40400'; end if;
  v_email:=nullif(r.client_email,'');
  update public.coach_referral_invites set revoked_at=now() where relationship_id=r.id and revoked_at is null;
  insert into public.coach_referral_invites(relationship_id,token_hash,intended_email,created_by)
    values(r.id,encode(digest(v_token,'sha256'),'hex'),v_email,auth.uid()) returning * into i;
  select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),display_name,'Your Coach') into v_coach_name from public.profiles where id=auth.uid();
  select name into v_organisation_name from public.club_organisations where id=r.organisation_id;
  if v_email is not null then
    insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
      values(r.organisation_id,r.client_user_id,v_email,'member_service','coach_relationship_invite','pending','coach-referral:'||i.id,now(),'members',jsonb_build_object('relationshipType',r.relationship_type,'invitePath','/coach/join/'||v_token,'coachName',v_coach_name,'organisationName',v_organisation_name,'expiresAt',i.expires_at),'coach_relationship',r.id);
  end if;
  return jsonb_build_object('invitePath','/coach/join/'||v_token,'expiresAt',i.expires_at,'emailQueued',v_email is not null);
end; $$;

create or replace function public.coach_preview_referral(p_token text)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select jsonb_build_object(
  'coachName',coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),p.display_name,'Your Coach'),
  'relationshipType',r.relationship_type,
  'expiresAt',i.expires_at
)
from public.coach_referral_invites i
join public.coach_relationships r on r.id=i.relationship_id and r.status='pending'
left join public.profiles p on p.id=r.coach_user_id
where (i.token_hash=encode(digest(btrim(p_token),'sha256'),'hex') or i.token_hash=md5(btrim(p_token)))
  and i.revoked_at is null and i.claimed_at is null and i.expires_at>now()
limit 1;
$$;

revoke all on function public.coach_create_referral_invite(text,text),public.coach_resend_referral_invite(uuid),public.coach_preview_referral(text) from public,anon;
grant execute on function public.coach_create_referral_invite(text,text),public.coach_resend_referral_invite(uuid) to authenticated;
grant execute on function public.coach_preview_referral(text) to anon,authenticated;
