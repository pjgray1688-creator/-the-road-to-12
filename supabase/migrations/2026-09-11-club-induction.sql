-- R12 Club induction/onboarding foundation (forward-only; review before execution).
-- No policies are enabled and no member completion/backfill rows are created here.

create table if not exists public.club_induction_policies (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid,
  requirement text not null check (requirement in ('none','online_or_in_person','in_person')),
  grace_days integer not null default 0 check (grace_days >= 0),
  overdue_access text not null default 'hold' check (overdue_access in ('allow','hold')),
  appointment_extension_enabled boolean not null default false,
  max_appointment_extension_days integer check (max_appointment_extension_days is null or max_appointment_extension_days >= 0),
  requires_reacknowledgement boolean not null default false,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  foreign key (location_id, organisation_id) references public.club_locations(id, organisation_id)
);
create unique index if not exists club_induction_policies_scope_key on public.club_induction_policies (organisation_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.club_induction_versions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.club_induction_policies(id) on delete cascade,
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft','published')),
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (policy_id, version),
  unique (id, organisation_id),
  foreign key (policy_id, organisation_id) references public.club_induction_policies(id, organisation_id)
);
create index if not exists club_induction_versions_current_idx on public.club_induction_versions (policy_id, status, effective_at desc);

create table if not exists public.club_induction_content_sections (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.club_induction_versions(id) on delete cascade,
  position integer not null check (position >= 0),
  section_key text not null,
  title text not null,
  content text not null,
  requires_acknowledgement boolean not null default true,
  unique (version_id, position),
  unique (version_id, section_key)
);

create table if not exists public.club_member_induction_completions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  policy_id uuid not null references public.club_induction_policies(id),
  version_id uuid not null references public.club_induction_versions(id),
  route text not null check (route in ('online','in_person')),
  acknowledgement_version text not null,
  completed_at timestamptz not null default now(),
  verified_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (policy_id, organisation_id) references public.club_induction_policies(id, organisation_id),
  foreign key (version_id, organisation_id) references public.club_induction_versions(id, organisation_id)
);
create index if not exists club_member_induction_completions_lookup_idx on public.club_member_induction_completions (organisation_id, user_id, policy_id, completed_at desc);

create table if not exists public.club_induction_bookings (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  location_id uuid not null,
  policy_id uuid not null,
  version_id uuid references public.club_induction_versions(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status text not null default 'booked' check (status in ('booked','completed','cancelled','no_show')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  verified_by uuid references auth.users(id),
  foreign key (location_id, organisation_id) references public.club_locations(id, organisation_id),
  foreign key (policy_id, organisation_id) references public.club_induction_policies(id, organisation_id),
  foreign key (version_id, organisation_id) references public.club_induction_versions(id, organisation_id)
);
create index if not exists club_induction_bookings_member_idx on public.club_induction_bookings (organisation_id, user_id, status, starts_at);
create unique index if not exists club_induction_bookings_one_active_idx on public.club_induction_bookings (organisation_id, user_id, policy_id) where status = 'booked';

alter table public.club_induction_policies enable row level security;
alter table public.club_induction_versions enable row level security;
alter table public.club_induction_content_sections enable row level security;
alter table public.club_member_induction_completions enable row level security;
alter table public.club_induction_bookings enable row level security;
revoke all on public.club_induction_policies, public.club_induction_versions, public.club_induction_content_sections, public.club_member_induction_completions, public.club_induction_bookings from public, anon, authenticated;

create or replace function public.club_get_member_induction_state(p_organisation_id uuid,p_user_id uuid,p_location_id uuid default null,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_policy record; v_version record; v_booking record; v_completion record; v_anchor timestamptz; v_due timestamptz; v_until timestamptz; v_state text; v_route text; v_available_routes text[]; v_days integer; v_access jsonb; v_has_access boolean:=false;
begin
  if auth.uid() is null or (auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner'])) then raise exception 'Induction state is not permitted' using errcode='42501'; end if;
  select p.* into v_policy from public.club_induction_policies p where p.organisation_id=p_organisation_id and p.active and (p.location_id=p_location_id or (p.location_id is null and p_location_id is null) or (p.location_id is null and p_location_id is not null and not exists(select 1 from public.club_induction_policies specific where specific.organisation_id=p_organisation_id and specific.location_id=p_location_id and specific.active))) order by (p.location_id is not null) desc limit 1;
  if not found or v_policy.requirement='none' then return jsonb_build_object('sections','[]'::jsonb,'state',jsonb_build_object('state','not_required','required',false,'access_effect','none')); end if;
  select v.* into v_version from public.club_induction_versions v where v.policy_id=v_policy.id and v.status='published' and v.effective_at<=p_at order by v.effective_at desc,v.version desc limit 1;
  -- A configured policy without a published, effective version is not enforceable:
  -- do not create an impossible lockout before the gym has published content.
  if not found then return jsonb_build_object('policy',jsonb_build_object('id',v_policy.id,'organisation_id',v_policy.organisation_id,'location_id',v_policy.location_id,'requirement',v_policy.requirement,'grace_days',v_policy.grace_days,'overdue_access',v_policy.overdue_access,'appointment_extension_enabled',v_policy.appointment_extension_enabled,'max_appointment_extension_days',v_policy.max_appointment_extension_days,'requires_reacknowledgement',v_policy.requires_reacknowledgement,'active',v_policy.active,'created_at',v_policy.created_at,'updated_at',v_policy.updated_at),'sections','[]'::jsonb,'state',jsonb_build_object('state','not_required','required',false,'access_effect','none','requirement',v_policy.requirement)); end if;
  if p_location_id is not null then v_access:=public.club_check_member_location_access_base(p_organisation_id,p_user_id,p_location_id,p_at); v_has_access:=coalesce((v_access->>'allowed')::boolean,false); else v_access:=public.club_evaluate_member_access(p_organisation_id,p_user_id,p_at); v_has_access:=coalesce((v_access->>'state')='active',false); end if;
  if not v_has_access then v_anchor:=p_at; else
    select max(case when g.membership_id is null then g.starts_at else greatest(g.starts_at,m.starts_at) end) into v_anchor
    from public.club_entitlement_grants g left join public.club_memberships m on m.id=g.membership_id and m.organisation_id=p_organisation_id
    where g.organisation_id=p_organisation_id and g.user_id=p_user_id and g.entitlement_key='gym_access' and g.starts_at<=p_at and (g.ends_at is null or g.ends_at>p_at)
      and (g.membership_id is null or (m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at) and exists(select 1 from public.club_membership_holders h where h.membership_id=m.id and h.user_id=p_user_id)))
      and (p_location_id is null or g.scope='future_locations' or (g.scope='organisation' and (coalesce(array_length(g.location_ids,1),0)=0 or p_location_id=any(g.location_ids))) or (g.scope='locations' and p_location_id=any(g.location_ids)));
  end if;
  v_anchor:=greatest(coalesce(v_anchor,p_at),v_version.effective_at); v_due:=v_anchor+(v_policy.grace_days||' days')::interval;
  v_available_routes:=case when v_policy.requirement='in_person' then array['in_person']::text[] else array['online','in_person']::text[] end;
  v_route:=null;
  if v_version.id is not null then select c.* into v_completion from public.club_member_induction_completions c where c.organisation_id=p_organisation_id and c.user_id=p_user_id and c.policy_id=v_policy.id and (c.version_id=v_version.id or not v_policy.requires_reacknowledgement) order by c.completed_at desc limit 1; end if;
  select b.* into v_booking from public.club_induction_bookings b where b.organisation_id=p_organisation_id and b.user_id=p_user_id and b.policy_id=v_policy.id and b.status='booked' and b.starts_at>p_at order by b.starts_at limit 1;
  if v_completion.id is not null then v_state:='complete'; v_route:=v_completion.route; elsif v_booking.id is not null and v_policy.appointment_extension_enabled and (v_policy.max_appointment_extension_days is null or v_booking.starts_at<=v_due+(v_policy.max_appointment_extension_days||' days')::interval) then v_state:='booked'; v_route:='in_person'; elsif p_at<v_due then v_state:='due'; else v_state:='overdue'; end if;
  v_until:=case when v_state='booked' then case when v_policy.max_appointment_extension_days is null then v_booking.starts_at else least(v_booking.starts_at,v_due+(v_policy.max_appointment_extension_days||' days')::interval) end else null end;
  v_days:=greatest(0,ceil(extract(epoch from (v_due-p_at))/86400))::integer;
  return jsonb_build_object('policy',jsonb_build_object('id',v_policy.id,'organisation_id',v_policy.organisation_id,'location_id',v_policy.location_id,'requirement',v_policy.requirement,'grace_days',v_policy.grace_days,'overdue_access',v_policy.overdue_access,'appointment_extension_enabled',v_policy.appointment_extension_enabled,'max_appointment_extension_days',v_policy.max_appointment_extension_days,'requires_reacknowledgement',v_policy.requires_reacknowledgement,'active',v_policy.active,'created_at',v_policy.created_at,'updated_at',v_policy.updated_at),'version',jsonb_build_object('id',v_version.id,'policy_id',v_version.policy_id,'organisation_id',v_version.organisation_id,'version',v_version.version,'status',v_version.status,'effective_at',v_version.effective_at,'created_at',v_version.created_at,'published_at',v_version.published_at),'sections',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'version_id',s.version_id,'position',s.position,'section_key',s.section_key,'title',s.title,'content',s.content,'requires_acknowledgement',s.requires_acknowledgement) order by s.position) from public.club_induction_content_sections s where s.version_id=v_version.id),'[]'::jsonb),'state',jsonb_build_object('state',v_state,'required',true,'route',v_route,'available_routes',v_available_routes,'policy_id',v_policy.id,'version_id',v_version.id,'due_at',v_due,'grace_remaining_days',v_days,'booking',case when v_booking.id is null then null else jsonb_build_object('id',v_booking.id,'organisation_id',v_booking.organisation_id,'user_id',v_booking.user_id,'location_id',v_booking.location_id,'version_id',v_booking.version_id,'starts_at',v_booking.starts_at,'ends_at',v_booking.ends_at,'status',v_booking.status,'created_at',v_booking.created_at,'completed_at',v_booking.completed_at,'verified_by',v_booking.verified_by) end,'completed_at',v_completion.completed_at,'verified_by',v_completion.verified_by,'access_effect',case when v_state='overdue' and v_policy.overdue_access='hold' then 'hold' when v_state in ('due','booked') then 'warn' else 'none' end,'requirement',v_policy.requirement,'extension_until',v_until));
end; $$;

create or replace function public.club_check_member_location_access(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_base jsonb; v_induction jsonb;
begin
  if auth.uid() is null or (auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner'])) then raise exception 'Location eligibility is not permitted' using errcode='42501'; end if;
  v_base:=public.club_check_member_location_access_base(p_organisation_id,p_user_id,p_location_id,p_at);
  if v_base->>'allowed' <> 'true' then return v_base; end if;
  v_induction:=public.club_get_member_induction_state(p_organisation_id,p_user_id,p_location_id,p_at);
  if v_induction->'state'->>'access_effect'='hold' then return v_base||jsonb_build_object('allowed',false,'reason','induction_overdue','induction',v_induction->'state'); end if;
  return v_base||jsonb_build_object('induction',v_induction->'state');
end; $$;

create or replace function public.club_check_member_location_access_base(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_location public.club_locations%rowtype; v_grant public.club_entitlement_grants%rowtype; v_access jsonb;
begin
  select * into v_location from public.club_locations where id=p_location_id and organisation_id=p_organisation_id;
  if not found or not v_location.active then return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','location_inactive'); end if;
  select g.* into v_grant from public.club_entitlement_grants g where g.organisation_id=p_organisation_id and g.user_id=p_user_id and g.entitlement_key='gym_access' and g.starts_at<=p_at and (g.ends_at is null or g.ends_at>p_at) and (g.membership_id is null or exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.id=g.membership_id and m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at))) and (g.scope='future_locations' or (g.scope='organisation' and (coalesce(array_length(g.location_ids,1),0)=0 or p_location_id=any(g.location_ids))) or (g.scope='locations' and p_location_id=any(g.location_ids))) order by (g.scope='future_locations') desc,(g.scope='organisation' and coalesce(array_length(g.location_ids,1),0)=0) desc,g.ends_at nulls first,g.starts_at desc,g.id limit 1;
  if found then return jsonb_build_object('allowed',true,'organisation_id',p_organisation_id,'location_id',p_location_id,'membership_id',v_grant.membership_id,'source',v_grant.source,'valid_from',v_grant.starts_at,'valid_until',v_grant.ends_at,'access_policy',v_grant.scope); end if;
  v_access:=public.club_evaluate_member_access(p_organisation_id,p_user_id,p_at);
  if coalesce((v_access->>'has_valid_grant')::boolean,false) then return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','location_not_included'); end if;
  return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason',coalesce(v_access->>'reason','gym_access_missing'));
end; $$;

create or replace function public.club_complete_online_induction(p_organisation_id uuid,p_user_id uuid,p_version_id uuid,p_acknowledgement_version text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_version record; v_policy record; v_access jsonb;
begin
  if auth.uid() is null or auth.uid()<>p_user_id then raise exception 'Online induction is not permitted' using errcode='42501'; end if;
  select v.*,p.requirement,p.active policy_active,p.requires_reacknowledgement into v_version from public.club_induction_versions v join public.club_induction_policies p on p.id=v.policy_id and p.organisation_id=v.organisation_id where v.id=p_version_id and v.organisation_id=p_organisation_id and v.status='published' and v.effective_at<=now() and p.active and p.requirement='online_or_in_person';
  if not found or nullif(trim(p_acknowledgement_version),'') is null or p_acknowledgement_version<>v_version.version::text then raise exception 'Online induction is invalid' using errcode='22023'; end if;
  v_access:=public.club_evaluate_member_access(p_organisation_id,p_user_id,now());
  if coalesce((v_access->>'state')<>'active',true) then raise exception 'Online induction is not applicable' using errcode='42501'; end if;
  insert into public.club_member_induction_completions(organisation_id,user_id,policy_id,version_id,route,acknowledgement_version) values(p_organisation_id,p_user_id,v_version.policy_id,p_version_id,'online',p_acknowledgement_version);
  return public.club_get_member_induction_state(p_organisation_id,p_user_id,null,now());
end; $$;

create or replace function public.club_book_induction(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_version_id uuid,p_starts_at timestamptz,p_ends_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_policy record; v_version record; v_booking public.club_induction_bookings%rowtype; v_access jsonb; v_location public.club_locations%rowtype;
begin
  if auth.uid() is null or auth.uid()<>p_user_id then raise exception 'Induction booking is not permitted' using errcode='42501'; end if;
  select * into v_location from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active;
  if not found then raise exception 'Induction booking location is invalid' using errcode='22023'; end if;
  select p.* into v_policy from public.club_induction_policies p where p.organisation_id=p_organisation_id and p.active and p.requirement in ('in_person','online_or_in_person') and (p.location_id=p_location_id or p.location_id is null) order by (p.location_id is not null) desc limit 1;
  if not found or p_version_id is null then raise exception 'Induction booking is invalid' using errcode='22023'; end if;
  select v.* into v_version from public.club_induction_versions v where v.id=p_version_id and v.policy_id=v_policy.id and v.organisation_id=p_organisation_id and v.status='published' and v.effective_at<=now();
  if not found or p_starts_at<=now() or p_ends_at<=p_starts_at then raise exception 'Induction booking is invalid' using errcode='22023'; end if;
  v_access:=public.club_check_member_location_access_base(p_organisation_id,p_user_id,p_location_id,now());
  if coalesce((v_access->>'allowed')::boolean,false)=false then raise exception 'Induction booking is not applicable' using errcode='42501'; end if;
  insert into public.club_induction_bookings(organisation_id,user_id,location_id,policy_id,version_id,starts_at,ends_at,created_by) values(p_organisation_id,p_user_id,p_location_id,v_policy.id,p_version_id,p_starts_at,p_ends_at,p_user_id) returning * into v_booking;
  return jsonb_build_object('id',v_booking.id,'organisation_id',v_booking.organisation_id,'user_id',v_booking.user_id,'location_id',v_booking.location_id,'version_id',v_booking.version_id,'starts_at',v_booking.starts_at,'ends_at',v_booking.ends_at,'status',v_booking.status,'created_at',v_booking.created_at);
end; $$;

create or replace function public.club_reconcile_induction_booking(p_organisation_id uuid,p_booking_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_booking public.club_induction_bookings%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'induction.perform') then raise exception 'Induction verification is not permitted' using errcode='42501'; end if;
  if p_status not in ('completed','cancelled','no_show') then raise exception 'Induction booking status is invalid' using errcode='22023'; end if;
  select * into v_booking from public.club_induction_bookings where id=p_booking_id and organisation_id=p_organisation_id for update;
  if not found or v_booking.status<>'booked' or not public.club_location_authorized(p_organisation_id,v_booking.location_id) then raise exception 'Induction booking is invalid' using errcode='22023'; end if;
  update public.club_induction_bookings set status=p_status, completed_at=case when p_status='completed' then now() else null end, verified_by=auth.uid() where id=p_booking_id returning * into v_booking;
  if p_status='completed' then insert into public.club_member_induction_completions(organisation_id,user_id,policy_id,version_id,route,acknowledgement_version,verified_by,completed_at) values(v_booking.organisation_id,v_booking.user_id,v_booking.policy_id,v_booking.version_id,'in_person',coalesce(v_booking.version_id::text,'in_person'),auth.uid(),now()); end if;
  return jsonb_build_object('id',v_booking.id,'organisation_id',v_booking.organisation_id,'user_id',v_booking.user_id,'location_id',v_booking.location_id,'version_id',v_booking.version_id,'starts_at',v_booking.starts_at,'ends_at',v_booking.ends_at,'status',v_booking.status,'created_at',v_booking.created_at,'completed_at',v_booking.completed_at,'verified_by',v_booking.verified_by);
end; $$;

create or replace function public.club_save_induction_policy(p_id uuid,p_organisation_id uuid,p_location_id uuid,p_requirement text,p_grace_days integer,p_overdue_access text,p_appointment_extension_enabled boolean,p_max_appointment_extension_days integer,p_requires_reacknowledgement boolean,p_active boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_policy public.club_induction_policies%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Induction policy management is not permitted' using errcode='42501'; end if;
  if p_requirement not in ('none','online_or_in_person','in_person') or p_grace_days<0 or p_overdue_access not in ('allow','hold') or (p_max_appointment_extension_days is not null and p_max_appointment_extension_days<0) then raise exception 'Induction policy is invalid' using errcode='22023'; end if;
  if p_id is null then insert into public.club_induction_policies(organisation_id,location_id,requirement,grace_days,overdue_access,appointment_extension_enabled,max_appointment_extension_days,requires_reacknowledgement,active,created_by) values(p_organisation_id,p_location_id,p_requirement,p_grace_days,p_overdue_access,p_appointment_extension_enabled,p_max_appointment_extension_days,p_requires_reacknowledgement,p_active,auth.uid()) returning * into v_policy; else update public.club_induction_policies set location_id=p_location_id,requirement=p_requirement,grace_days=p_grace_days,overdue_access=p_overdue_access,appointment_extension_enabled=p_appointment_extension_enabled,max_appointment_extension_days=p_max_appointment_extension_days,requires_reacknowledgement=p_requires_reacknowledgement,active=p_active,updated_at=now() where id=p_id and organisation_id=p_organisation_id returning * into v_policy; if not found then raise exception 'Induction policy not found' using errcode='P0002'; end if; end if;
  return jsonb_build_object('id',v_policy.id,'organisation_id',v_policy.organisation_id,'location_id',v_policy.location_id,'requirement',v_policy.requirement,'grace_days',v_policy.grace_days,'overdue_access',v_policy.overdue_access,'appointment_extension_enabled',v_policy.appointment_extension_enabled,'max_appointment_extension_days',v_policy.max_appointment_extension_days,'requires_reacknowledgement',v_policy.requires_reacknowledgement,'active',v_policy.active,'created_at',v_policy.created_at,'updated_at',v_policy.updated_at);
end; $$;

create or replace function public.club_save_induction_version(p_id uuid,p_organisation_id uuid,p_policy_id uuid,p_version integer,p_status text,p_effective_at timestamptz,p_sections jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_version public.club_induction_versions%rowtype; v_section jsonb; v_position integer:=0;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Induction content management is not permitted' using errcode='42501'; end if;
  if p_status not in ('draft','published') or p_version<1 or jsonb_typeof(coalesce(p_sections,'[]'::jsonb))<>'array' or not exists(select 1 from public.club_induction_policies where id=p_policy_id and organisation_id=p_organisation_id) then raise exception 'Induction version is invalid' using errcode='22023'; end if;
  if p_id is null then insert into public.club_induction_versions(policy_id,organisation_id,version,status,effective_at,published_at) values(p_policy_id,p_organisation_id,p_version,p_status,p_effective_at,case when p_status='published' then now() else null end) returning * into v_version; else update public.club_induction_versions set policy_id=p_policy_id,version=p_version,status=p_status,effective_at=p_effective_at,published_at=case when p_status='published' then coalesce(published_at,now()) else null end where id=p_id and organisation_id=p_organisation_id returning * into v_version; if not found then raise exception 'Induction version not found' using errcode='P0002'; end if; end if;
  delete from public.club_induction_content_sections where version_id=v_version.id;
  for v_section in select value from jsonb_array_elements(p_sections) loop
    insert into public.club_induction_content_sections(version_id,position,section_key,title,content,requires_acknowledgement) values(v_version.id,v_position,coalesce(v_section->>'sectionKey',v_section->>'section_key','section-'||v_position),coalesce(v_section->>'title',''),coalesce(v_section->>'content',''),coalesce((v_section->>'requiresAcknowledgement')::boolean,(v_section->>'requires_acknowledgement')::boolean,true)); v_position:=v_position+1;
  end loop;
  return jsonb_build_object('id',v_version.id,'policy_id',v_version.policy_id,'organisation_id',v_version.organisation_id,'version',v_version.version,'status',v_version.status,'effective_at',v_version.effective_at,'created_at',v_version.created_at,'published_at',v_version.published_at);
end; $$;

-- The base helper and evaluator are internal SECURITY DEFINER implementation details.
-- They must never be callable by a browser role; only the checked public wrappers below are exposed.
revoke all on function public.club_check_member_location_access_base(uuid,uuid,uuid,timestamptz),public.club_evaluate_member_access(uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.club_get_member_induction_state(uuid,uuid,uuid,timestamptz),public.club_check_member_location_access(uuid,uuid,uuid,timestamptz),public.club_complete_online_induction(uuid,uuid,uuid,text),public.club_book_induction(uuid,uuid,uuid,uuid,timestamptz,timestamptz),public.club_reconcile_induction_booking(uuid,uuid,text),public.club_save_induction_policy(uuid,uuid,uuid,text,integer,text,boolean,integer,boolean,boolean),public.club_save_induction_version(uuid,uuid,uuid,integer,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.club_get_member_induction_state(uuid,uuid,uuid,timestamptz),public.club_check_member_location_access(uuid,uuid,uuid,timestamptz),public.club_complete_online_induction(uuid,uuid,uuid,text),public.club_book_induction(uuid,uuid,uuid,uuid,timestamptz,timestamptz),public.club_reconcile_induction_booking(uuid,uuid,text),public.club_save_induction_policy(uuid,uuid,uuid,text,integer,text,boolean,integer,boolean,boolean),public.club_save_induction_version(uuid,uuid,uuid,integer,text,timestamptz,jsonb) to authenticated;
