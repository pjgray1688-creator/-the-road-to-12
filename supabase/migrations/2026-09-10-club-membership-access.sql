-- R12 Club membership/access read foundation (forward-only; review before execution).
-- No member assignments or user-specific backfills are performed here. Home gym is
-- a preference; entitlement scope remains the authority for location access.

do $$ begin
  if not exists (select 1 from pg_constraint where conname='club_locations_id_organisation_key') then
    alter table public.club_locations add constraint club_locations_id_organisation_key unique (id, organisation_id);
  end if;
end $$;

alter table public.club_members
  add column if not exists preferred_location_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='club_members_preferred_location_fk') then
    alter table public.club_members add constraint club_members_preferred_location_fk foreign key (preferred_location_id, organisation_id) references public.club_locations(id, organisation_id);
  end if;
end $$;

create index if not exists club_members_preferred_location_idx
  on public.club_members(organisation_id, preferred_location_id);

comment on column public.club_members.preferred_location_id is
  'Optional home/preferred gym. This preference never narrows membership entitlement scope.';

create or replace function public.club_get_member_operational_profile(
  p_organisation_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_member public.club_members%rowtype;
begin
  if auth.uid() is null then raise exception 'Club authentication required' using errcode='42501'; end if;
  select * into v_member from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active;
  if not found then raise exception 'Club member not found' using errcode='P0002'; end if;
  if auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id, array['gym_staff','gym_admin','owner']) then
    raise exception 'Club member profile is not permitted' using errcode='42501';
  end if;
  return jsonb_build_object(
    'member', jsonb_build_object('id',v_member.id,'organisation_id',v_member.organisation_id,'user_id',v_member.user_id,'role',v_member.role,'active',v_member.active),
    'home_location', (select jsonb_build_object('id',l.id,'name',l.name,'active',l.active) from public.club_locations l where l.id=v_member.preferred_location_id and l.organisation_id=p_organisation_id),
    'customer', (select jsonb_build_object('id',c.id,'display_name',c.display_name,'email',c.email,'phone',c.phone,'status',c.status) from public.club_customers c where c.organisation_id=p_organisation_id and c.user_id=p_user_id),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'product_id',m.product_id,'product_name',p.name,'status',m.status,'starts_at',m.starts_at,'ends_at',m.ends_at,'source',m.source,'holder_user_ids',(select coalesce(jsonb_agg(h.user_id),'[]'::jsonb) from public.club_membership_holders h where h.membership_id=m.id))) from public.club_memberships m join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id where m.organisation_id=p_organisation_id and exists (select 1 from public.club_membership_holders h where h.membership_id=m.id and h.user_id=p_user_id)),'[]'::jsonb),
    'entitlements', coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'entitlement_key',g.entitlement_key,'scope',g.scope,'location_ids',g.location_ids,'starts_at',g.starts_at,'ends_at',g.ends_at,'source',g.source,'allowance_quantity',g.allowance_quantity,'allowance_period',g.allowance_period,'discount_percent',g.discount_percent,'discount_period',g.discount_period,'discount_max_uses',g.discount_max_uses)) from public.club_entitlement_grants g where g.organisation_id=p_organisation_id and g.user_id=p_user_id),'[]'::jsonb),
    'service_credits', coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'credit_key',a.credit_key,'unit',a.unit,'status',a.status,'balance_quantity',coalesce((select sum(e.quantity_delta) from public.club_service_credit_entries e where e.account_id=a.id),0))) from public.club_service_credit_accounts a where a.organisation_id=p_organisation_id and (a.user_id=p_user_id or exists(select 1 from public.club_customers c where c.id=a.customer_id and c.user_id=p_user_id))),'[]'::jsonb)
  );
end; $$;

create or replace function public.club_list_member_summaries(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Member directory is not permitted' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'user_id',m.user_id,'role',m.role,'active',m.active,'display_name',coalesce(c.display_name,'Club member'),'email',c.email,'membership_name',current_membership.product_name,'membership_status',current_membership.status,'membership_ends_at',current_membership.ends_at,'home_location',case when l.id is null then null else jsonb_build_object('id',l.id,'name',l.name) end,'access_state',case when exists(select 1 from public.club_entitlement_grants g where g.organisation_id=p_organisation_id and g.user_id=m.user_id and g.entitlement_key='gym_access' and g.starts_at<=now() and (g.ends_at is null or g.ends_at>now())) then 'active' when current_membership.id is not null then 'needs_attention' else 'unavailable' end) order by coalesce(c.display_name,'Club member'),m.created_at) from public.club_members m left join public.club_customers c on c.organisation_id=m.organisation_id and c.user_id=m.user_id left join public.club_locations l on l.id=m.preferred_location_id and l.organisation_id=m.organisation_id left join lateral (select ms.id,p.name product_name,ms.status,ms.ends_at from public.club_memberships ms join public.club_products p on p.id=ms.product_id and p.organisation_id=ms.organisation_id where ms.organisation_id=p_organisation_id and exists(select 1 from public.club_membership_holders h where h.membership_id=ms.id and h.user_id=m.user_id) order by (ms.status='active') desc,ms.starts_at desc limit 1) current_membership on true where m.organisation_id=p_organisation_id and m.active),'[]'::jsonb);
end; $$;

create or replace function public.club_check_member_location_access(
  p_organisation_id uuid,
  p_user_id uuid,
  p_location_id uuid,
  p_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_location public.club_locations%rowtype; v_grant public.club_entitlement_grants%rowtype;
begin
  if auth.uid() is null then raise exception 'Club authentication required' using errcode='42501'; end if;
  if auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Location eligibility is not permitted' using errcode='42501'; end if;
  select * into v_location from public.club_locations where id=p_location_id and organisation_id=p_organisation_id;
  if not found or not v_location.active then return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','location_inactive'); end if;
  select g.* into v_grant from public.club_entitlement_grants g join public.club_membership_holders h on h.membership_id=g.membership_id and h.user_id=g.user_id join public.club_memberships m on m.id=g.membership_id and m.organisation_id=g.organisation_id and m.status='active' where g.organisation_id=p_organisation_id and g.user_id=p_user_id and g.entitlement_key='gym_access' and g.starts_at<=p_at and (g.ends_at is null or g.ends_at>p_at) and (g.scope in ('organisation','future_locations') or (g.scope='locations' and p_location_id=any(g.location_ids))) order by g.ends_at nulls last,g.starts_at desc limit 1;
  if found then return jsonb_build_object('allowed',true,'organisation_id',p_organisation_id,'location_id',p_location_id,'membership_id',v_grant.membership_id,'source',v_grant.source,'valid_from',v_grant.starts_at,'valid_until',v_grant.ends_at,'access_policy',v_grant.scope); end if;
  if exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.starts_at>p_at) then return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','membership_not_started'); end if;
  if exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.ends_at is not null and m.ends_at<=p_at) then return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','membership_expired'); end if;
  return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','gym_access_missing');
end; $$;

create or replace function public.club_set_member_home_location(p_organisation_id uuid,p_user_id uuid,p_location_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Home location update is not permitted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active) or not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'Home location is invalid' using errcode='22023'; end if;
  update public.club_members set preferred_location_id=p_location_id where organisation_id=p_organisation_id and user_id=p_user_id;
  return public.club_get_member_operational_profile(p_organisation_id,p_user_id);
end; $$;

revoke all on function public.club_get_member_operational_profile(uuid,uuid),public.club_list_member_summaries(uuid),public.club_check_member_location_access(uuid,uuid,uuid,timestamptz),public.club_set_member_home_location(uuid,uuid,uuid) from public;
grant execute on function public.club_get_member_operational_profile(uuid,uuid),public.club_list_member_summaries(uuid),public.club_check_member_location_access(uuid,uuid,uuid,timestamptz),public.club_set_member_home_location(uuid,uuid,uuid) to authenticated;
