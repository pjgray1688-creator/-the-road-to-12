-- club_access_safety_facts may return before looking up an induction booking
-- (for example when no active induction policy/version exists). A generic
-- PL/pgSQL RECORD has no tuple descriptor on that path, so even checking
-- booking_row.id while building the result can raise SQLSTATE 55000. Use the
-- table's row type so the optional booking safely remains NULL on every path.
-- CREATE OR REPLACE preserves the existing function ACL; no execution grants
-- are widened by this repair.
create or replace function public.club_access_safety_facts(
  p_organisation_id uuid, p_customer_id uuid, p_location_id uuid, p_at timestamptz default now()
) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare
  c public.club_customers%rowtype;
  policy_row record;
  version_row record;
  completion_row record;
  booking_row public.club_induction_bookings%rowtype;
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
