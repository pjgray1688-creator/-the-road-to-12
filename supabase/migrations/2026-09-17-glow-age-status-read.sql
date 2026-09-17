-- Allow authorised Club staff to read a member's retained Glow Zone age status.
-- Read-only security-definer boundary avoids relying on client table RLS for the operational screen.
create or replace function public.club_glow_age_status(p_organisation_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.club_glow_age_verifications%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id, array['gym_staff','gym_admin','owner']) then
    raise exception 'Glow Zone age status is not permitted' using errcode = '42501';
  end if;
  select * into v_row
  from public.club_glow_age_verifications
  where organisation_id = p_organisation_id and user_id = p_user_id;
  return case when v_row.user_id is null then null else jsonb_build_object('date_of_birth', v_row.date_of_birth, 'status', v_row.status) end;
end;
$$;
revoke all on function public.club_glow_age_status(uuid, uuid) from public, anon, authenticated;
grant execute on function public.club_glow_age_status(uuid, uuid) to authenticated;
