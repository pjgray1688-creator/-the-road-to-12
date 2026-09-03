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

create or replace function public.club_evaluate_member_access(p_organisation_id uuid,p_user_id uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_has_membership boolean; v_has_future boolean; v_has_expired boolean; v_grant record; v_policy text; v_locations uuid[]; v_allowed boolean;
begin
  if auth.uid() is null or (auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner'])) then raise exception 'Location eligibility is not permitted' using errcode='42501'; end if;
  select exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id), exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.starts_at>p_at), exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.ends_at is not null and m.ends_at<=p_at) into v_has_membership,v_has_future,v_has_expired;
  select g.* into v_grant from public.club_entitlement_grants g where g.organisation_id=p_organisation_id and g.user_id=p_user_id and g.entitlement_key='gym_access' and g.starts_at<=p_at and (g.ends_at is null or g.ends_at>p_at) and (g.membership_id is null or exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.id=g.membership_id and m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at))) order by (g.scope='future_locations') desc,g.ends_at nulls last limit 1;
  if found then v_policy:=v_grant.scope; v_locations:=coalesce(v_grant.location_ids,'{}'); end if;
  v_allowed:=found and (v_policy='future_locations' or exists(select 1 from public.club_locations l where l.organisation_id=p_organisation_id and l.active and ((v_policy='organisation' and (coalesce(array_length(v_locations,1),0)=0 or l.id=any(v_locations)) or v_policy='locations' and l.id=any(v_locations)))));
  return jsonb_build_object('state',case when v_allowed then 'active' when v_has_membership and exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at)) then 'needs_attention' else 'unavailable' end,'reason',case when not v_has_membership and not found then 'no_membership' when v_has_future and not exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at)) then 'membership_not_started' when v_has_expired and not found then 'membership_expired' when v_has_membership and not exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at)) then 'membership_inactive' when not found then 'gym_access_missing' when not v_allowed then 'location_not_included' else null end,'policy',v_policy,'permitted_location_ids',case when v_policy='future_locations' then null else to_jsonb(v_locations) end);
end; $$;

create or replace function public.club_list_member_summaries(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Member directory is not permitted' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'user_id',m.user_id,'role',m.role,'active',m.active,'display_name',coalesce(c.display_name,'Club member'),'email',c.email,'membership_name',current_membership.product_name,'membership_status',current_membership.status,'membership_ends_at',current_membership.ends_at,'home_location',case when l.id is null then null else jsonb_build_object('id',l.id,'name',l.name) end,'access_state',(public.club_evaluate_member_access(p_organisation_id,m.user_id)->>'state')) order by coalesce(c.display_name,'Club member'),m.created_at) from public.club_members m left join public.club_customers c on c.organisation_id=m.organisation_id and c.user_id=m.user_id left join public.club_locations l on l.id=m.preferred_location_id and l.organisation_id=m.organisation_id left join lateral (select ms.id,p.name product_name,ms.status,ms.starts_at,ms.ends_at from public.club_memberships ms join public.club_products p on p.id=ms.product_id and p.organisation_id=ms.organisation_id where ms.organisation_id=p_organisation_id and exists(select 1 from public.club_membership_holders h where h.membership_id=ms.id and h.user_id=m.user_id) order by (ms.status='active') desc,ms.starts_at desc limit 1) current_membership on true where m.organisation_id=p_organisation_id and m.active),'[]'::jsonb);
end; $$;

create or replace function public.club_get_member_operational_profile(p_organisation_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_member public.club_members%rowtype; v_access jsonb;
begin
  if auth.uid() is null then raise exception 'Club authentication required' using errcode='42501'; end if;
  select * into v_member from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active;
  if not found then raise exception 'Club member not found' using errcode='P0002'; end if;
  if auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Club member profile is not permitted' using errcode='42501'; end if;
  v_access:=public.club_evaluate_member_access(p_organisation_id,p_user_id);
  return jsonb_build_object('member',jsonb_build_object('id',v_member.id,'organisation_id',v_member.organisation_id,'user_id',v_member.user_id,'role',v_member.role,'active',v_member.active),'home_location',(select jsonb_build_object('id',l.id,'name',l.name,'active',l.active) from public.club_locations l where l.id=v_member.preferred_location_id and l.organisation_id=p_organisation_id),'customer',(select jsonb_build_object('id',c.id,'display_name',c.display_name,'email',c.email,'phone',c.phone,'status',c.status) from public.club_customers c where c.organisation_id=p_organisation_id and c.user_id=p_user_id),'memberships',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'product_id',m.product_id,'product_name',p.name,'status',m.status,'starts_at',m.starts_at,'ends_at',m.ends_at,'source',m.source,'holder_user_ids',(select coalesce(jsonb_agg(h.user_id),'[]'::jsonb) from public.club_membership_holders h where h.membership_id=m.id))) from public.club_memberships m join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id where m.organisation_id=p_organisation_id and exists(select 1 from public.club_membership_holders h where h.membership_id=m.id and h.user_id=p_user_id)),'[]'::jsonb),'entitlements',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'entitlement_key',g.entitlement_key,'scope',g.scope,'location_ids',g.location_ids,'starts_at',g.starts_at,'ends_at',g.ends_at,'source',g.source,'allowance_quantity',g.allowance_quantity,'allowance_period',g.allowance_period,'discount_percent',g.discount_percent,'discount_period',g.discount_period,'discount_max_uses',g.discount_max_uses)) from public.club_entitlement_grants g where g.organisation_id=p_organisation_id and g.user_id=p_user_id),'[]'::jsonb),'service_credits',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'credit_key',a.credit_key,'unit',a.unit,'status',a.status,'balance_quantity',coalesce((select sum(e.quantity_delta) from public.club_service_credit_entries e where e.account_id=a.id),0))) from public.club_service_credit_accounts a where a.organisation_id=p_organisation_id and (a.user_id=p_user_id or exists(select 1 from public.club_customers c where c.id=a.customer_id and c.user_id=p_user_id))),'[]'::jsonb),'access',v_access);
end; $$;

create or replace function public.club_check_member_location_access(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_location public.club_locations%rowtype; v_access jsonb; v_policy text; v_ids uuid[]; v_state text;
begin
  if auth.uid() is null then raise exception 'Club authentication required' using errcode='42501'; end if;
  if auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Location eligibility is not permitted' using errcode='42501'; end if;
  select * into v_location from public.club_locations where id=p_location_id and organisation_id=p_organisation_id;
  if not found or not v_location.active then return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','location_inactive'); end if;
  v_access:=public.club_evaluate_member_access(p_organisation_id,p_user_id,p_at); v_state:=v_access->>'state'; v_policy:=v_access->>'policy';
  if v_access->'permitted_location_ids' is not null and jsonb_typeof(v_access->'permitted_location_ids')='array' then select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(v_access->'permitted_location_ids') value; end if;
  if v_state='active' and (v_policy='future_locations' or (v_policy='organisation' and coalesce(array_length(v_ids,1),0)=0) or p_location_id=any(v_ids)) then return jsonb_build_object('allowed',true,'organisation_id',p_organisation_id,'location_id',p_location_id,'membership_id',(select g.membership_id from public.club_entitlement_grants g where g.organisation_id=p_organisation_id and g.user_id=p_user_id and g.entitlement_key='gym_access' and g.scope=v_policy order by g.starts_at desc limit 1),'source',(select g.source from public.club_entitlement_grants g where g.organisation_id=p_organisation_id and g.user_id=p_user_id and g.entitlement_key='gym_access' and g.scope=v_policy order by g.starts_at desc limit 1),'valid_from',(select g.starts_at from public.club_entitlement_grants g where g.organisation_id=p_organisation_id and g.user_id=p_user_id and g.entitlement_key='gym_access' and g.scope=v_policy order by g.starts_at desc limit 1),'valid_until',(select g.ends_at from public.club_entitlement_grants g where g.organisation_id=p_organisation_id and g.user_id=p_user_id and g.entitlement_key='gym_access' and g.scope=v_policy order by g.starts_at desc limit 1),'access_policy',v_policy); end if;
  if v_state='active' then return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','location_not_included'); end if;
  return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason',coalesce(v_access->>'reason','gym_access_missing'));
end; $$;

revoke all on function public.club_evaluate_member_access(uuid,uuid,timestamptz) from public, authenticated;

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

-- Final aggregate evaluator: every currently valid authoritative grant is
-- considered.  This prevents one grant from masking another location/source.
create or replace function public.club_evaluate_member_access(p_organisation_id uuid,p_user_id uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_has_membership boolean; v_has_future boolean; v_has_expired boolean; v_policy_future boolean:=false; v_has_valid boolean:=false; v_org_wide boolean:=false; v_locations uuid[]:='{}'; v_grant record; v_policy text; v_active_location boolean;
begin
  if auth.uid() is null or (auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner'])) then raise exception 'Location eligibility is not permitted' using errcode='42501'; end if;
  select exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id), exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.starts_at>p_at), exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.ends_at is not null and m.ends_at<=p_at) into v_has_membership,v_has_future,v_has_expired;
  for v_grant in select g.* from public.club_entitlement_grants g where g.organisation_id=p_organisation_id and g.user_id=p_user_id and g.entitlement_key='gym_access' and g.starts_at<=p_at and (g.ends_at is null or g.ends_at>p_at) and (g.membership_id is null or exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.id=g.membership_id and m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at))) order by (g.scope='future_locations') desc,(g.scope='organisation' and coalesce(array_length(g.location_ids,1),0)=0) desc,g.ends_at nulls first,g.starts_at desc,g.id loop
    v_has_valid:=true;
    if v_grant.scope='future_locations' then v_policy_future:=true; elsif v_grant.scope='organisation' and coalesce(array_length(v_grant.location_ids,1),0)=0 then v_org_wide:=true; else v_locations:=v_locations||coalesce(v_grant.location_ids,'{}'); end if;
  end loop;
  select exists(select 1 from public.club_locations l where l.organisation_id=p_organisation_id and l.active and (v_policy_future or v_org_wide or l.id=any(v_locations))) into v_active_location;
  v_policy:=case when v_policy_future then 'future_locations' when v_org_wide then 'organisation' when coalesce(array_length(v_locations,1),0)>0 then 'locations' else null end;
  return jsonb_build_object('state',case when v_has_valid and v_active_location then 'active' when v_has_membership and exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.status='active') then 'needs_attention' else 'unavailable' end,'reason',case when not v_has_membership and not v_has_valid then 'no_membership' when v_has_future and not exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at)) then 'membership_not_started' when v_has_expired and not v_has_valid then 'membership_expired' when v_has_membership and not exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at)) then 'membership_inactive' when not v_has_valid then 'gym_access_missing' else null end,'policy',v_policy,'permitted_location_ids',case when v_policy_future or v_org_wide then null else to_jsonb(v_locations) end,'has_valid_grant',v_has_valid);
end; $$;

-- Location checks select the exact grant that authorised the request and use
-- its metadata, rather than re-querying by scope after the decision.
create or replace function public.club_check_member_location_access(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_location public.club_locations%rowtype; v_grant public.club_entitlement_grants%rowtype; v_access jsonb;
begin
  if auth.uid() is null then raise exception 'Club authentication required' using errcode='42501'; end if;
  if auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Location eligibility is not permitted' using errcode='42501'; end if;
  select * into v_location from public.club_locations where id=p_location_id and organisation_id=p_organisation_id;
  if not found or not v_location.active then return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','location_inactive'); end if;
  select g.* into v_grant from public.club_entitlement_grants g where g.organisation_id=p_organisation_id and g.user_id=p_user_id and g.entitlement_key='gym_access' and g.starts_at<=p_at and (g.ends_at is null or g.ends_at>p_at) and (g.membership_id is null or exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.id=g.membership_id and m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at))) and (g.scope='future_locations' or (g.scope='organisation' and (coalesce(array_length(g.location_ids,1),0)=0 or p_location_id=any(g.location_ids))) or (g.scope='locations' and p_location_id=any(g.location_ids))) order by (g.scope='future_locations') desc,(g.scope='organisation' and coalesce(array_length(g.location_ids,1),0)=0) desc,g.ends_at nulls first,g.starts_at desc,g.id limit 1;
  if found then return jsonb_build_object('allowed',true,'organisation_id',p_organisation_id,'location_id',p_location_id,'membership_id',v_grant.membership_id,'source',v_grant.source,'valid_from',v_grant.starts_at,'valid_until',v_grant.ends_at,'access_policy',v_grant.scope); end if;
  v_access:=public.club_evaluate_member_access(p_organisation_id,p_user_id,p_at);
  if (v_access->>'has_valid_grant')::boolean then return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','location_not_included'); end if;
  return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason',coalesce(v_access->>'reason','gym_access_missing'));
end; $$;

revoke all on function public.club_evaluate_member_access(uuid,uuid,timestamptz) from public, authenticated;
grant execute on function public.club_get_member_operational_profile(uuid,uuid),public.club_list_member_summaries(uuid),public.club_check_member_location_access(uuid,uuid,uuid,timestamptz),public.club_set_member_home_location(uuid,uuid,uuid) to authenticated;

-- Canonical access evaluation used by eligibility and operational summaries.
-- `locations`/`organisation` grants with a non-empty location_ids array are
-- assignment-time snapshots; `future_locations` remains dynamically expansive.
-- Product/package authors should use `locations` with the active location IDs
-- for an all-current-at-assignment snapshot; use `future_locations` for a
-- dynamically expanding policy. Empty `organisation` arrays retain the legacy
-- organisation-wide semantics for non-location entitlements.
create or replace function public.club_evaluate_member_access(p_organisation_id uuid,p_user_id uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_membership record; v_grant record; v_has_membership boolean; v_has_future boolean; v_has_expired boolean; v_has_grant boolean; v_policy text; v_locations uuid[];
begin
  if auth.uid() is null or (auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner'])) then raise exception 'Location eligibility is not permitted' using errcode='42501'; end if;
  select exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id), exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.starts_at>p_at), exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.ends_at is not null and m.ends_at<=p_at) into v_has_membership,v_has_future,v_has_expired;
  select g.* into v_grant from public.club_entitlement_grants g where g.organisation_id=p_organisation_id and g.user_id=p_user_id and g.entitlement_key='gym_access' and g.starts_at<=p_at and (g.ends_at is null or g.ends_at>p_at) and (g.membership_id is null or exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.id=g.membership_id and m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at))) order by (g.scope='future_locations') desc,g.ends_at nulls last limit 1;
  v_has_grant:=found;
  if v_has_grant then v_policy:=v_grant.scope; v_locations:=coalesce(v_grant.location_ids,'{}'); end if;
  return jsonb_build_object('state',case when v_has_grant and (v_policy='future_locations' or exists(select 1 from public.club_locations l where l.organisation_id=p_organisation_id and l.active and ((v_policy='organisation' and (coalesce(array_length(v_locations,1),0)=0 or l.id=any(v_locations)) or v_policy='locations' and l.id=any(v_locations))))) then 'active' when v_has_membership and exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.status='active') then 'needs_attention' else 'unavailable' end,'reason',case when not v_has_membership and not v_has_grant then 'no_membership' when v_has_future and not exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at)) then 'membership_not_started' when v_has_expired and not v_has_grant then 'membership_expired' when v_has_membership and not exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at)) then 'membership_inactive' when not v_has_grant then 'gym_access_missing' when v_policy in ('locations','organisation') and coalesce(array_length(v_locations,1),0)>0 then 'location_not_included' else null end,'policy',v_policy,'permitted_location_ids',case when v_policy='future_locations' then null else to_jsonb(v_locations) end);
end; $$;

-- Replace the two aggregate readers so their displayed state comes from the
-- same evaluator as the location-specific eligibility RPC.
create or replace function public.club_list_member_summaries(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Member directory is not permitted' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'user_id',m.user_id,'role',m.role,'active',m.active,'display_name',coalesce(c.display_name,'Club member'),'email',c.email,'membership_name',current_membership.product_name,'membership_status',current_membership.status,'membership_ends_at',current_membership.ends_at,'home_location',case when l.id is null then null else jsonb_build_object('id',l.id,'name',l.name) end,'access_state',(public.club_evaluate_member_access(p_organisation_id,m.user_id)->>'state')) order by coalesce(c.display_name,'Club member'),m.created_at) from public.club_members m left join public.club_customers c on c.organisation_id=m.organisation_id and c.user_id=m.user_id left join public.club_locations l on l.id=m.preferred_location_id and l.organisation_id=m.organisation_id left join lateral (select ms.id,p.name product_name,ms.status,ms.ends_at from public.club_memberships ms join public.club_products p on p.id=ms.product_id and p.organisation_id=ms.organisation_id where ms.organisation_id=p_organisation_id and exists(select 1 from public.club_membership_holders h where h.membership_id=ms.id and h.user_id=m.user_id) order by (ms.status='active') desc,ms.starts_at desc limit 1) current_membership on true where m.organisation_id=p_organisation_id and m.active),'[]'::jsonb);
end; $$;
