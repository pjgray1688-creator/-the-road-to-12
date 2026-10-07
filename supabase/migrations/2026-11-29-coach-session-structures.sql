-- Additive validation for explicit Coach session structures.
-- Existing sessions remain valid because an absent `structures` property means
-- the original straight-set model. This migration does not change ownership
-- or grant any new programme write authority.

create or replace function public.coach_validate_session_structures(p_definition jsonb)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_session jsonb;
  v_structure jsonb;
  v_exercise jsonb;
  v_settings jsonb;
  v_type text;
  v_id text;
  v_session_number integer:=0;
  v_structure_number integer;
  v_exercise_number integer;
  v_claimed text[]:=array[]::text[];
  v_minimum integer;
begin
  if p_definition is null or jsonb_typeof(p_definition->'week') is distinct from 'array' then
    return;
  end if;

  for v_session in select value from jsonb_array_elements(p_definition->'week') loop
    v_session_number:=v_session_number+1;
    v_claimed:=array[]::text[];
    if not (v_session ? 'structures') then continue; end if;
    if jsonb_typeof(v_session->'structures') is distinct from 'array' then
      raise exception 'Block session % structures must be an array',v_session_number using errcode='22023';
    end if;
    if jsonb_array_length(v_session->'structures')>100 then
      raise exception 'Block session % has too many structures',v_session_number using errcode='22023';
    end if;
    v_structure_number:=0;
    for v_structure in select value from jsonb_array_elements(v_session->'structures') loop
      v_structure_number:=v_structure_number+1;
      if jsonb_typeof(v_structure) is distinct from 'object' then
        raise exception 'Block session % structure % must be an object',v_session_number,v_structure_number using errcode='22023';
      end if;
      if jsonb_typeof(v_structure->'id') is distinct from 'string' or nullif(btrim(v_structure->>'id'),'') is null or length(v_structure->>'id')>160 then
        raise exception 'Block session % structure % id is invalid',v_session_number,v_structure_number using errcode='22023';
      end if;
      v_type:=v_structure->>'type';
      if v_type is null or v_type not in ('straight','superset','triset','giant_set','circuit','drop_set','mechanical_drop','rest_pause','cluster','emom','amrap','interval','ladder','pyramid','complex') then
        raise exception 'Block session % structure % type is invalid',v_session_number,v_structure_number using errcode='22023';
      end if;
      if jsonb_typeof(v_structure->'exerciseIds') is distinct from 'array' or jsonb_array_length(v_structure->'exerciseIds')=0 then
        raise exception 'Block session % structure % exercises are required',v_session_number,v_structure_number using errcode='22023';
      end if;
      v_minimum:=case v_type when 'superset' then 2 when 'triset' then 3 when 'giant_set' then 4 when 'circuit' then 2 when 'complex' then 2 else 1 end;
      if jsonb_array_length(v_structure->'exerciseIds')<v_minimum then
        raise exception 'Block session % structure % has too few exercises',v_session_number,v_structure_number using errcode='22023';
      end if;
      v_exercise_number:=0;
      for v_exercise in select value from jsonb_array_elements(v_structure->'exerciseIds') loop
        v_exercise_number:=v_exercise_number+1;
        if jsonb_typeof(v_exercise) is distinct from 'string' or nullif(btrim(v_exercise#>>'{}'),'') is null or length(v_exercise#>>'{}')>160 then
          raise exception 'Block session % structure % exercise % is invalid',v_session_number,v_structure_number,v_exercise_number using errcode='22023';
        end if;
        v_id:=v_exercise#>>'{}';
        if not exists (select 1 from jsonb_array_elements_text(v_session->'exerciseIds') item where item=v_id) then
          raise exception 'Block session % structure % references an exercise outside the session',v_session_number,v_structure_number using errcode='22023';
        end if;
        if v_id=any(v_claimed) then raise exception 'An exercise belongs to more than one structure' using errcode='22023'; end if;
        v_claimed:=array_append(v_claimed,v_id);
      end loop;
      if v_structure ? 'settings' then
        v_settings:=v_structure->'settings';
        if jsonb_typeof(v_settings) is distinct from 'object' then raise exception 'Block session % structure % settings are invalid',v_session_number,v_structure_number using errcode='22023'; end if;
        if (select count(*) from jsonb_object_keys(v_settings))>24 then raise exception 'Block session % structure % has too many settings',v_session_number,v_structure_number using errcode='22023'; end if;
        if v_type in ('ladder','pyramid') and nullif(btrim(v_settings->>'steps'),'') is null then raise exception 'Block session % structure % steps are required',v_session_number,v_structure_number using errcode='22023'; end if;
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function public.coach_validate_session_structures_trigger()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  perform public.coach_validate_session_structures(new.definition);
  return new;
end;
$$;

drop trigger if exists coach_validate_session_structures_before_write on public.coach_programme_blocks;
create trigger coach_validate_session_structures_before_write
before insert or update of definition on public.coach_programme_blocks
for each row execute function public.coach_validate_session_structures_trigger();

revoke all on function public.coach_validate_session_structures(jsonb) from public,anon,authenticated;
revoke all on function public.coach_validate_session_structures_trigger() from public,anon,authenticated;
