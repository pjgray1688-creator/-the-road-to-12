-- Resolve linked R12 account identity for authorised Club staff.
-- This reads the existing public profile projection and does
-- not grant browser table access. Review and execute in the target environment.

create or replace function public.club_resolve_member_identity(p_organisation_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then
    raise exception 'Member identity is not permitted' using errcode='42501';
  end if;
  if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active) then
    raise exception 'Club member not found' using errcode='P0002';
  end if;
  return coalesce((select jsonb_build_object('user_id',p_user_id,'display_name',nullif(btrim(p.display_name),''),'email',nullif(btrim(p.email),'')) from public.profiles p where p.id=p_user_id),'{}'::jsonb);
end; $$;

create or replace function public.club_list_member_identities(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then
    raise exception 'Member identity directory is not permitted' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',nullif(btrim(p.display_name),''),'email',nullif(btrim(p.email),'')) order by m.created_at) from public.club_members m left join public.profiles p on p.id=m.user_id where m.organisation_id=p_organisation_id and m.active),'[]'::jsonb);
end; $$;

create or replace function public.club_list_member_summaries(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Member directory is not permitted' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'user_id',m.user_id,'role',m.role,'active',m.active,'display_name',coalesce(nullif(c.display_name,''),nullif(p.display_name,''),nullif(p.email,''),'Club member'),'email',coalesce(nullif(c.email,''),nullif(p.email,'')),'membership_name',current_membership.product_name,'membership_status',current_membership.status,'membership_ends_at',current_membership.ends_at,'home_location',case when l.id is null then null else jsonb_build_object('id',l.id,'name',l.name) end,'access_state',(public.club_evaluate_member_access(p_organisation_id,m.user_id)->>'state')) order by coalesce(nullif(c.display_name,''),nullif(p.display_name,''),nullif(p.email,''),'Club member'),m.created_at) from public.club_members m left join public.club_customers c on c.organisation_id=m.organisation_id and c.user_id=m.user_id left join public.profiles p on p.id=m.user_id left join public.club_locations l on l.id=m.preferred_location_id and l.organisation_id=m.organisation_id left join lateral (select ms.id,p2.name product_name,ms.status,ms.ends_at from public.club_memberships ms join public.club_products p2 on p2.id=ms.product_id and p2.organisation_id=ms.organisation_id where ms.organisation_id=p_organisation_id and exists(select 1 from public.club_membership_holders h where h.membership_id=ms.id and h.user_id=m.user_id) order by (ms.status='active') desc,ms.starts_at desc limit 1) current_membership on true where m.organisation_id=p_organisation_id and m.active),'[]'::jsonb);
end; $$;

revoke all on function public.club_resolve_member_identity(uuid,uuid),public.club_list_member_identities(uuid) from public;
grant execute on function public.club_resolve_member_identity(uuid,uuid),public.club_list_member_identities(uuid) to authenticated;
