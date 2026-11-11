-- Production-applied SQL source record.
-- This function was applied separately in Production on 11 November 2026.
-- Reference only: do not execute or add this file to a migration runner.

create or replace function public.club_set_my_home_location_self(p_organisation_id uuid,p_location_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_slug text; v_location_name text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select slug into v_slug from public.club_organisations where id=p_organisation_id and active;
  if v_slug is distinct from 'madhouse-gym' then raise exception 'Home gym update is not available' using errcode='42501'; end if;
  if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active) then
    raise exception 'An active Madhouse member profile is required' using errcode='42501';
  end if;
  select lower(name) into v_location_name from public.club_locations
    where id=p_location_id and organisation_id=p_organisation_id and active for share;
  if not found or (v_location_name not like '%rotherham%' and v_location_name not like '%carlton%') then
    raise exception 'Choose an active Madhouse Rotherham or Carlton gym' using errcode='22023';
  end if;
  update public.club_members set preferred_location_id=p_location_id
    where organisation_id=p_organisation_id and user_id=auth.uid() and active;
end; $$;
revoke all on function public.club_set_my_home_location_self(uuid,uuid) from public,anon;
grant execute on function public.club_set_my_home_location_self(uuid,uuid) to authenticated;
