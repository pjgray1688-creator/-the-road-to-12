\set ON_ERROR_STOP on

do $$
declare
  expected_tables text[] := array[
    'nutrition_plans','nutrition_targets','nutrition_meals','nutrition_meal_items',
    'nutrition_meal_alternatives','nutrition_supplements','nutrition_daily_checkins',
    'nutrition_extras','nutrition_coach_feedback'
  ];
  expected_functions text[] := array[
    'nutrition_can_read_client(uuid)',
    'nutrition_can_manage_plan(uuid)',
    'nutrition_plan_json(uuid,boolean)',
    'nutrition_safe_timezone(uuid,text)',
    'nutrition_get_member_view(text)',
    'nutrition_get_coach_view(uuid,text)',
    'nutrition_save_draft(uuid,jsonb,uuid)',
    'nutrition_activate_plan(uuid)',
    'nutrition_save_daily_checkin(text,text,text)',
    'nutrition_add_extra(text,text,text,text)',
    'nutrition_update_extra(uuid,text,text,text,text)',
    'nutrition_delete_extra(uuid,text)',
    'nutrition_leave_feedback(uuid,uuid,text,boolean,boolean)'
  ];
  api_functions text[] := array[
    'nutrition_get_member_view(text)',
    'nutrition_get_coach_view(uuid,text)',
    'nutrition_save_draft(uuid,jsonb,uuid)',
    'nutrition_activate_plan(uuid)',
    'nutrition_save_daily_checkin(text,text,text)',
    'nutrition_add_extra(text,text,text,text)',
    'nutrition_update_extra(uuid,text,text,text,text)',
    'nutrition_delete_extra(uuid,text)',
    'nutrition_leave_feedback(uuid,uuid,text,boolean,boolean)'
  ];
  expected_signature text;
  target_oid oid;
  expected_api boolean;
  missing text;
begin
  select string_agg(t.name, ', ' order by t.name) into missing
  from unnest(expected_tables) as t(name)
  where to_regclass('public.'||t.name) is null;
  if missing is not null then raise exception 'Missing Nutrition tables: %',missing; end if;

  if (select count(*) from unnest(expected_tables) t(name)
      join pg_catalog.pg_class c on c.oid=to_regclass('public.'||t.name)
      where c.relkind='r' and c.relrowsecurity) <> cardinality(expected_tables) then
    raise exception 'RLS is not enabled on every Nutrition table';
  end if;
  if exists (
    select 1 from unnest(expected_tables) t(name)
    join pg_catalog.pg_class c on c.oid=to_regclass('public.'||t.name)
    where has_table_privilege('authenticated',c.oid,'SELECT')
       or has_table_privilege('authenticated',c.oid,'INSERT')
       or has_table_privilege('authenticated',c.oid,'UPDATE')
       or has_table_privilege('authenticated',c.oid,'DELETE')
       or has_table_privilege('anon',c.oid,'SELECT')
       or has_table_privilege('anon',c.oid,'INSERT')
       or has_table_privilege('anon',c.oid,'UPDATE')
       or has_table_privilege('anon',c.oid,'DELETE')
  ) then raise exception 'Direct Nutrition table privileges remain for authenticated or anon'; end if;
  if exists (
    select 1 from unnest(expected_tables) t(name)
    join pg_catalog.pg_class c on c.oid=to_regclass('public.'||t.name)
    cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
    where acl.grantee=0 and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
  ) then raise exception 'PUBLIC retains direct Nutrition table privileges'; end if;
  if exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname='public' and p.tablename=any(expected_tables)
  ) then raise exception 'Unexpected direct Nutrition table policy bypasses the RPC-only access boundary'; end if;

  foreach expected_signature in array expected_functions loop
    target_oid:=to_regprocedure('public.'||expected_signature);
    if target_oid is null then raise exception 'Missing Nutrition function: %',expected_signature; end if;
    if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid=target_oid) then
      raise exception 'Nutrition function is not SECURITY DEFINER: %',expected_signature;
    end if;
    if not exists(
      select 1 from pg_catalog.pg_proc p
      where p.oid=target_oid
        and regexp_replace(coalesce(array_to_string(p.proconfig,','),''),'\s','','g')
            like '%search_path=pg_catalog,public%'
    ) then raise exception 'Nutrition function search_path is not pinned: %',expected_signature; end if;

    if has_function_privilege('anon',target_oid,'EXECUTE') then
      raise exception 'anon can execute Nutrition function: %',expected_signature;
    end if;
    if exists(
      select 1 from pg_catalog.pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid=target_oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
    ) then raise exception 'PUBLIC can execute Nutrition function: %',expected_signature; end if;

    expected_api:=expected_signature=any(api_functions);
    if has_function_privilege('authenticated',target_oid,'EXECUTE') is distinct from expected_api then
      raise exception 'Unexpected authenticated EXECUTE grant for % (expected %)',expected_signature,expected_api;
    end if;
  end loop;

  if (select count(*) from unnest(expected_functions) f(signature)) <> 13 then
    raise exception 'Nutrition signature contract must contain exactly 13 functions';
  end if;
  raise notice 'Nutrition catalog verified: 9 RLS tables, 13 SECURITY DEFINER functions, pinned paths, restricted ACLs';
end $$;
