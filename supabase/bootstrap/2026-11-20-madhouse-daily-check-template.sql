-- Reviewed manual bootstrap artifact for Madhouse venue checks.
-- Do not run automatically. Execute only in a reviewed environment with the
-- existing organisation and an existing authenticated management user's UUID.
--
-- Before running, set both values in the same SQL session:
--   select set_config('r12.bootstrap_organisation_id', '<existing-org-uuid>', false);
--   select set_config('r12.bootstrap_actor_id', '<existing-auth-user-uuid>', false);
--
-- This creates one idempotent daily venue template and assigns it to every
-- existing active venue. It creates no equipment, membership, Coach access,
-- Auth user, or production transaction.

do $$
declare
  v_organisation_id uuid := nullif(current_setting('r12.bootstrap_organisation_id', true), '')::uuid;
  v_actor_id uuid := nullif(current_setting('r12.bootstrap_actor_id', true), '')::uuid;
  v_template_id uuid;
  v_location record;
  v_item record;
begin
  if v_organisation_id is null or v_actor_id is null then
    raise exception 'Set r12.bootstrap_organisation_id and r12.bootstrap_actor_id in this session first';
  end if;
  if not exists(select 1 from public.club_organisations where id=v_organisation_id and slug='madhouse-gym' and active) then
    raise exception 'The supplied organisation is not the active Madhouse organisation';
  end if;
  if not exists(select 1 from auth.users where id=v_actor_id) then
    raise exception 'The supplied bootstrap actor is not an existing Auth user';
  end if;
  select id into v_template_id from public.club_checklist_templates where organisation_id=v_organisation_id and name='Madhouse daily venue checks' and check_type='daily' limit 1;
  if v_template_id is null then
    insert into public.club_checklist_templates(organisation_id,name,check_type,created_by)
      values(v_organisation_id,'Madhouse daily venue checks','daily',v_actor_id)
      returning id into v_template_id;
  end if;
  for v_location in select id from public.club_locations where organisation_id=v_organisation_id and active loop
    insert into public.club_checklist_template_locations(template_id,organisation_id,location_id,assigned_by)
      values(v_template_id,v_organisation_id,v_location.id,v_actor_id)
      on conflict(template_id,location_id) do nothing;
  end loop;
  for v_item in select * from (values
    ('Safety','Entrances and exits clear',10),
    ('Safety','Emergency exits clear',20),
    ('Safety','First aid kit present and stocked',30),
    ('Safety','Obvious trip or slip hazards absent',40),
    ('Facilities','Changing rooms and toilets acceptable',50),
    ('Facilities','General cleanliness acceptable',60),
    ('Operations','Lighting and reception/POS area checked',70),
    ('Operations','Access and door system visual status checked',80)
  ) as defaults(section,label,sort_order) loop
    if not exists(select 1 from public.club_checklist_items where template_id=v_template_id and organisation_id=v_organisation_id and label=v_item.label) then
      insert into public.club_checklist_items(template_id,organisation_id,section,label,required,sort_order,created_by)
        values(v_template_id,v_organisation_id,v_item.section,v_item.label,true,v_item.sort_order,v_actor_id);
    end if;
  end loop;
end $$;
