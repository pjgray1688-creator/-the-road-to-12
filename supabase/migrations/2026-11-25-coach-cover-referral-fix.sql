-- R12 Coach referral correction.
-- Private Cover invitations cannot know programme ownership until the client
-- authenticates. Existing 2026-11-24 invite rows remain claimable; newly
-- generated tokens use SHA-256 while the claim function accepts legacy MD5
-- hashes only for invitations created by the earlier migration.

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
  if p_relationship_type not in ('primary','cover') then
    raise exception 'Choose a valid relationship' using errcode='22023';
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email or leave it blank' using errcode='22023';
  end if;
  if v_email is not null and exists(select 1 from auth.users where id=auth.uid() and lower(email)=v_email) then
    raise exception 'A Coach cannot add their own account' using errcode='22023';
  end if;

  -- A private Cover request is allowed to remain pending without an owner.
  -- The actual client primary relationship is resolved inside claim below.
  if p_relationship_type='primary' then v_owner:=auth.uid(); end if;

  if v_email is not null then
    select * into v_relationship from public.coach_relationships
      where coach_user_id=auth.uid() and lower(client_email)=v_email
        and relationship_type=p_relationship_type and status='pending' limit 1;
    v_existing:=found;
  end if;
  if not v_existing then
    insert into public.coach_relationships(coach_user_id,client_email,relationship_type,programme_owner_user_id,requested_by)
      values(auth.uid(),coalesce(v_email,''),p_relationship_type,v_owner,auth.uid()) returning * into v_relationship;
  elsif p_relationship_type='cover' and v_relationship.programme_owner_user_id is not null then
    -- Do not reuse a stale or incorrectly-owned pending Cover relationship.
    update public.coach_relationships set programme_owner_user_id=null,updated_at=now()
      where id=v_relationship.id;
    v_relationship.programme_owner_user_id:=null;
  end if;

  insert into public.coach_referral_invites(relationship_id,token_hash,intended_email,created_by)
    values(v_relationship.id,encode(digest(v_token,'sha256'),'hex'),v_email,auth.uid()) returning * into v_invite;
  insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
    select null,null,v_email,'member_service','coach_relationship_invite','pending','coach-referral:'||v_invite.id,now(),'members',jsonb_build_object('relationshipType',p_relationship_type,'invitePath','/coach/join/'||v_token),'coach_relationship',v_relationship.id
    where not exists(select 1 from public.club_member_notification_intents where idempotency_key='coach-referral:'||v_invite.id);
  return jsonb_build_object('id',v_relationship.id,'status','pending','invitePath','/coach/join/'||v_token,'expiresAt',v_invite.expires_at);
end; $$;

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
    where (token_hash=encode(digest(btrim(p_token),'sha256'),'hex') or token_hash=md5(btrim(p_token)))
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
    -- First resolve a direct primary relationship for this exact client and,
    -- if necessary, an existing Club assignment. Never use the current Cover
    -- PT or an unrelated relationship owned by that PT.
    select coalesce(p.programme_owner_user_id,p.coach_user_id) into v_owner
      from public.coach_relationships p
      where p.client_user_id=auth.uid() and p.relationship_type='primary' and p.status='active'
        and (r.organisation_id is null or p.organisation_id is not distinct from r.organisation_id)
      order by p.accepted_at nulls last,p.created_at
      limit 1;
    if v_owner is null then
      select coalesce(a.programme_owner_user_id,a.coach_user_id) into v_owner
        from public.coach_client_assignments a
        where a.client_user_id=auth.uid() and a.relationship_type='primary' and a.active
          and (r.organisation_id is null or a.organisation_id is not distinct from r.organisation_id)
        order by a.created_at
        limit 1;
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

revoke all on function public.coach_create_referral_invite(text,text),public.coach_claim_referral(text) from public,anon;
grant execute on function public.coach_create_referral_invite(text,text),public.coach_claim_referral(text) to authenticated;
