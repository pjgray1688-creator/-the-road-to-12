-- Forward-only production hotfix for Madhouse checklist seeding and staff
-- invitation name matching. This SQL changes function definitions and records
-- the canonical migration checksum atomically; it does not seed or alter data.
BEGIN;
create or replace function public.club_madhouse_seed_daily_checks(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare
  v_actor_role text;
  v_location record;
  v_template_id uuid;
  v_item record;
  v_inserted integer := 0;
  v_location_id uuid;
  v_matches integer;
begin
  if auth.uid() is null
    or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner'])
    or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_review') then
    raise exception 'Daily check setup is restricted to authorised management' using errcode='42501';
  end if;

  select member.role into v_actor_role
  from public.club_members as member
  where member.organisation_id=p_organisation_id
    and member.user_id=auth.uid()
    and member.active;

  for v_location in
    select locations.location_key,locations.location_name
    from (values ('Rotherham','Rotherham'),('Carlton','Carlton'))
      as locations(location_key,location_name)
  loop
    select count(*),min(location.id::text)::uuid
    into v_matches,v_location_id
    from public.club_locations as location
    where location.organisation_id=p_organisation_id
      and location.active
      and lower(btrim(location.name))=lower(v_location.location_name);

    if v_matches<>1 then
      raise exception 'Daily checks require exactly one active % location',v_location.location_name using errcode='55000';
    end if;

    insert into public.club_checklist_templates as target_template
      (organisation_id,name,check_type,active,created_by,source_key)
    values
      (p_organisation_id,'Madhouse daily checks · '||v_location.location_name,'daily',true,auth.uid(),'madhouse-daily-'||lower(v_location.location_key))
    on conflict (organisation_id,source_key) where source_key is not null
    do update set
      name=excluded.name,
      check_type='daily',
      active=true,
      updated_at=now()
    returning target_template.id into v_template_id;

    insert into public.club_checklist_template_locations as target_location
      (template_id,organisation_id,location_id,assigned_by)
    values
      (v_template_id,p_organisation_id,v_location_id,auth.uid())
    on conflict (template_id,location_id) do nothing;

    for v_item in
      select source.item_key,source.section,source.label,source.weekday
      from (values
        ('routine-bins','Routine','Empty bins when full',null::smallint),
        ('routine-hoover','Routine','Hoover',null::smallint),
        ('routine-touch-points','Routine','Wipe touch points',null::smallint),
        ('routine-upholstery','Routine','Spray-clean equipment upholstery',null::smallint),
        ('routine-metal-frames','Routine','Clean equipment metal frames',null::smallint),
        ('routine-reception','Routine','Organise reception and desk area',null::smallint),
        ('routine-weights','Routine','Return loose weights to correct positions',null::smallint),
        ('monday-toilets','Scheduled','Deep-clean toilets',1::smallint),
        ('tuesday-mirrors','Scheduled',case when v_location.location_key='Carlton' then 'Clean gym, toilet and sunbed mirrors' else 'Clean gym and toilet mirrors' end,2::smallint),
        ('thursday-toilets','Scheduled','Deep-clean toilets',4::smallint),
        ('carlton-tuesday-sunbeds','Scheduled','Deep-clean Carlton sunbed rooms',2::smallint),
        ('carlton-saturday-sunbeds','Scheduled','Deep-clean Carlton sunbed rooms',6::smallint),
        ('rotherham-wednesday-mats','Scheduled','Steam-clean mats · Rotherham',3::smallint),
        ('carlton-thursday-mats','Scheduled','Steam-clean mats · Carlton',4::smallint)
      ) as source(item_key,section,label,weekday)
      where (v_location.location_key='Carlton'
          or source.item_key not in ('carlton-tuesday-sunbeds','carlton-saturday-sunbeds','carlton-thursday-mats'))
        and (v_location.location_key='Rotherham' or source.item_key<>'rotherham-wednesday-mats')
    loop
      insert into public.club_checklist_items as target_item
        (template_id,organisation_id,section,label,required,sort_order,active,created_by,source_key,scheduled_weekday)
      values
        (v_template_id,p_organisation_id,v_item.section,v_item.label,true,
         case when v_item.weekday is null then 10 else 20+v_item.weekday end,
         true,auth.uid(),v_item.item_key,v_item.weekday)
      on conflict (template_id,source_key) where source_key is not null
      do update set
        section=excluded.section,
        label=excluded.label,
        required=true,
        sort_order=excluded.sort_order,
        active=true,
        scheduled_weekday=excluded.scheduled_weekday,
        updated_at=now();

      v_inserted:=v_inserted+1;
    end loop;

    perform public.club_append_audit_event(
      p_organisation_id,
      'venue.madhouse_checks_seeded',
      'checklist_template',
      v_template_id,
      v_location_id,
      null,
      jsonb_build_object('source','madhouse-weekly-checks','actor_role',v_actor_role)
    );
  end loop;

  return jsonb_build_object('templates',2,'items',v_inserted,'locations',2);
end; $$;

create or replace function public.club_madhouse_attach_staff_invitation(p_organisation_id uuid,p_assignment_id uuid,p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare a public.club_madhouse_staff_assignments%rowtype; g public.club_staff_access_grants%rowtype; old_role text; old_coach boolean;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then raise exception 'Staff assignment management is not permitted' using errcode='42501'; end if;
  select * into a from public.club_madhouse_staff_assignments where id=p_assignment_id and organisation_id=p_organisation_id and active for update;
  select * into g from public.club_staff_access_grants where id=p_grant_id and organisation_id=p_organisation_id and status in ('pending','accepted') and (status='accepted' or expires_at>now()) for update;
  if not found or a.id is null then raise exception 'Staff assignment or valid invitation not found' using errcode='P0002'; end if;
  if regexp_replace(lower(split_part(coalesce(g.display_name,''),' ',1)),'[^a-z]','','g')<>a.normalized_name then raise exception 'Invitation name does not match the prepared staff identity' using errcode='22023'; end if;
  if g.status='pending' then
    old_role:=g.intended_role; old_coach:=g.coach_requested;
    update public.club_staff_access_grants set intended_role='trainer',capabilities=public.club_capabilities_for_role('trainer'),coach_requested=true,location_ids=a.location_ids where id=g.id returning * into g;
  elsif g.intended_role not in ('trainer','gym_admin') or not g.coach_requested or not (a.location_ids <@ g.location_ids) then
    raise exception 'Accepted instructor access does not match the prepared role and locations' using errcode='42501';
  end if;
  update public.club_madhouse_staff_assignments set staff_grant_id=g.id where id=a.id;
  if g.status='accepted' then
    update public.club_class_sessions set host_user_id=g.accepted_by where instructor_assignment_id=a.id and host_user_id is null and starts_at>now();
    update public.club_staff_rota_shifts set staff_user_id=g.accepted_by,staff_assignment_id=null where staff_assignment_id=a.id and work_date>=(now() at time zone 'Europe/London')::date;
  end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    select p_organisation_id,auth.uid(),m.role,'staff.operational_identity_linked','staff_assignment',a.id,jsonb_build_object('grant_id',g.id,'status',g.status,'previous_role',old_role,'previous_coach_requested',old_coach,'prepared_role',g.intended_role,'coach_requested',g.coach_requested,'location_ids',g.location_ids) from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid();
  return jsonb_build_object('assignment_id',a.id,'grant_id',g.id,'status',g.status);
end; $$;

revoke all on function public.club_madhouse_seed_daily_checks(uuid) from public,anon;
grant execute on function public.club_madhouse_seed_daily_checks(uuid) to authenticated;
revoke all on function public.club_madhouse_attach_staff_invitation(uuid,uuid,uuid) from public,anon;
grant execute on function public.club_madhouse_attach_staff_invitation(uuid,uuid,uuid) to authenticated;

DO $migration_ledger$
DECLARE
  v_migration_name constant text := 'supabase/migrations/2027-01-15-madhouse-daily-checks-final-fix.sql';
  v_expected_checksum constant text := '4a234f638aab6d48eff3a4319ca4eb8b043e47c30c28ad174828cd2b2212eae7';
  v_actual_checksum text;
BEGIN
  SELECT ledger.checksum INTO v_actual_checksum
  FROM public.r12_schema_migrations AS ledger
  WHERE ledger.migration_name=v_migration_name
  FOR UPDATE;

  IF FOUND AND v_actual_checksum IS DISTINCT FROM v_expected_checksum THEN
    RAISE EXCEPTION 'Migration checksum mismatch for %',v_migration_name;
  END IF;

  INSERT INTO public.r12_schema_migrations(migration_name,checksum,source,note)
  VALUES(v_migration_name,v_expected_checksum,'manual-hotfix','Madhouse daily-check ambiguity and staff-name normalization correction')
  ON CONFLICT (migration_name) DO NOTHING;

  SELECT ledger.checksum INTO v_actual_checksum
  FROM public.r12_schema_migrations AS ledger
  WHERE ledger.migration_name=v_migration_name;

  IF v_actual_checksum IS DISTINCT FROM v_expected_checksum THEN
    RAISE EXCEPTION 'Migration checksum mismatch for %',v_migration_name;
  END IF;
END;
$migration_ledger$;

COMMIT;
