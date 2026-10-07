-- R12 Coach independent client relationships.
-- Club assignments remain in coach_client_assignments and retain their
-- organisation/member boundary. This table is for direct Coach relationships
-- and does not create a Club organisation or gym membership for either person.

create table if not exists public.coach_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid not null references auth.users(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coach_relationships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.club_organisations(id) on delete cascade,
  coach_user_id uuid not null references auth.users(id) on delete cascade,
  client_user_id uuid references auth.users(id) on delete cascade,
  client_email text not null,
  relationship_type text not null check (relationship_type in ('primary','cover')),
  programme_owner_user_id uuid references auth.users(id),
  status text not null default 'pending' check (status in ('pending','active','revoked')),
  requested_by uuid not null references auth.users(id),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coach_relationships_coach_idx on public.coach_relationships(coach_user_id,status);
create index if not exists coach_relationships_client_idx on public.coach_relationships(client_user_id,status);
create index if not exists coach_relationships_email_idx on public.coach_relationships(lower(client_email),status);
create unique index if not exists coach_relationships_active_primary_client_uq
  on public.coach_relationships(client_user_id)
  where relationship_type='primary' and status='active' and client_user_id is not null;
create unique index if not exists coach_relationships_pending_email_uq
  on public.coach_relationships(coach_user_id,lower(client_email),relationship_type,coalesce(organisation_id,'00000000-0000-0000-0000-000000000000'::uuid))
  where status='pending';

alter table public.coach_session_logs alter column organisation_id drop not null;
alter table public.coach_session_logs alter column assignment_id drop not null;
alter table public.coach_session_logs add column if not exists relationship_id uuid references public.coach_relationships(id) on delete restrict;
alter table public.club_member_notification_intents alter column organisation_id drop not null;
create unique index if not exists coach_session_logs_direct_key_uq
  on public.coach_session_logs(coach_user_id,relationship_id,idempotency_key)
  where relationship_id is not null;

alter table public.coach_access enable row level security;
alter table public.coach_relationships enable row level security;
revoke all on table public.coach_access, public.coach_relationships from public,anon,authenticated;

-- Existing Club managers may explicitly approve a user's independent Coach
-- eligibility. This does not grant Club access or create a membership.
create or replace function public.coach_grant_direct_access(p_organisation_id uuid,p_user_id uuid,p_active boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result public.coach_access%rowtype;
begin
  if auth.uid() is null or p_organisation_id is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then
    raise exception 'Coach access administration denied' using errcode='42501';
  end if;
  if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'Coach account not found' using errcode='22023'; end if;
  insert into public.coach_access(user_id,granted_by,active)
    values(p_user_id,auth.uid(),p_active)
    on conflict(user_id) do update set granted_by=excluded.granted_by,active=excluded.active,updated_at=now()
    returning * into result;
  return to_jsonb(result);
end; $$;
revoke all on function public.coach_grant_direct_access(uuid,uuid,boolean) from public,anon;
grant execute on function public.coach_grant_direct_access(uuid,uuid,boolean) to authenticated;

create or replace function public.coach_has_explicit_access(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select p_user_id is not null and (
    exists(select 1 from public.coach_access a where a.user_id=p_user_id and a.active)
    or exists(select 1 from public.coach_permissions p where p.user_id=p_user_id and p.active)
  );
$$;
revoke all on function public.coach_has_explicit_access(uuid) from public,anon;
grant execute on function public.coach_has_explicit_access(uuid) to authenticated;

create or replace function public.coach_request_relationship(p_client_email text,p_relationship_type text,p_organisation_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_email text:=lower(btrim(p_client_email));
  v_client uuid;
  v_owner uuid;
  existing public.coach_relationships%rowtype;
  result public.coach_relationships%rowtype;
begin
  if auth.uid() is null or not public.coach_has_explicit_access(auth.uid()) then raise exception 'Coach access is not available' using errcode='42501'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or p_relationship_type not in ('primary','cover') then raise exception 'Client connection details are invalid' using errcode='22023'; end if;
  if p_organisation_id is not null and not exists(select 1 from public.coach_permissions p join public.club_members m on m.organisation_id=p.organisation_id and m.user_id=auth.uid() and m.active and m.role in ('trainer','gym_staff','gym_admin','owner') where p.organisation_id=p_organisation_id and p.user_id=auth.uid() and p.active) then
    raise exception 'Coach organisation access is not available' using errcode='42501';
  end if;
  select id into v_client from auth.users where lower(email)=v_email and email_confirmed_at is not null;
  if v_client=auth.uid() then raise exception 'A Coach cannot add their own account' using errcode='22023'; end if;
  select * into existing from public.coach_relationships
  where coach_user_id=auth.uid() and lower(client_email)=v_email and relationship_type=p_relationship_type
    and organisation_id is not distinct from p_organisation_id and status='pending';
  if found then return jsonb_build_object('id',existing.id,'status',existing.status,'invited',v_client is null,'clientFound',v_client is not null); end if;
  if v_client is not null and p_relationship_type='primary' and exists(select 1 from public.coach_relationships where client_user_id=v_client and relationship_type='primary' and status='active') then
    raise exception 'This client already has a primary PT' using errcode='23505';
  end if;
  if p_relationship_type='cover' then
    select programme_owner_user_id into v_owner from public.coach_relationships
    where client_user_id=v_client and relationship_type='primary' and status='active' and organisation_id is not distinct from p_organisation_id limit 1;
    if v_owner is null then raise exception 'A cover PT needs an active primary PT' using errcode='22023'; end if;
  else v_owner:=auth.uid(); end if;
  insert into public.coach_relationships(organisation_id,coach_user_id,client_user_id,client_email,relationship_type,programme_owner_user_id,requested_by)
    values(p_organisation_id,auth.uid(),v_client,v_email,p_relationship_type,v_owner,auth.uid()) returning * into result;
  if not exists(select 1 from public.club_member_notification_intents where related_type='coach_relationship' and related_id=result.id) then
    insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
      values(p_organisation_id,v_client,v_email,'member_service','coach_relationship_invite','pending','coach-relationship:'||result.id,now(),'members',jsonb_build_object('relationshipType',p_relationship_type,'claimPath','/coach/claim'),'coach_relationship',result.id);
  end if;
  return jsonb_build_object('id',result.id,'status',result.status,'invited',v_client is null,'clientFound',v_client is not null);
end; $$;
revoke all on function public.coach_request_relationship(text,text,uuid) from public,anon;
grant execute on function public.coach_request_relationship(text,text,uuid) to authenticated;

create or replace function public.coach_claim_relationships()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_email text; v_claimed integer:=0;
begin
  select lower(email) into v_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if v_email is null then raise exception 'A verified email is required' using errcode='42501'; end if;
  update public.coach_relationships r set client_user_id=auth.uid(),status='active',accepted_by=auth.uid(),accepted_at=now(),updated_at=now()
  where lower(r.client_email)=v_email and r.status='pending'
    and (r.relationship_type='primary' or exists(select 1 from public.coach_relationships p where p.client_user_id=auth.uid() and p.relationship_type='primary' and p.status='active' and p.organisation_id is not distinct from r.organisation_id))
    and not exists(select 1 from public.coach_relationships active_primary where active_primary.client_user_id=auth.uid() and active_primary.relationship_type='primary' and active_primary.status='active' and r.relationship_type='primary');
  get diagnostics v_claimed=row_count;
  return jsonb_build_object('claimed',v_claimed);
end; $$;
revoke all on function public.coach_claim_relationships() from public,anon;
grant execute on function public.coach_claim_relationships() to authenticated;

-- Final list includes both established Club assignments and accepted direct
-- relationships. Club rows retain their organisation context; direct rows do not.
create or replace function public.coach_list_clients()
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(x.item order by x.name,x.relationship_id),'[]'::jsonb)
from (
  select coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),p.display_name,'Client') name,a.id relationship_id,
    jsonb_build_object('clientUserId',a.client_user_id,'organisationId',a.organisation_id,'assignmentId',a.id,'relationshipId',a.id,'name',coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),p.display_name,'Client'),'relationship',a.relationship_type,'programmeOwnerName',coalesce(nullif(trim(concat_ws(' ',op.first_name,op.last_name)),''),op.display_name,'Primary PT'),'programmeName',case when cm.user_id is not null then coalesce(cp.generated_programme->>'name','Current programme') else 'Programme unavailable' end) item
  from public.coach_client_assignments a join public.coach_permissions permission on permission.organisation_id=a.organisation_id and permission.user_id=auth.uid() and permission.active
  join public.club_members coach_member on coach_member.organisation_id=a.organisation_id and coach_member.user_id=auth.uid() and coach_member.active and coach_member.role in ('trainer','gym_staff','gym_admin','owner')
  join public.club_members cm on cm.organisation_id=a.organisation_id and cm.user_id=a.client_user_id and cm.active
  join public.profiles p on p.id=a.client_user_id left join public.profiles cp on cp.id=a.client_user_id left join public.profiles op on op.id=a.programme_owner_user_id
  where a.coach_user_id=auth.uid() and a.active
  union all
  select coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),p.display_name,'Client') name,r.id relationship_id,
    jsonb_build_object('clientUserId',r.client_user_id,'organisationId',r.organisation_id,'assignmentId',r.id,'relationshipId',r.id,'name',coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),p.display_name,'Client'),'relationship',r.relationship_type,'programmeOwnerName',coalesce(nullif(trim(concat_ws(' ',op.first_name,op.last_name)),''),op.display_name,'Primary PT'),'programmeName',coalesce(p.generated_programme->>'name','Current programme')) item
  from public.coach_relationships r join public.profiles p on p.id=r.client_user_id left join public.profiles op on op.id=r.programme_owner_user_id
  where r.coach_user_id=auth.uid() and r.status='active' and public.coach_has_explicit_access(auth.uid())
) x;
$$;

drop function if exists public.coach_get_client(uuid,uuid,uuid);
create or replace function public.coach_get_client(p_client_user_id uuid,p_organisation_id uuid,p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb; profile_row public.profiles%rowtype; owner_profile public.profiles%rowtype; relationship public.coach_relationships%rowtype; assignment public.coach_client_assignments%rowtype; v_owner uuid; v_relationship text; v_id uuid; v_org uuid; v_direct boolean:=false;
begin
  if p_organisation_id is null then
    select r.* into relationship from public.coach_relationships r where r.id=p_assignment_id and r.client_user_id=p_client_user_id and r.coach_user_id=auth.uid() and r.status='active' and public.coach_has_explicit_access(auth.uid());
    if not found then raise exception 'Coach client access denied' using errcode='42501'; end if;
    v_direct:=true; v_owner:=relationship.programme_owner_user_id; v_relationship:=relationship.relationship_type; v_id:=relationship.id; v_org:=null;
  else
    select a.* into assignment from public.coach_client_assignments a join public.coach_permissions permission on permission.organisation_id=a.organisation_id and permission.user_id=auth.uid() and permission.active join public.club_members coach_member on coach_member.organisation_id=a.organisation_id and coach_member.user_id=auth.uid() and coach_member.active and coach_member.role in ('trainer','gym_staff','gym_admin','owner') join public.club_members client_member on client_member.organisation_id=a.organisation_id and client_member.user_id=a.client_user_id and client_member.active where a.client_user_id=p_client_user_id and a.organisation_id=p_organisation_id and a.id=p_assignment_id and a.coach_user_id=auth.uid() and a.active;
    if not found then raise exception 'Coach client access denied' using errcode='42501'; end if;
    v_owner:=assignment.programme_owner_user_id; v_relationship:=assignment.relationship_type; v_id:=assignment.id; v_org:=assignment.organisation_id;
  end if;
  select * into profile_row from public.profiles where id=p_client_user_id;
  select * into owner_profile from public.profiles where id=v_owner;
  select jsonb_build_object('clientUserId',profile_row.id,'organisationId',v_org,'assignmentId',v_id,'relationshipId',v_id,'name',coalesce(nullif(trim(concat_ws(' ',profile_row.first_name,profile_row.last_name)),''),profile_row.display_name,'Client'),'programme',case when v_direct then coalesce(profile_row.generated_programme,'{}'::jsonb) else case when exists(select 1 from public.club_members cm where cm.organisation_id=v_org and cm.user_id=p_client_user_id and cm.active) then coalesce(profile_row.generated_programme,'{}'::jsonb) else '{}'::jsonb end end,'programmeOwnerUserId',v_owner,'programmeOwnerName',coalesce(nullif(trim(concat_ws(' ',owner_profile.first_name,owner_profile.last_name)),''),owner_profile.display_name,'Primary PT'),'relationship',v_relationship,'completedWorkouts',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'completedAt',s.completed_at,'status',s.status,'sets',(select count(*) from public.workout_sets ws where ws.session_id=s.id)) order by s.completed_at desc) from public.workout_sessions s where s.user_id=p_client_user_id and s.status='completed'),'[]'::jsonb),'sessions',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc) from public.coach_session_logs l where l.client_user_id=p_client_user_id and l.coach_user_id=auth.uid() and ((v_direct and l.relationship_id=v_id) or (not v_direct and l.assignment_id=v_id and l.organisation_id=v_org))),'[]'::jsonb)) into result;
  return result;
end; $$;

drop function if exists public.coach_start_session(uuid,uuid,uuid,text,text);
create or replace function public.coach_start_session(p_client_user_id uuid,p_organisation_id uuid,p_assignment_id uuid,p_relationship_id uuid,p_idempotency_key text,p_programme_id text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare assignment public.coach_client_assignments%rowtype; relationship public.coach_relationships%rowtype; result public.coach_session_logs%rowtype;
begin
  if p_organisation_id is null then
    select * into relationship from public.coach_relationships where id=coalesce(p_relationship_id,p_assignment_id) and client_user_id=p_client_user_id and coach_user_id=auth.uid() and status='active' and public.coach_has_explicit_access(auth.uid());
    if not found then raise exception 'Coach client access denied' using errcode='42501'; end if;
    if nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>120 then raise exception 'Invalid session key' using errcode='22023'; end if;
    insert into public.coach_session_logs(organisation_id,assignment_id,relationship_id,coach_user_id,client_user_id,idempotency_key,programme_id) values(null,null,relationship.id,auth.uid(),p_client_user_id,p_idempotency_key,left(nullif(btrim(p_programme_id),''),120)) on conflict (coach_user_id,relationship_id,idempotency_key) where relationship_id is not null do update set updated_at=now() returning * into result;
  else
    select a.* into assignment from public.coach_client_assignments a join public.coach_permissions permission on permission.organisation_id=a.organisation_id and permission.user_id=auth.uid() and permission.active join public.club_members coach_member on coach_member.organisation_id=a.organisation_id and coach_member.user_id=auth.uid() and coach_member.active and coach_member.role in ('trainer','gym_staff','gym_admin','owner') join public.club_members client_member on client_member.organisation_id=a.organisation_id and client_member.user_id=a.client_user_id and client_member.active where a.client_user_id=p_client_user_id and a.organisation_id=p_organisation_id and a.id=p_assignment_id and a.coach_user_id=auth.uid() and a.active;
    if not found then raise exception 'Coach client access denied' using errcode='42501'; end if;
    insert into public.coach_session_logs(organisation_id,assignment_id,relationship_id,coach_user_id,client_user_id,idempotency_key,programme_id) values(assignment.organisation_id,assignment.id,null,auth.uid(),p_client_user_id,p_idempotency_key,left(nullif(btrim(p_programme_id),''),120)) on conflict (organisation_id,coach_user_id,idempotency_key) do update set updated_at=now() returning * into result;
  end if;
  if not found then raise exception 'Session key already used' using errcode='23505'; end if;
  return to_jsonb(result);
end; $$;

create or replace function public.coach_has_access(p_client_user_id uuid default null)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
select auth.uid() is not null and public.coach_has_explicit_access(auth.uid()) and (p_client_user_id is null or exists(select 1 from public.coach_relationships r where r.coach_user_id=auth.uid() and r.client_user_id=p_client_user_id and r.status='active') or exists(select 1 from public.coach_client_assignments a join public.coach_permissions p on p.organisation_id=a.organisation_id and p.user_id=auth.uid() and p.active join public.club_members m on m.organisation_id=a.organisation_id and m.user_id=auth.uid() and m.active where a.coach_user_id=auth.uid() and a.client_user_id=p_client_user_id and a.active));
$$;

create or replace function public.coach_update_session(p_session_id uuid,p_notes text,p_adaptations text,p_substitutions jsonb,p_complete boolean default false,p_exercise_logs jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result public.coach_session_logs%rowtype;
begin
  if not exists(select 1 from public.coach_session_logs l where l.id=p_session_id and l.coach_user_id=auth.uid() and l.status='active' and ((public.coach_has_explicit_access(auth.uid()) and exists(select 1 from public.coach_relationships r where r.id=l.relationship_id and r.coach_user_id=auth.uid() and r.client_user_id=l.client_user_id and r.status='active')) or exists(select 1 from public.coach_client_assignments a join public.coach_permissions p on p.organisation_id=a.organisation_id and p.user_id=auth.uid() and p.active join public.club_members m on m.organisation_id=a.organisation_id and m.user_id=auth.uid() and m.active and m.role in ('trainer','gym_staff','gym_admin','owner') where a.id=l.assignment_id and a.organisation_id=l.organisation_id and a.client_user_id=l.client_user_id and a.coach_user_id=auth.uid() and a.active))) then raise exception 'Coach session update denied' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_exercise_logs,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_exercise_logs,'[]'::jsonb))>100 then raise exception 'Invalid exercise log' using errcode='22023'; end if;
  update public.coach_session_logs set exercise_logs=coalesce(p_exercise_logs,'[]'::jsonb),notes=left(coalesce(p_notes,''),4000),adaptations=left(coalesce(p_adaptations,''),4000),substitutions=case when jsonb_typeof(coalesce(p_substitutions,'[]'::jsonb))='array' then p_substitutions else '[]'::jsonb end,status=case when p_complete then 'completed' else 'active' end,completed_at=case when p_complete then coalesce(completed_at,now()) else null end,updated_at=now() where id=p_session_id and coach_user_id=auth.uid() returning * into result;
  return to_jsonb(result);
end; $$;

revoke all on function public.coach_list_clients(),public.coach_get_client(uuid,uuid,uuid),public.coach_start_session(uuid,uuid,uuid,uuid,text,text),public.coach_has_access(uuid),public.coach_update_session(uuid,text,text,jsonb,boolean,jsonb),public.coach_request_relationship(text,text,uuid),public.coach_claim_relationships() from public,anon;
grant execute on function public.coach_list_clients(),public.coach_get_client(uuid,uuid,uuid),public.coach_start_session(uuid,uuid,uuid,uuid,text,text),public.coach_has_access(uuid),public.coach_update_session(uuid,text,text,jsonb,boolean,jsonb),public.coach_request_relationship(text,text,uuid),public.coach_claim_relationships() to authenticated;
