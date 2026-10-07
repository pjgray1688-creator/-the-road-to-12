-- R12 Coach member directory connections and private-client referrals.
-- This is additive. It does not create Auth users, Club memberships, or a
-- public people directory. Existing pending coach_relationships remain valid.

-- Private invite recipients do not have an Auth identity yet. The durable
-- intent is therefore allowed to target an email without a user_id.
alter table public.club_member_notification_intents alter column user_id drop not null;

create table if not exists public.coach_referral_invites (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.coach_relationships(id) on delete cascade,
  token_hash text not null unique,
  intended_email text,
  expires_at timestamptz not null default (now() + interval '30 days'),
  claimed_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists coach_referral_live_relationship_uq
  on public.coach_referral_invites(relationship_id)
  where revoked_at is null and claimed_at is null;
create index if not exists coach_referral_token_expiry_idx
  on public.coach_referral_invites(token_hash, expires_at);
alter table public.coach_referral_invites enable row level security;
revoke all on table public.coach_referral_invites from public,anon,authenticated;

create or replace function public.coach_list_member_search_contexts()
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('organisationId',o.id,'name',o.name) order by o.name),'[]'::jsonb)
from public.club_organisations o
where o.active and public.coach_has_explicit_access(auth.uid())
  and exists (
    select 1 from public.coach_permissions cp
    join public.club_members cm on cm.organisation_id=cp.organisation_id and cm.user_id=auth.uid()
      and cm.active and cm.role in ('trainer','gym_staff','gym_admin','owner')
    where cp.organisation_id=o.id and cp.user_id=auth.uid() and cp.active
  );
$$;

create or replace function public.coach_search_club_members(p_organisation_id uuid,p_query text)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'userId',m.user_id,
  'name',coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),p.display_name,'Member'),
  'organisationId',o.id,
  'organisationName',o.name,
  'memberStatus',case when m.active then 'active' else 'inactive' end
) order by coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),p.display_name)), '[]'::jsonb)
from public.club_members m
join public.club_organisations o on o.id=m.organisation_id and o.active
join public.profiles p on p.id=m.user_id
join public.coach_permissions cp on cp.organisation_id=m.organisation_id and cp.user_id=auth.uid() and cp.active
join public.club_members coach_member on coach_member.organisation_id=m.organisation_id and coach_member.user_id=auth.uid()
  and coach_member.active and coach_member.role in ('trainer','gym_staff','gym_admin','owner')
where m.organisation_id=p_organisation_id and m.active and m.role='member'
  and public.coach_has_explicit_access(auth.uid())
  and length(btrim(coalesce(p_query,'')))>=2
  and (
    lower(coalesce(p.first_name,'')) like '%'||lower(btrim(p_query))||'%'
    or lower(coalesce(p.last_name,'')) like '%'||lower(btrim(p_query))||'%'
    or lower(coalesce(p.display_name,'')) like '%'||lower(btrim(p_query))||'%'
    or lower(trim(concat_ws(' ',p.first_name,p.last_name))) like '%'||lower(btrim(p_query))||'%'
  );
$$;

create or replace function public.coach_request_member_relationship(
  p_organisation_id uuid,p_client_user_id uuid,p_relationship_type text
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_email text;
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
  insert into public.coach_relationships(organisation_id,coach_user_id,client_user_id,client_email,relationship_type,programme_owner_user_id,requested_by)
    values(p_organisation_id,auth.uid(),p_client_user_id,v_email,p_relationship_type,v_owner,auth.uid()) returning * into result;
  if not exists(select 1 from public.club_member_notification_intents where organisation_id=p_organisation_id and idempotency_key='coach-relationship:'||result.id) then
    insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
      values(p_organisation_id,p_client_user_id,v_email,'member_service','coach_relationship_invite','pending','coach-relationship:'||result.id,now(),'members',jsonb_build_object('relationshipType',p_relationship_type,'claimPath','/coach/claim'),'coach_relationship',result.id);
  end if;
  return jsonb_build_object('id',result.id,'status','pending','clientFound',true);
end; $$;

create or replace function public.coach_create_referral_invite(
  p_client_email text,p_relationship_type text default 'primary'
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_email text:=nullif(lower(btrim(p_client_email)),'');
  v_owner uuid;
  v_token text:=encode(gen_random_bytes(32),'hex');
  v_existing boolean:=false;
  v_relationship public.coach_relationships%rowtype;
  v_invite public.coach_referral_invites%rowtype;
begin
  if auth.uid() is null or not public.coach_has_explicit_access(auth.uid()) then
    raise exception 'Coach access is not available' using errcode='42501';
  end if;
  if p_relationship_type not in ('primary','cover') then raise exception 'Choose a valid relationship' using errcode='22023'; end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Enter a valid email or leave it blank' using errcode='22023'; end if;
  if v_email is not null and exists(select 1 from auth.users where id=auth.uid() and lower(email)=v_email) then
    raise exception 'A Coach cannot add their own account' using errcode='22023';
  end if;
  if p_relationship_type='cover' then
    select programme_owner_user_id into v_owner from public.coach_relationships
      where coach_user_id=auth.uid() and relationship_type='primary' and status='active' limit 1;
    if v_owner is null then raise exception 'A cover PT needs an active primary PT' using errcode='22023'; end if;
  else v_owner:=auth.uid(); end if;
  if v_email is not null then
    select * into v_relationship from public.coach_relationships
      where coach_user_id=auth.uid() and lower(client_email)=v_email and relationship_type=p_relationship_type and status='pending' limit 1;
    v_existing:=found;
  end if;
  if not v_existing then
    insert into public.coach_relationships(coach_user_id,client_email,relationship_type,programme_owner_user_id,requested_by)
      values(auth.uid(),coalesce(v_email,''),p_relationship_type,v_owner,auth.uid()) returning * into v_relationship;
  end if;
  insert into public.coach_referral_invites(relationship_id,token_hash,intended_email,created_by)
    values(v_relationship.id,md5(v_token),v_email,auth.uid()) returning * into v_invite;
  insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
    select null,null,v_email,'member_service','coach_relationship_invite','pending','coach-referral:'||v_invite.id,now(),'members',jsonb_build_object('relationshipType',p_relationship_type,'invitePath','/coach/join/'||v_token),'coach_relationship',v_relationship.id
    where not exists(select 1 from public.club_member_notification_intents where idempotency_key='coach-referral:'||v_invite.id);
  return jsonb_build_object('id',v_relationship.id,'status','pending','invitePath','/coach/join/'||v_token,'expiresAt',v_invite.expires_at);
end; $$;

create or replace function public.coach_list_pending_relationships()
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'id',r.id,
  'name',coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),p.display_name,nullif(r.client_email,''),'Client'),
  'email',nullif(r.client_email,''),
  'relationship',r.relationship_type,
  'status',r.status,
  'createdAt',r.created_at,
  'organisationId',r.organisation_id,
  'contextName',o.name,
  'hasInvite',exists(select 1 from public.coach_referral_invites i where i.relationship_id=r.id and i.revoked_at is null and i.claimed_at is null and i.expires_at>now())
) order by r.created_at desc),'[]'::jsonb)
from public.coach_relationships r
left join public.profiles p on p.id=r.client_user_id
left join public.club_organisations o on o.id=r.organisation_id
where r.coach_user_id=auth.uid() and r.status='pending' and public.coach_has_explicit_access(auth.uid());
$$;

create or replace function public.coach_claim_referral(p_token text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_email text;
  i public.coach_referral_invites%rowtype;
  r public.coach_relationships%rowtype;
begin
  select lower(email) into v_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if v_email is null then raise exception 'A verified email is required' using errcode='42501'; end if;
  select * into i from public.coach_referral_invites where token_hash=md5(btrim(p_token))
    and revoked_at is null and claimed_at is null and expires_at>now() for update;
  if not found then raise exception 'This coaching invitation is no longer available' using errcode='42501'; end if;
  if i.intended_email is not null and lower(i.intended_email)<>v_email then raise exception 'This invitation was sent to a different email address' using errcode='42501'; end if;
  select * into r from public.coach_relationships where id=i.relationship_id and status='pending' for update;
  if not found then raise exception 'This coaching invitation is no longer available' using errcode='42501'; end if;
  if r.relationship_type='primary' and exists(select 1 from public.coach_relationships where client_user_id=auth.uid() and relationship_type='primary' and status='active') then
    raise exception 'This account already has a primary PT' using errcode='23505';
  end if;
  if r.relationship_type='cover' and not exists(select 1 from public.coach_relationships where client_user_id=auth.uid() and relationship_type='primary' and status='active' and organisation_id is not distinct from r.organisation_id) then
    raise exception 'A cover PT needs an active primary PT' using errcode='22023';
  end if;
  update public.coach_relationships set client_user_id=auth.uid(),status='active',accepted_by=auth.uid(),accepted_at=now(),updated_at=now() where id=r.id;
  update public.coach_referral_invites set claimed_at=now() where id=i.id;
  return jsonb_build_object('relationshipId',r.id,'status','active');
end; $$;

create or replace function public.coach_revoke_pending_relationship(p_relationship_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare changed integer;
begin
  update public.coach_relationships set status='revoked',updated_at=now()
    where id=p_relationship_id and coach_user_id=auth.uid() and status='pending';
  get diagnostics changed=row_count;
  if changed=0 then raise exception 'Pending coaching request not found' using errcode='40400'; end if;
  update public.coach_referral_invites set revoked_at=now() where relationship_id=p_relationship_id and revoked_at is null;
  update public.club_member_notification_intents set state='cancelled',updated_at=now()
    where related_type='coach_relationship' and related_id=p_relationship_id and state not in ('sent','cancelled');
  return jsonb_build_object('status','revoked');
end; $$;

create or replace function public.coach_resend_referral_invite(p_relationship_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  r public.coach_relationships%rowtype;
  v_token text:=encode(gen_random_bytes(32),'hex');
  i public.coach_referral_invites%rowtype;
begin
  select * into r from public.coach_relationships where id=p_relationship_id and coach_user_id=auth.uid() and status='pending' for update;
  if not found then raise exception 'Pending coaching request not found' using errcode='40400'; end if;
  update public.coach_referral_invites set revoked_at=now() where relationship_id=r.id and revoked_at is null;
  insert into public.coach_referral_invites(relationship_id,token_hash,intended_email,created_by)
    values(r.id,md5(v_token),nullif(r.client_email,''),auth.uid()) returning * into i;
  insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
    values(r.organisation_id,r.client_user_id,nullif(r.client_email,''),'member_service','coach_relationship_invite','pending','coach-referral:'||i.id,now(),'members',jsonb_build_object('relationshipType',r.relationship_type,'invitePath','/coach/join/'||v_token),'coach_relationship',r.id);
  return jsonb_build_object('invitePath','/coach/join/'||v_token,'expiresAt',i.expires_at);
end; $$;

revoke all on function public.coach_list_member_search_contexts(),public.coach_search_club_members(uuid,text),public.coach_request_member_relationship(uuid,uuid,text),public.coach_create_referral_invite(text,text),public.coach_list_pending_relationships(),public.coach_claim_referral(text),public.coach_revoke_pending_relationship(uuid),public.coach_resend_referral_invite(uuid) from public,anon;
grant execute on function public.coach_list_member_search_contexts(),public.coach_search_club_members(uuid,text),public.coach_request_member_relationship(uuid,uuid,text),public.coach_create_referral_invite(text,text),public.coach_list_pending_relationships(),public.coach_claim_referral(text),public.coach_revoke_pending_relationship(uuid),public.coach_resend_referral_invite(uuid) to authenticated;
