begin;

do $$
begin
  if to_regclass('public.club_class_sessions') is null
     or to_regclass('public.club_madhouse_staff_assignments') is null
     or to_regclass('public.club_staff_access_grants') is null
     or to_regclass('public.club_members') is null
     or to_regclass('public.profiles') is null
     or to_regprocedure('public.club_has_active_role(uuid,text[])') is null then
    raise exception 'Class instructor identity prerequisites are missing';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_class_sessions' and column_name='organisation_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_class_sessions' and column_name='host_user_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_class_sessions' and column_name='instructor_assignment_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_madhouse_staff_assignments' and column_name='id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_madhouse_staff_assignments' and column_name='organisation_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_madhouse_staff_assignments' and column_name='canonical_name')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_madhouse_staff_assignments' and column_name='staff_grant_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_madhouse_staff_assignments' and column_name='linked_user_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_staff_access_grants' and column_name='id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_staff_access_grants' and column_name='organisation_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_staff_access_grants' and column_name='status')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_staff_access_grants' and column_name='accepted_by')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='organisation_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='user_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='role')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='active')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='first_name')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='last_name')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='display_name') then
    raise exception 'Class instructor identity columns are missing';
  end if;
end;
$$;

-- Return only identities already referenced by a class session in the
-- requested organisation. Pending prepared assignments are valid identities;
-- accepting an invitation is not required to display their canonical name.
create or replace function public.club_list_class_instructor_identities(p_organisation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
begin
  if auth.uid() is null
     or not public.club_has_active_role(p_organisation_id,array['trainer','gym_staff','gym_admin','owner']::text[]) then
    raise exception 'Class instructor identities are not permitted' using errcode='42501';
  end if;

  return coalesce((
    select jsonb_agg(identity order by sort_name)
    from (
      select distinct jsonb_build_object(
        'userId',m.user_id,
        'name',case
          when nullif(btrim(p.first_name),'') is not null and nullif(btrim(p.last_name),'') is not null
            then concat_ws(' ',btrim(p.first_name),btrim(p.last_name))
          else coalesce(nullif(btrim(p.display_name),''),nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),'Instructor name unavailable')
        end
      ) as identity, coalesce(nullif(btrim(p.last_name),''),nullif(btrim(p.display_name),''),'') as sort_name
      from public.club_class_sessions s
      join public.club_members m on m.organisation_id=s.organisation_id and m.user_id=s.host_user_id and m.active
        and m.role in ('trainer','gym_staff','gym_admin','owner')
      left join public.profiles p on p.id=m.user_id
      where s.organisation_id=p_organisation_id and s.host_user_id is not null

      union all

      select distinct jsonb_build_object(
        'assignmentId',a.id,
        'name',case
          when nullif(btrim(p.first_name),'') is not null and nullif(btrim(p.last_name),'') is not null
            then concat_ws(' ',btrim(p.first_name),btrim(p.last_name))
          else coalesce(nullif(btrim(a.canonical_name),''),nullif(btrim(p.display_name),''),'Instructor name unavailable')
        end
      ) as identity, coalesce(nullif(btrim(p.last_name),''),a.canonical_name,'') as sort_name
      from public.club_class_sessions s
      join public.club_madhouse_staff_assignments a
        on a.id=s.instructor_assignment_id and a.organisation_id=s.organisation_id
      left join public.club_staff_access_grants g
        on g.id=a.staff_grant_id and g.organisation_id=a.organisation_id and g.status='accepted' and g.accepted_by is not null
      left join public.club_members m
        on m.organisation_id=a.organisation_id and m.user_id=coalesce(a.linked_user_id,g.accepted_by) and m.active
        and m.role in ('trainer','gym_staff','gym_admin','owner')
      left join public.profiles p on p.id=m.user_id
      where s.organisation_id=p_organisation_id and s.instructor_assignment_id is not null
    ) scoped_identities
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.club_list_class_instructor_identities(uuid) from public,anon,authenticated;
grant execute on function public.club_list_class_instructor_identities(uuid) to authenticated;

commit;
