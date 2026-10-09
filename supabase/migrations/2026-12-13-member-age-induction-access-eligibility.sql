-- Apply configured induction holds to PIN/QR/reception decisions and derive
-- adult door-access eligibility from recorded DOB. No DOB is inferred.
alter table public.club_member_induction_completions
  add column if not exists customer_id uuid;
alter table public.club_member_induction_completions
  alter column user_id drop not null;
alter table public.club_member_induction_completions
  drop constraint if exists club_induction_completion_customer_org_fk;
alter table public.club_member_induction_completions
  add constraint club_induction_completion_customer_org_fk
  foreign key (customer_id,organisation_id) references public.club_customers(id,organisation_id);
alter table public.club_member_induction_completions
  drop constraint if exists club_induction_completion_identity_chk;
alter table public.club_member_induction_completions
  add constraint club_induction_completion_identity_chk
  check (num_nonnulls(user_id,customer_id)=1);

create or replace function public.club_record_customer_induction_completion(
  p_organisation_id uuid,p_customer_id uuid,p_location_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  c public.club_customers%rowtype;
  p public.club_induction_policies%rowtype;
  v public.club_induction_versions%rowtype;
  done public.club_member_induction_completions%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'induction.perform') then
    raise exception 'Induction verification is not permitted' using errcode='42501';
  end if;
  if not public.club_location_authorized(p_organisation_id,p_location_id) then
    raise exception 'Induction verification is not permitted at this location' using errcode='42501';
  end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Member is not available' using errcode='P0002'; end if;
  select * into p from public.club_induction_policies x
  where x.organisation_id=p_organisation_id and x.active and x.requirement in ('in_person','online_or_in_person')
    and (x.location_id=p_location_id or x.location_id is null)
  order by (x.location_id is not null) desc limit 1;
  if not found then raise exception 'No in-person induction is required at this location' using errcode='22023'; end if;
  select * into v from public.club_induction_versions x
  where x.policy_id=p.id and x.organisation_id=p_organisation_id and x.status='published' and x.effective_at<=now()
  order by x.effective_at desc,x.version desc limit 1;
  if not found then raise exception 'The current induction version is not published' using errcode='22023'; end if;
  select * into done from public.club_member_induction_completions x
  where x.organisation_id=p_organisation_id and x.policy_id=p.id and x.version_id=v.id
    and ((c.user_id is not null and x.user_id=c.user_id) or (c.user_id is null and x.customer_id=c.id))
  order by x.completed_at desc limit 1;
  if not found then
    insert into public.club_member_induction_completions
      (organisation_id,user_id,customer_id,policy_id,version_id,route,acknowledgement_version,verified_by,completed_at)
    values(p_organisation_id,c.user_id,case when c.user_id is null then c.id end,p.id,v.id,'in_person',v.version::text,auth.uid(),now())
    returning * into done;
  end if;
  return jsonb_build_object('id',done.id,'customerId',c.id,'policyId',done.policy_id,'versionId',done.version_id,
    'completedAt',done.completed_at,'verifiedBy',done.verified_by,'route',done.route);
end; $$;
revoke all on function public.club_record_customer_induction_completion(uuid,uuid,uuid) from public,anon;
grant execute on function public.club_record_customer_induction_completion(uuid,uuid,uuid) to authenticated;

create or replace function public.club_access_safety_facts(
  p_organisation_id uuid, p_customer_id uuid, p_location_id uuid, p_at timestamptz default now()
) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare
  c public.club_customers%rowtype;
  policy_row record;
  version_row record;
  completion_row record;
  booking_row record;
  age_state text := 'missing_date_of_birth';
  induction_state text := 'not_required';
  induction_effect text := 'none';
  induction_required boolean := false;
  induction_due timestamptz;
  anchor timestamptz;
  membership_anchor timestamptz;
  verified_dob date;
  effective_dob date;
  is_door_controlled boolean := false;
  membership_valid boolean := false;
  age_block text;
  induction_block text;
  blocked_reason text;
begin
  select * into c from public.club_customers
  where id=p_customer_id and organisation_id=p_organisation_id;
  if not found then raise exception 'Member is not available' using errcode='P0002'; end if;

  if c.user_id is not null then
    select g.date_of_birth into verified_dob from public.club_glow_age_verifications g
    where g.organisation_id=p_organisation_id and g.user_id=c.user_id
      and g.status in ('verified','under_18');
  end if;
  if c.date_of_birth is not null and verified_dob is not null and c.date_of_birth<>verified_dob then
    age_state := 'date_of_birth_conflict';
  else
    effective_dob := coalesce(c.date_of_birth,verified_dob);
  end if;
  if age_state <> 'date_of_birth_conflict' and effective_dob is not null then
    if effective_dob <= ((p_at at time zone 'Europe/London')::date - interval '18 years')::date then age_state := 'adult';
    elsif effective_dob <= ((p_at at time zone 'Europe/London')::date - interval '16 years')::date then age_state := 'under_18';
    else age_state := 'under_16'; end if;
  end if;

  if p_location_id is null then
    select exists(select 1 from public.club_locations l where l.organisation_id=p_organisation_id and l.active and l.access_mode='DOOR_CONTROLLED') into is_door_controlled;
  else
    select exists(select 1 from public.club_locations l where l.id=p_location_id and l.organisation_id=p_organisation_id and l.active and l.access_mode='DOOR_CONTROLLED') into is_door_controlled;
  end if;
  select coalesce(bool_or(
    a.access_allowed and (a.valid_from is null or a.valid_from<=p_at)
    and (a.valid_until is null or a.valid_until>p_at)
    and (p_location_id is null or a.access_scope <> 'locations' or coalesce(cardinality(a.location_ids),0)=0 or p_location_id=any(a.location_ids))
  ),false) into membership_valid
  from public.club_member_access_projection a
  where a.organisation_id=p_organisation_id and a.customer_id=c.id
    and (p_location_id is not null or exists(
      select 1 from public.club_locations l where l.organisation_id=p_organisation_id and l.active
        and l.access_mode='DOOR_CONTROLLED'
        and (a.access_scope <> 'locations' or coalesce(cardinality(a.location_ids),0)=0 or l.id=any(a.location_ids))
    ));
  if is_door_controlled then
    if age_state='missing_date_of_birth' then age_block := 'missing_date_of_birth';
    elsif age_state='date_of_birth_conflict' then age_block := 'date_of_birth_conflict';
    elsif age_state='under_16' then age_block := 'under_16_restricted';
    elsif age_state='under_18' then age_block := 'under_18_restricted'; end if;
  end if;

  select p.* into policy_row from public.club_induction_policies p
  where p.organisation_id=p_organisation_id and p.active
    and (p.location_id=p_location_id or (p.location_id is null and p_location_id is null)
      or (p.location_id is null and p_location_id is not null and not exists(
        select 1 from public.club_induction_policies specific
        where specific.organisation_id=p_organisation_id and specific.location_id=p_location_id and specific.active)))
  order by (p.location_id is not null) desc limit 1;

  if found and policy_row.requirement <> 'none' then
    select v.* into version_row from public.club_induction_versions v
    where v.policy_id=policy_row.id and v.status='published' and v.effective_at<=p_at
    order by v.effective_at desc,v.version desc limit 1;
    if found then
      induction_required := true;
      select x.* into completion_row from public.club_member_induction_completions x
      where x.organisation_id=p_organisation_id and (x.user_id=c.user_id or x.customer_id=c.id)
        and x.policy_id=policy_row.id and (x.version_id=version_row.id or not policy_row.requires_reacknowledgement)
      order by x.completed_at desc limit 1;
      if completion_row.id is not null then
        induction_state := 'complete';
      else
        select max(greatest(g.starts_at,m.starts_at)) into anchor
        from public.club_entitlement_grants g
        join public.club_memberships m on m.id=g.membership_id and m.organisation_id=g.organisation_id
        where c.user_id is not null and g.organisation_id=p_organisation_id and g.user_id=c.user_id
          and g.entitlement_key='gym_access' and m.status='active'
          and g.starts_at<=p_at and (g.ends_at is null or g.ends_at>p_at)
          and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at);
        if anchor is null then
          select max(m.starts_at) into membership_anchor
          from public.club_membership_holders h
          join public.club_memberships m on m.id=h.membership_id and m.organisation_id=h.organisation_id
          where h.organisation_id=p_organisation_id
            and (h.customer_id=c.id or (c.user_id is not null and h.user_id=c.user_id))
            and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at);
          anchor := membership_anchor;
        end if;
        induction_due := greatest(coalesce(anchor,p_at),version_row.effective_at)+(policy_row.grace_days||' days')::interval;
        select b.* into booking_row from public.club_induction_bookings b
        where c.user_id is not null and b.organisation_id=p_organisation_id and b.user_id=c.user_id
          and b.policy_id=policy_row.id and b.status='booked'
        order by b.starts_at desc limit 1;
        if booking_row.id is not null and booking_row.starts_at>p_at and policy_row.appointment_extension_enabled
          and (policy_row.max_appointment_extension_days is null or booking_row.starts_at<=induction_due+(policy_row.max_appointment_extension_days||' days')::interval) then
          induction_state := 'booked'; induction_effect := 'warn';
        elsif p_at < induction_due then
          induction_state := 'due'; induction_effect := 'warn';
        else
          induction_state := 'overdue';
          if policy_row.overdue_access='hold' then induction_effect := 'hold'; induction_block := 'induction_overdue';
          else induction_effect := 'warn'; end if;
        end if;
      end if;
    end if;
  end if;

  blocked_reason := coalesce(induction_block,age_block);
  return jsonb_build_object(
    'ageState',age_state,
    'isUnder16',age_state='under_16',
    'isUnder18',age_state in ('under_16','under_18'),
    'inductionState',induction_state,
    'inductionRequired',induction_required,
    'inductionEffect',induction_effect,
    'inductionDueAt',induction_due,
    'inductionBooking',case when booking_row.id is null then null else jsonb_build_object('id',booking_row.id,'locationId',booking_row.location_id,'startsAt',booking_row.starts_at,'endsAt',booking_row.ends_at) end,
    'membershipEligible',membership_valid,
    'twentyFourHourEligible',membership_valid and is_door_controlled and age_state='adult' and blocked_reason is null,
    'doorControlled',is_door_controlled,
    'blocked',blocked_reason is not null,
    'reason',blocked_reason
  );
end;
$$;

create or replace function public.club_get_member_access_safety(p_organisation_id uuid,p_customer_id uuid,p_location_id uuid default null,p_at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.view') then
    raise exception 'Member access information is not available' using errcode='42501';
  end if;
  return public.club_access_safety_facts(p_organisation_id,p_customer_id,p_location_id,p_at);
end; $$;

create or replace function public.club_access_decide_customer(
  p_organisation_id uuid,p_location_id uuid,p_customer_id uuid,p_credential_type text,p_source text,
  p_device_id uuid default null,p_nonce text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  c public.club_customers%rowtype;
  p public.club_member_access_projection%rowtype;
  l public.club_locations%rowtype;
  allowed boolean:=false;
  why text:='credential_not_found';
  audit_id uuid;
  bounced uuid;
  record_attendance boolean:=false;
  unlock_ok boolean:=false;
  safety jsonb := '{}'::jsonb;
begin
  select * into l from public.club_locations where id=p_location_id and organisation_id=p_organisation_id;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id;
  if l.id is null or not l.active or l.access_mode='DISABLED' then why:='location_disabled';
  elsif c.id is null then why:='credential_not_found';
  else
    select * into p from public.club_member_access_projection where organisation_id=p_organisation_id and customer_id=c.id;
    if not found then p:=public.club_refresh_customer_access_projection(p_organisation_id,c.id); end if;
    if p.access_state='not_started' and p.valid_from<=now() then p:=public.club_refresh_customer_access_projection(p_organisation_id,c.id); end if;
    if p.valid_from is not null and p.valid_from>now() then why:='membership_not_started';
    elsif p.valid_until is not null and p.valid_until<=now() then why:='membership_expired';
    elsif not p.access_allowed then why:=p.reason;
    elsif p.access_scope='locations' and coalesce(cardinality(p.location_ids),0)>0 and not p_location_id=any(p.location_ids) then why:='location_not_included';
    else
      safety:=public.club_access_safety_facts(p_organisation_id,c.id,p_location_id,now());
      if safety->>'blocked'='true' then why:=safety->>'reason';
      else
        allowed:=true; why:=case when safety->>'inductionEffect'='warn' then 'induction_due' else p.reason end;
        unlock_ok:=l.access_mode='DOOR_CONTROLLED';
        select id into bounced from public.club_access_decisions
        where organisation_id=p_organisation_id and location_id=p_location_id and customer_id=c.id
          and decision='allow' and attendance_recorded and decided_at>now()-interval '10 seconds'
        order by decided_at desc limit 1;
        record_attendance:=bounced is null;
      end if;
    end if;
  end if;
  insert into public.club_access_decisions(organisation_id,location_id,customer_id,membership_id,device_id,actor_user_id,decision,reason,credential_type,source,request_nonce,access_state,attendance_recorded,bounce_of,location_mode,unlock_permitted)
  values(p_organisation_id,p_location_id,c.id,p.membership_id,p_device_id,auth.uid(),case when allowed then 'allow' else 'deny' end,why,p_credential_type,p_source,p_nonce,p.access_state,record_attendance,bounced,l.access_mode,allowed and unlock_ok)
  returning id into audit_id;
  return jsonb_build_object('allowed',allowed,'decision',case when allowed then 'allow' else 'deny' end,
    'reason',why,'accessState',p.access_state,'member',case when c.id is null then null else jsonb_build_object('customerId',c.id,'displayName',c.display_name) end,
    'membership',case when p.membership_id is null then null else jsonb_build_object('id',p.membership_id,'source',p.membership_source,'startsAt',p.valid_from,'endsAt',p.valid_until) end,
    'ageState',safety->>'ageState','under16',coalesce((safety->>'isUnder16')::boolean,false),
    'under18',coalesce((safety->>'isUnder18')::boolean,false),'inductionState',safety->>'inductionState',
    'inductionRequired',coalesce((safety->>'inductionRequired')::boolean,false),
    'inductionBooking',safety->'inductionBooking',
    'twentyFourHourEligible',coalesce((safety->>'twentyFourHourEligible')::boolean,false),
    'locationMode',l.access_mode,'attendanceRecorded',record_attendance,
    'unlockPermitted',allowed and unlock_ok,'decidedAt',now(),'auditReference',audit_id);
end; $$;

revoke all on function public.club_access_safety_facts(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.club_get_member_access_safety(uuid,uuid,uuid,timestamptz) from public,anon;
grant execute on function public.club_get_member_access_safety(uuid,uuid,uuid,timestamptz) to authenticated;

create or replace function public.club_get_membership_household(p_organisation_id uuid,p_membership_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.view') then
    raise exception 'Member relationships are not available' using errcode='42501';
  end if;
  if not exists(select 1 from public.club_memberships m where m.id=p_membership_id and m.organisation_id=p_organisation_id) then
    raise exception 'Membership is not available' using errcode='P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'customerId',c.id,'displayName',c.display_name,
      'billingContact',exists(select 1 from public.club_membership_billing_arrangements a
        where a.organisation_id=p_organisation_id and a.membership_id=p_membership_id
          and (a.user_id=c.user_id or a.customer_id=c.id))
    ) order by c.display_name)
    from public.club_membership_holders h
    join public.club_customers c on c.organisation_id=h.organisation_id and (c.id=h.customer_id or c.user_id=h.user_id)
    where h.organisation_id=p_organisation_id and h.membership_id=p_membership_id
  ),'[]'::jsonb);
end; $$;
revoke all on function public.club_get_membership_household(uuid,uuid) from public,anon;
grant execute on function public.club_get_membership_household(uuid,uuid) to authenticated;

create table if not exists public.club_membership_household_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  membership_id uuid not null,
  customer_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  action text not null check(action in ('added','removed')),
  reason text not null check(char_length(reason) between 3 and 500),
  created_at timestamptz not null default now(),
  foreign key(membership_id,organisation_id) references public.club_memberships(id,organisation_id) on delete restrict,
  foreign key(customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete restrict
);
create index if not exists club_membership_household_events_history_idx
  on public.club_membership_household_events(organisation_id,membership_id,created_at desc);
alter table public.club_membership_household_events enable row level security;
revoke all on public.club_membership_household_events from public,anon,authenticated;

create or replace function public.club_set_membership_household_member(
  p_organisation_id uuid,p_membership_id uuid,p_customer_id uuid,p_action text,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  m public.club_memberships%rowtype;
  c public.club_customers%rowtype;
  h public.club_membership_holders%rowtype;
  reason_text text:=nullif(btrim(p_reason),'');
  holder_count integer;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.assign') then
    raise exception 'Membership household updates are not permitted' using errcode='42501';
  end if;
  if p_action not in ('add','remove') or reason_text is null or char_length(reason_text) not between 3 and 500 then
    raise exception 'Choose an action and give a short reason' using errcode='22023';
  end if;
  select * into m from public.club_memberships where id=p_membership_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Membership not found' using errcode='P0002'; end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id for share;
  if not found then raise exception 'Family member is not in this organisation' using errcode='P0002'; end if;

  select * into h from public.club_membership_holders x
  where x.membership_id=m.id and x.organisation_id=p_organisation_id
    and (x.customer_id=c.id or (c.user_id is not null and x.user_id=c.user_id))
  limit 1 for update;
  if p_action='add' then
    if found then raise exception 'This person is already on the membership' using errcode='23505'; end if;
    if c.user_id is null then
      insert into public.club_membership_holders(id,membership_id,organisation_id,customer_id)
      values(gen_random_uuid(),m.id,p_organisation_id,c.id);
    else
      if not exists(select 1 from public.club_members cm where cm.organisation_id=p_organisation_id and cm.user_id=c.user_id and cm.active) then
        raise exception 'The linked account is not an active member of this organisation' using errcode='22023';
      end if;
      insert into public.club_membership_holders(id,membership_id,organisation_id,user_id)
      values(gen_random_uuid(),m.id,p_organisation_id,c.user_id);
    end if;
  else
    if not found then raise exception 'This person is not on the membership' using errcode='P0002'; end if;
    select count(*) into holder_count from public.club_membership_holders x where x.membership_id=m.id and x.organisation_id=p_organisation_id;
    if holder_count<=1 then raise exception 'A membership must keep at least one holder' using errcode='22023'; end if;
    if exists(select 1 from public.club_membership_billing_arrangements a where a.organisation_id=p_organisation_id and a.membership_id=m.id and (a.customer_id=c.id or a.user_id=c.user_id)) then
      raise exception 'This person is the recorded billing contact. Resolve billing ownership before removing them.' using errcode='22023';
    end if;
    delete from public.club_membership_holders where id=h.id;
  end if;
  insert into public.club_membership_household_events(organisation_id,membership_id,customer_id,actor_user_id,action,reason)
  values(p_organisation_id,m.id,c.id,auth.uid(),case when p_action='add' then 'added' else 'removed' end,reason_text);
  return jsonb_build_object('membership_id',m.id,'customer_id',c.id,'display_name',c.display_name,'action',p_action);
end; $$;
revoke all on function public.club_set_membership_household_member(uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.club_set_membership_household_member(uuid,uuid,uuid,text,text) to authenticated;
revoke all on function public.club_access_decide_customer(uuid,uuid,uuid,text,text,uuid,text) from public,anon,authenticated;
