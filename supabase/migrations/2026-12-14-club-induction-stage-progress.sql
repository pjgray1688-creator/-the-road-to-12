-- Club induction stage progress, after the member age/access eligibility schema.
-- This migration adds audited stage checks and guards existing final completion.
-- Progress rows retain the stable customer identity for both linked and
-- unlinked imported members. A linked user ID is also stored for booking joins.
create table if not exists public.club_member_induction_stage_checks (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  customer_id uuid not null,
  user_id uuid references auth.users(id) on delete restrict,
  policy_id uuid not null,
  version_id uuid not null,
  section_id uuid not null,
  location_id uuid not null,
  checked_by uuid not null references auth.users(id) on delete restrict,
  checked_at timestamptz not null default now(),
  check (location_id is not null),
  foreign key (customer_id, organisation_id) references public.club_customers(id, organisation_id) on delete restrict,
  foreign key (policy_id, organisation_id) references public.club_induction_policies(id, organisation_id) on delete restrict,
  foreign key (version_id, organisation_id) references public.club_induction_versions(id, organisation_id) on delete restrict,
  foreign key (section_id) references public.club_induction_content_sections(id) on delete restrict
);
create unique index if not exists club_member_induction_stage_check_unique_idx
  on public.club_member_induction_stage_checks(organisation_id, customer_id, version_id, section_id);
create index if not exists club_member_induction_stage_checks_member_idx
  on public.club_member_induction_stage_checks(organisation_id, customer_id, version_id, checked_at desc);
alter table public.club_member_induction_stage_checks enable row level security;
revoke all on table public.club_member_induction_stage_checks from public, anon, authenticated;

create or replace function public.r12_induction_required_stages_complete(
  p_organisation_id uuid,p_customer_id uuid,p_user_id uuid,p_version_id uuid
) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select not exists (
    select 1 from public.club_induction_content_sections s
    where s.version_id=p_version_id and s.requires_acknowledgement
      and not exists (
        select 1 from public.club_member_induction_stage_checks c
        where c.organisation_id=p_organisation_id and c.version_id=p_version_id and c.section_id=s.id
          and ((p_customer_id is not null and c.customer_id=p_customer_id)
            or (p_user_id is not null and c.user_id=p_user_id))
      )
  );
$$;
revoke all on function public.r12_induction_required_stages_complete(uuid,uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.club_get_customer_induction_stages(
  p_organisation_id uuid,p_customer_id uuid,p_location_id uuid,p_booking_id uuid default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; p public.club_induction_policies%rowtype; v public.club_induction_versions%rowtype; b public.club_induction_bookings%rowtype; result jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'induction.perform')
    or not public.club_location_authorized(p_organisation_id,p_location_id) then
    raise exception 'Induction access is not permitted' using errcode='42501';
  end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id;
  if not found then raise exception 'Member is not available' using errcode='P0002'; end if;
  if p_booking_id is not null then
    select * into b from public.club_induction_bookings x where x.id=p_booking_id and x.organisation_id=p_organisation_id and x.user_id=c.user_id and x.location_id=p_location_id and x.status='booked';
    if not found then raise exception 'Booked induction is unavailable' using errcode='22023'; end if;
    select * into p from public.club_induction_policies x where x.id=b.policy_id and x.organisation_id=p_organisation_id and x.requirement in ('in_person','online_or_in_person');
  else
    select * into p from public.club_induction_policies x
      where x.organisation_id=p_organisation_id and x.active
        and (x.location_id=p_location_id or (x.location_id is null and not exists (select 1 from public.club_induction_policies specific where specific.organisation_id=p_organisation_id and specific.location_id=p_location_id and specific.active)))
      order by (x.location_id is not null) desc limit 1;
  end if;
  if not found or p.requirement not in ('in_person','online_or_in_person') then raise exception 'No in-person induction is required at this location' using errcode='22023'; end if;
  if p_booking_id is not null then
    select * into v from public.club_induction_versions x where x.id=b.version_id and x.policy_id=p.id and x.organisation_id=p_organisation_id and x.status='published' and x.effective_at<=now();
  else
    select * into v from public.club_induction_versions x
      where x.policy_id=p.id and x.organisation_id=p_organisation_id and x.status='published' and x.effective_at<=now()
      order by x.effective_at desc,x.version desc limit 1;
  end if;
  if not found then raise exception 'The current induction version is not published' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'title',s.title,'content',s.content,'position',s.position,
    'required',s.requires_acknowledgement,'complete',(progress.id is not null),
    'checked_at',progress.checked_at,
    'checked_by_name',coalesce(nullif(btrim(actor.display_name),''),'Staff')
  ) order by s.position),'[]'::jsonb) into result
  from public.club_induction_content_sections s
  left join public.club_member_induction_stage_checks progress
    on progress.organisation_id=p_organisation_id and progress.customer_id=c.id
    and progress.version_id=v.id and progress.section_id=s.id
  left join public.profiles actor on actor.id=progress.checked_by
  where s.version_id=v.id;
  return jsonb_build_object('policy_id',p.id,'version_id',v.id,'version',v.version,'location_id',p_location_id,'sections',result);
end; $$;

create or replace function public.club_record_customer_induction_stage(
  p_organisation_id uuid,p_customer_id uuid,p_location_id uuid,p_section_id uuid,p_booking_id uuid default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; p public.club_induction_policies%rowtype; v public.club_induction_versions%rowtype; b public.club_induction_bookings%rowtype; s public.club_induction_content_sections%rowtype; r public.club_member_induction_stage_checks%rowtype; inserted_count integer;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'induction.perform')
    or not public.club_location_authorized(p_organisation_id,p_location_id) then
    raise exception 'Induction verification is not permitted at this location' using errcode='42501';
  end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id;
  if not found then raise exception 'Member is not available' using errcode='P0002'; end if;
  if p_booking_id is not null then
    select * into b from public.club_induction_bookings x where x.id=p_booking_id and x.organisation_id=p_organisation_id and x.user_id=c.user_id and x.location_id=p_location_id and x.status='booked';
    if not found then raise exception 'Booked induction is unavailable' using errcode='22023'; end if;
    select * into p from public.club_induction_policies x where x.id=b.policy_id and x.organisation_id=p_organisation_id and x.requirement in ('in_person','online_or_in_person');
  else
    select * into p from public.club_induction_policies x
      where x.organisation_id=p_organisation_id and x.active
        and (x.location_id=p_location_id or (x.location_id is null and not exists (select 1 from public.club_induction_policies specific where specific.organisation_id=p_organisation_id and specific.location_id=p_location_id and specific.active)))
      order by (x.location_id is not null) desc limit 1;
  end if;
  if not found or p.requirement not in ('in_person','online_or_in_person') then raise exception 'No in-person induction is required at this location' using errcode='22023'; end if;
  if p_booking_id is not null then
    select * into v from public.club_induction_versions x where x.id=b.version_id and x.policy_id=p.id and x.organisation_id=p_organisation_id and x.status='published' and x.effective_at<=now();
  else
    select * into v from public.club_induction_versions x
      where x.policy_id=p.id and x.organisation_id=p_organisation_id and x.status='published' and x.effective_at<=now()
      order by x.effective_at desc,x.version desc limit 1;
  end if;
  if not found then raise exception 'The current induction version is not published' using errcode='22023'; end if;
  select * into s from public.club_induction_content_sections x
    where x.id=p_section_id and x.version_id=v.id and x.requires_acknowledgement;
  if not found then raise exception 'This induction stage is not a required stage in the current published version' using errcode='22023'; end if;
  insert into public.club_member_induction_stage_checks(organisation_id,customer_id,user_id,policy_id,version_id,section_id,location_id,checked_by)
  values(p_organisation_id,c.id,c.user_id,p.id,v.id,s.id,p_location_id,auth.uid())
  on conflict(organisation_id,customer_id,version_id,section_id) do nothing;
  get diagnostics inserted_count = row_count;
  select * into r from public.club_member_induction_stage_checks
   where organisation_id=p_organisation_id and customer_id=c.id and version_id=v.id and section_id=s.id;
  if inserted_count = 1 then
    perform public.club_append_audit_event(p_organisation_id,'induction.stage_completed','member_induction_stage',s.id,p_location_id,null,
      jsonb_build_object('customer_id',c.id,'policy_id',p.id,'version_id',v.id,'checked_at',r.checked_at));
  end if;
  return jsonb_build_object('section_id',s.id,'complete',true,'checked_at',r.checked_at,'checked_by',r.checked_by);
end; $$;

-- Guard existing finalization RPCs. Their original role/location checks remain
-- in place; an incomplete published version can no longer produce completion.
create or replace function public.club_reconcile_induction_booking(p_organisation_id uuid,p_booking_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_booking public.club_induction_bookings%rowtype; v_customer public.club_customers%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'induction.perform') then raise exception 'Induction verification is not permitted' using errcode='42501'; end if;
  if p_status not in ('completed','cancelled','no_show') then raise exception 'Induction booking status is invalid' using errcode='22023'; end if;
  select * into v_booking from public.club_induction_bookings where id=p_booking_id and organisation_id=p_organisation_id for update;
  if not found or v_booking.status<>'booked' or not public.club_location_authorized(p_organisation_id,v_booking.location_id) then raise exception 'Induction booking is invalid' using errcode='22023'; end if;
  if p_status='completed' then
    if v_booking.version_id is null then raise exception 'This booking has no published induction version and needs staff review' using errcode='22023'; end if;
    select * into v_customer from public.club_customers where organisation_id=p_organisation_id and user_id=v_booking.user_id;
    if not public.r12_induction_required_stages_complete(p_organisation_id,v_customer.id,v_booking.user_id,v_booking.version_id) then
      raise exception 'Complete every required induction stage before final completion' using errcode='22023';
    end if;
  end if;
  update public.club_induction_bookings set status=p_status,completed_at=case when p_status='completed' then now() else null end,verified_by=auth.uid() where id=p_booking_id returning * into v_booking;
  if p_status='completed' then
    insert into public.club_member_induction_completions(organisation_id,user_id,policy_id,version_id,route,acknowledgement_version,verified_by,completed_at)
    values(v_booking.organisation_id,v_booking.user_id,v_booking.policy_id,v_booking.version_id,'in_person',coalesce(v_booking.version_id::text,'in_person'),auth.uid(),now());
    perform public.club_append_audit_event(p_organisation_id,'induction.completed','member_induction_completion',v_booking.id,v_booking.location_id,null,jsonb_build_object('version_id',v_booking.version_id,'required_stages_complete',true));
  end if;
  return jsonb_build_object('id',v_booking.id,'organisation_id',v_booking.organisation_id,'user_id',v_booking.user_id,'location_id',v_booking.location_id,'version_id',v_booking.version_id,'starts_at',v_booking.starts_at,'ends_at',v_booking.ends_at,'status',v_booking.status,'created_at',v_booking.created_at,'completed_at',v_booking.completed_at,'verified_by',v_booking.verified_by);
end; $$;

create or replace function public.club_record_customer_induction_completion(p_organisation_id uuid,p_customer_id uuid,p_location_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; p public.club_induction_policies%rowtype; v public.club_induction_versions%rowtype; done public.club_member_induction_completions%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'induction.perform') then raise exception 'Induction verification is not permitted' using errcode='42501'; end if;
  if not public.club_location_authorized(p_organisation_id,p_location_id) then raise exception 'Induction verification is not permitted at this location' using errcode='42501'; end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Member is not available' using errcode='P0002'; end if;
  select * into p from public.club_induction_policies x where x.organisation_id=p_organisation_id and x.active and (x.location_id=p_location_id or (x.location_id is null and not exists (select 1 from public.club_induction_policies specific where specific.organisation_id=p_organisation_id and specific.location_id=p_location_id and specific.active))) order by (x.location_id is not null) desc limit 1;
  if not found or p.requirement not in ('in_person','online_or_in_person') then raise exception 'No in-person induction is required at this location' using errcode='22023'; end if;
  select * into v from public.club_induction_versions x where x.policy_id=p.id and x.organisation_id=p_organisation_id and x.status='published' and x.effective_at<=now() order by x.effective_at desc,x.version desc limit 1;
  if not found then raise exception 'The current induction version is not published' using errcode='22023'; end if;
  if not public.r12_induction_required_stages_complete(p_organisation_id,c.id,c.user_id,v.id) then raise exception 'Complete every required induction stage before final completion' using errcode='22023'; end if;
  select * into done from public.club_member_induction_completions x where x.organisation_id=p_organisation_id and x.policy_id=p.id and x.version_id=v.id and ((c.user_id is not null and x.user_id=c.user_id) or (c.user_id is null and x.customer_id=c.id)) order by x.completed_at desc limit 1;
  if not found then
    insert into public.club_member_induction_completions(organisation_id,user_id,customer_id,policy_id,version_id,route,acknowledgement_version,verified_by,completed_at)
    values(p_organisation_id,c.user_id,case when c.user_id is null then c.id end,p.id,v.id,'in_person',v.version::text,auth.uid(),now()) returning * into done;
    perform public.club_append_audit_event(p_organisation_id,'induction.completed','member_induction_completion',done.id,p_location_id,null,jsonb_build_object('customer_id',c.id,'version_id',v.id,'required_stages_complete',true));
  end if;
  return jsonb_build_object('id',done.id,'customerId',c.id,'policyId',done.policy_id,'versionId',done.version_id,'completedAt',done.completed_at,'verifiedBy',done.verified_by,'route',done.route);
end; $$;

revoke all on function public.club_get_customer_induction_stages(uuid,uuid,uuid,uuid),public.club_record_customer_induction_stage(uuid,uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.club_get_customer_induction_stages(uuid,uuid,uuid,uuid),public.club_record_customer_induction_stage(uuid,uuid,uuid,uuid,uuid) to authenticated;
-- The two finalisation functions retain their existing authenticated grants and
-- their new required-stage guard now applies to every client call.
