-- Coach organisation boundary: caller context selects one exact authorised
-- assignment. Programme and workout data remain user-global by schema design;
-- Coach session records are always scoped to their originating assignment.

drop function if exists public.coach_get_client(uuid);
drop function if exists public.coach_start_session(uuid,text,text);

create or replace function public.coach_list_clients()
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'clientUserId', a.client_user_id,
    'organisationId', a.organisation_id,
    'assignmentId', a.id,
    'name', coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.display_name, 'Client'),
    'relationship', a.relationship_type,
    'programmeOwnerName', coalesce(nullif(trim(concat_ws(' ', owner_profile.first_name, owner_profile.last_name)), ''), owner_profile.display_name, 'Primary PT'),
    'programmeName', case when exists (
      select 1 from public.club_members cm
      where cm.organisation_id=a.organisation_id and cm.user_id=a.client_user_id and cm.active
      and exists (
        select 1 from public.club_members owner_member
        where owner_member.organisation_id=a.organisation_id and owner_member.user_id=a.programme_owner_user_id and owner_member.active
      )
    ) then coalesce(a_profile.generated_programme->>'name', 'Current programme') else 'Programme unavailable' end
  ) order by p.first_name, p.last_name, a.organisation_id, a.id), '[]'::jsonb)
  from public.coach_client_assignments a
  join public.coach_permissions cp on cp.organisation_id=a.organisation_id and cp.user_id=auth.uid() and cp.active
  join public.profiles p on p.id=a.client_user_id
  left join public.profiles a_profile on a_profile.id=a.client_user_id
  left join public.profiles owner_profile on owner_profile.id=a.programme_owner_user_id
  join public.club_members coach_member on coach_member.organisation_id=a.organisation_id and coach_member.user_id=auth.uid() and coach_member.active and coach_member.role='trainer'
  join public.club_members client_member on client_member.organisation_id=a.organisation_id and client_member.user_id=a.client_user_id and client_member.active
  where a.coach_user_id=auth.uid() and a.active;
$$;

create or replace function public.coach_get_client(p_client_user_id uuid, p_organisation_id uuid, p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb; profile_row public.profiles%rowtype; owner_profile public.profiles%rowtype; assignment public.coach_client_assignments%rowtype;
begin
  select a.* into assignment
  from public.coach_client_assignments a
  join public.coach_permissions p on p.organisation_id=a.organisation_id and p.user_id=auth.uid() and p.active
  join public.club_members coach_member on coach_member.organisation_id=a.organisation_id and coach_member.user_id=auth.uid() and coach_member.active and coach_member.role='trainer'
  join public.club_members client_member on client_member.organisation_id=a.organisation_id and client_member.user_id=a.client_user_id and client_member.active
  where a.client_user_id=p_client_user_id
    and a.organisation_id=p_organisation_id
    and a.id=p_assignment_id
    and a.coach_user_id=auth.uid()
    and a.active;
  if not found then raise exception 'Coach client access denied' using errcode='42501'; end if;
  select * into profile_row from public.profiles where id=p_client_user_id;
  select * into owner_profile from public.profiles where id=assignment.programme_owner_user_id;
  select jsonb_build_object(
    'clientUserId', profile_row.id,
    'organisationId', assignment.organisation_id,
    'assignmentId', assignment.id,
    'name', coalesce(nullif(trim(concat_ws(' ', profile_row.first_name, profile_row.last_name)), ''), profile_row.display_name, 'Client'),
    -- generated_programme and workout_sessions are global user-owned records;
    -- do not add or imply organisation scope that the schema does not provide.
    'programme', case when exists (
      select 1 from public.club_members cm
      where cm.organisation_id=assignment.organisation_id and cm.user_id=p_client_user_id and cm.active
        and exists (
          select 1 from public.club_members owner_member
          where owner_member.organisation_id=assignment.organisation_id and owner_member.user_id=assignment.programme_owner_user_id and owner_member.active
        )
    ) then coalesce(profile_row.generated_programme, '{}'::jsonb) else '{}'::jsonb end,
    'programmeOwnerUserId', assignment.programme_owner_user_id,
    'programmeOwnerName', coalesce(nullif(trim(concat_ws(' ', owner_profile.first_name, owner_profile.last_name)), ''), owner_profile.display_name, 'Primary PT'),
    'relationship', assignment.relationship_type,
    'completedWorkouts', coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'completedAt',s.completed_at,'status',s.status,'sets',(select count(*) from public.workout_sets ws where ws.session_id=s.id)) order by s.completed_at desc) from public.workout_sessions s where s.user_id=p_client_user_id and s.status='completed'), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc) from public.coach_session_logs l where l.assignment_id=assignment.id and l.organisation_id=assignment.organisation_id and l.client_user_id=assignment.client_user_id), '[]'::jsonb)
  ) into result;
  return result;
end; $$;

create or replace function public.coach_start_session(p_client_user_id uuid, p_organisation_id uuid, p_assignment_id uuid, p_idempotency_key text, p_programme_id text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare assignment public.coach_client_assignments%rowtype; result public.coach_session_logs%rowtype;
begin
  select a.* into assignment
  from public.coach_client_assignments a
  join public.coach_permissions p on p.organisation_id=a.organisation_id and p.user_id=auth.uid() and p.active
  join public.club_members coach_member on coach_member.organisation_id=a.organisation_id and coach_member.user_id=auth.uid() and coach_member.active and coach_member.role='trainer'
  join public.club_members client_member on client_member.organisation_id=a.organisation_id and client_member.user_id=a.client_user_id and client_member.active
  where a.client_user_id=p_client_user_id and a.organisation_id=p_organisation_id and a.id=p_assignment_id and a.coach_user_id=auth.uid() and a.active;
  if not found then raise exception 'Coach client access denied' using errcode='42501'; end if;
  if nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>120 then raise exception 'Invalid session key' using errcode='22023'; end if;
  if nullif(btrim(p_programme_id),'') is not null and not exists (select 1 from public.profiles where id=p_client_user_id and coalesce(generated_programme->'week','[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id',p_programme_id))) then raise exception 'Invalid programme session' using errcode='22023'; end if;
  insert into public.coach_session_logs(organisation_id,assignment_id,coach_user_id,client_user_id,idempotency_key,programme_id)
    values(assignment.organisation_id,assignment.id,auth.uid(),p_client_user_id,p_idempotency_key,left(nullif(btrim(p_programme_id),''),120))
    on conflict (organisation_id,coach_user_id,idempotency_key) do update set updated_at=now()
      where coach_session_logs.client_user_id=p_client_user_id and coach_session_logs.assignment_id=assignment.id
    returning * into result;
  if not found then raise exception 'Session key already used for another client or assignment' using errcode='23505'; end if;
  return to_jsonb(result);
end; $$;

revoke all on function public.coach_list_clients(), public.coach_get_client(uuid,uuid,uuid), public.coach_start_session(uuid,uuid,uuid,text,text) from public, anon;
grant execute on function public.coach_list_clients(), public.coach_get_client(uuid,uuid,uuid), public.coach_start_session(uuid,uuid,uuid,text,text) to authenticated;

create or replace function public.coach_has_access(p_client_user_id uuid default null)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select auth.uid() is not null and exists (
    select 1 from public.coach_permissions p
    join public.coach_client_assignments a on a.organisation_id=p.organisation_id and a.coach_user_id=p.user_id
    join public.club_members coach_member on coach_member.organisation_id=p.organisation_id and coach_member.user_id=p.user_id and coach_member.active and coach_member.role='trainer'
    join public.club_members client_member on client_member.organisation_id=a.organisation_id and client_member.user_id=a.client_user_id and client_member.active
    where p.user_id=auth.uid() and p.active and a.active
      and (p_client_user_id is null or a.client_user_id=p_client_user_id)
  );
$$;

create or replace function public.coach_update_session(p_session_id uuid, p_notes text, p_adaptations text, p_substitutions jsonb, p_complete boolean default false, p_exercise_logs jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result public.coach_session_logs%rowtype;
begin
  if not exists (
    select 1 from public.coach_session_logs l
    join public.coach_client_assignments a on a.id=l.assignment_id and a.organisation_id=l.organisation_id and a.coach_user_id=l.coach_user_id and a.client_user_id=l.client_user_id and a.active
    join public.coach_permissions p on p.organisation_id=l.organisation_id and p.user_id=auth.uid() and p.active
    join public.club_members coach_member on coach_member.organisation_id=l.organisation_id and coach_member.user_id=auth.uid() and coach_member.active and coach_member.role='trainer'
    join public.club_members client_member on client_member.organisation_id=l.organisation_id and client_member.user_id=l.client_user_id and client_member.active
    where l.id=p_session_id and l.coach_user_id=auth.uid() and l.status='active'
  ) then raise exception 'Coach session update denied' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_exercise_logs,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_exercise_logs,'[]'::jsonb)) > 100 then raise exception 'Invalid exercise log' using errcode='22023'; end if;
  update public.coach_session_logs set exercise_logs=coalesce(p_exercise_logs,'[]'::jsonb), notes=left(coalesce(p_notes,''),4000), adaptations=left(coalesce(p_adaptations,''),4000), substitutions=case when jsonb_typeof(coalesce(p_substitutions,'[]'::jsonb))='array' then p_substitutions else '[]'::jsonb end, status=case when p_complete then 'completed' else 'active' end, completed_at=case when p_complete then coalesce(completed_at,now()) else null end, updated_at=now() where id=p_session_id and coach_user_id=auth.uid() returning * into result;
  return to_jsonb(result);
end; $$;

-- Staff and members cannot be made Coach users by the administration helpers.
create or replace function public.coach_grant_permission(p_organisation_id uuid, p_user_id uuid, p_active boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result public.coach_permissions%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Coach permission administration denied' using errcode='42501'; end if;
  if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active and role='trainer') then raise exception 'Coach user is not eligible' using errcode='42501'; end if;
  insert into public.coach_permissions(organisation_id,user_id,granted_by,active) values(p_organisation_id,p_user_id,auth.uid(),p_active) on conflict (organisation_id,user_id) do update set active=excluded.active,granted_by=excluded.granted_by returning * into result;
  return to_jsonb(result);
end; $$;

create or replace function public.coach_assign_client(p_organisation_id uuid, p_coach_user_id uuid, p_client_user_id uuid, p_relationship_type text, p_programme_owner_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result public.coach_client_assignments%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Coach assignment administration denied' using errcode='42501'; end if;
  if p_relationship_type not in ('primary','cover') or not exists(select 1 from public.coach_permissions where organisation_id=p_organisation_id and user_id=p_coach_user_id and active) or not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_coach_user_id and active and role='trainer') then raise exception 'Invalid Coach assignment' using errcode='22023'; end if;
  if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_client_user_id and active) then raise exception 'Client is not an active member of this organisation' using errcode='42501'; end if;
  if p_relationship_type='primary' and p_programme_owner_user_id is distinct from p_coach_user_id then raise exception 'Primary assignment must be owned by the primary Coach' using errcode='22023'; end if;
  if p_relationship_type='cover' and not exists(select 1 from public.coach_client_assignments primary_assignment where primary_assignment.organisation_id=p_organisation_id and primary_assignment.client_user_id=p_client_user_id and primary_assignment.relationship_type='primary' and primary_assignment.active and primary_assignment.programme_owner_user_id=p_programme_owner_user_id) then raise exception 'Cover assignment must reference the active primary PT' using errcode='22023'; end if;
  insert into public.coach_client_assignments(organisation_id,coach_user_id,client_user_id,relationship_type,programme_owner_user_id,created_by) values(p_organisation_id,p_coach_user_id,p_client_user_id,p_relationship_type,coalesce(p_programme_owner_user_id,case when p_relationship_type='primary' then p_coach_user_id end),auth.uid()) on conflict (organisation_id,p_coach_user_id,p_client_user_id,p_relationship_type) do update set active=true,programme_owner_user_id=excluded.programme_owner_user_id returning * into result;
  return to_jsonb(result);
end; $$;

revoke all on function public.coach_has_access(uuid), public.coach_update_session(uuid,text,text,jsonb,boolean,jsonb), public.coach_grant_permission(uuid,uuid,boolean), public.coach_assign_client(uuid,uuid,uuid,text,uuid) from public, anon;
grant execute on function public.coach_has_access(uuid), public.coach_update_session(uuid,text,text,jsonb,boolean,jsonb), public.coach_grant_permission(uuid,uuid,boolean), public.coach_assign_client(uuid,uuid,uuid,text,uuid) to authenticated;
