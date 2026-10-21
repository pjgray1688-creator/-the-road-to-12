-- Member setup preference and read-only view of the member's existing primary coach plan.
-- Coach assignment and block write permissions remain in the existing Coach RPCs.

create or replace function public.member_get_my_coach_plan()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_user uuid:=auth.uid();
  v_count integer;
  v_pending integer;
  v_coach uuid;
  v_relationship uuid;
  v_assignment uuid;
  v_org uuid;
  v_name text;
  v_definition jsonb;
  v_title text;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select count(*) into v_count from (
    select r.id from public.coach_relationships r where r.client_user_id=v_user and r.relationship_type='primary' and r.status='active'
    union all
    select a.id from public.coach_client_assignments a where a.client_user_id=v_user and a.relationship_type='primary' and a.active
  ) active_primary;
  select count(*) into v_pending from public.coach_relationships r where r.client_user_id=v_user and r.relationship_type='primary' and r.status='pending';
  if v_count=0 then
    return jsonb_build_object('state',case when v_pending>0 then 'awaiting' else 'none' end);
  end if;
  if v_count<>1 then return jsonb_build_object('state','awaiting'); end if;
  select source.coach_user_id,source.relationship_id,source.assignment_id,source.organisation_id
    into v_coach,v_relationship,v_assignment,v_org
  from (
    select coalesce(r.programme_owner_user_id,r.coach_user_id) coach_user_id,r.id relationship_id,null::uuid assignment_id,r.organisation_id,r.created_at
      from public.coach_relationships r where r.client_user_id=v_user and r.relationship_type='primary' and r.status='active'
    union all
    select coalesce(a.programme_owner_user_id,a.coach_user_id) coach_user_id,null::uuid,a.id assignment_id,a.organisation_id,a.created_at
      from public.coach_client_assignments a where a.client_user_id=v_user and a.relationship_type='primary' and a.active
  ) source order by source.created_at limit 1;
  select coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),p.display_name,'Your coach') into v_name from public.profiles p where p.id=v_coach;
  select b.title,b.definition into v_title,v_definition
    from public.coach_programmes p join public.coach_programme_blocks b on b.programme_id=p.id and b.status='active'
   where p.client_user_id=v_user and p.owner_coach_user_id=v_coach and p.status='active'
     and ((v_org is null and p.organisation_id is null and p.relationship_id=v_relationship)
       or (v_org is not null and p.organisation_id=v_org and p.assignment_id=v_assignment))
   order by b.activated_at desc nulls last limit 1;
  if v_definition is null then return jsonb_build_object('state','awaiting','coachName',v_name); end if;
  return jsonb_build_object('state','assigned','coachName',v_name,'title',coalesce(v_title,v_definition->>'name'),'programme',v_definition);
end; $$;
revoke all on function public.member_get_my_coach_plan() from public,anon;
grant execute on function public.member_get_my_coach_plan() to authenticated;

create or replace function public.member_mark_active_coach_programme()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if tg_op='INSERT' then
    if new.status='active' then
      update public.profiles p set training_profile=coalesce(p.training_profile,'{}'::jsonb)||jsonb_build_object('_programmeSource','coach'),updated_at=now()
       where p.id=(select client_user_id from public.coach_programmes where id=new.programme_id);
    end if;
    return new;
  end if;
  if new.status='active' then
    update public.profiles p set training_profile=coalesce(p.training_profile,'{}'::jsonb)||jsonb_build_object('_programmeSource','coach'),updated_at=now()
     where p.id=(select client_user_id from public.coach_programmes where id=new.programme_id);
  elsif tg_op='UPDATE' and old.status='active' then
    if not exists(select 1 from public.coach_programme_blocks b where b.programme_id=new.programme_id and b.id<>new.id and b.status='active') then
      update public.profiles p set training_profile=coalesce(p.training_profile,'{}'::jsonb)-'_programmeSource',updated_at=now()
       where p.id=(select client_user_id from public.coach_programmes where id=new.programme_id)
         and p.training_profile->>'_programmeSource'='coach';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.member_mark_active_coach_programme() from public,anon,authenticated;
drop trigger if exists member_mark_active_coach_programme on public.coach_programme_blocks;
create trigger member_mark_active_coach_programme after insert or update on public.coach_programme_blocks
for each row execute function public.member_mark_active_coach_programme();

-- Existing coach-activated projections are protected from a personal-plan overwrite.
update public.profiles p set training_profile=coalesce(p.training_profile,'{}'::jsonb)||jsonb_build_object('_programmeSource','coach'),updated_at=now()
 where p.active_programme_id is not null and exists (
   select 1 from public.coach_programmes cp join public.coach_programme_blocks b on b.programme_id=cp.id and b.status='active'
    where cp.client_user_id=p.id
 );
