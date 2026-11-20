-- Targeted acceptance hotfix: unknown DOB is not a blanket adult gym-access block.
-- Known minors and DOB conflicts remain blocked by the existing access decision.
-- Optional DOB is stored when supplied and does not erase an existing DOB.
-- The directory projection returns only status booleans; no credentials or DOBs.
begin;

do $$ begin
  if to_regprocedure('public.club_access_safety_facts(uuid,uuid,uuid,timestamptz)') is null
    or to_regprocedure('public.club_membership_access_window_allows(uuid,timestamptz)') is null
    or to_regprocedure('public.club_capability_allowed(uuid,uuid,text)') is null
    or to_regprocedure('public.club_start_membership_joining(uuid,uuid,uuid,text,text,text,text,date,text,text,text,text,text,text,boolean,boolean,boolean,text,text)') is null
    or to_regclass('public.club_access_credentials') is null
    or to_regclass('public.club_member_access_projection') is null
    or to_regclass('public.club_customers') is null
    or to_regclass('public.club_membership_holders') is null
    or to_regclass('public.club_memberships') is null then
    raise exception 'R12 access and directory prerequisites are missing; no changes made';
  end if;
end $$;

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
    if age_state='date_of_birth_conflict' then age_block := 'date_of_birth_conflict';
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

-- Coach search includes the authoritative Club customer name when Auth profile
-- names are absent or stale, while returning only linked active member accounts.
create or replace function public.coach_search_club_members(p_organisation_id uuid,p_query text)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
with permitted_members as (
  select m.user_id,m.organisation_id,o.name organisation_name,
    nullif(trim(concat_ws(' ',p.first_name,p.last_name)),'') profile_name,
    nullif(trim(p.display_name),'') profile_display_name,
    customer.display_name customer_name
  from public.club_members m
  join public.club_organisations o on o.id=m.organisation_id and o.active
  left join public.profiles p on p.id=m.user_id
  left join lateral (
    select c.display_name from public.club_customers c
    where c.organisation_id=m.organisation_id and c.user_id=m.user_id
    order by c.updated_at desc,c.created_at desc limit 1
  ) customer on true
  join public.coach_permissions cp on cp.organisation_id=m.organisation_id and cp.user_id=auth.uid() and cp.active
  join public.club_members coach_member on coach_member.organisation_id=m.organisation_id and coach_member.user_id=auth.uid()
    and coach_member.active and coach_member.role in ('trainer','gym_staff','gym_admin','owner')
  where m.organisation_id=p_organisation_id and m.active and m.role='member'
    and public.coach_has_explicit_access(auth.uid()) and length(btrim(coalesce(p_query,'')))>=2
)
select coalesce(jsonb_agg(jsonb_build_object(
  'userId',user_id,'name',coalesce(profile_name,profile_display_name,customer_name,'Member'),
  'organisationId',organisation_id,'organisationName',organisation_name,'memberStatus','active'
) order by lower(coalesce(profile_name,profile_display_name,customer_name,'Member'))),'[]'::jsonb)
from permitted_members
where position(lower(btrim(p_query)) in lower(coalesce(profile_name,'')))>0
  or position(lower(btrim(p_query)) in lower(coalesce(profile_display_name,'')))>0
  or position(lower(btrim(p_query)) in lower(coalesce(customer_name,'')))>0;
$$;
revoke all on function public.coach_search_club_members(uuid,text) from public,anon;
grant execute on function public.coach_search_club_members(uuid,text) to authenticated;

-- Read-only, capability checked directory facts. Access is a point-in-time
-- eligibility result; the actual controller decision rechecks all rules.
create or replace function public.club_list_member_directory_access_facts(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,auth as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.view') then
    raise exception 'Member directory is not permitted' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'customer_id',c.id,
    'membership_active',coalesce(m.status='active' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()),false),
    'r12_linked',c.user_id is not null,
    'account_verified',coalesce(verified.ok,false),
    'credential_issued',coalesce(credentials.ok,false),
    'access_eligible',coalesce(m.status='active' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())
      and projection.access_allowed and (projection.valid_from is null or projection.valid_from<=now())
      and (projection.valid_until is null or projection.valid_until>now())
      and coalesce((safety.facts->>'blocked')::boolean,false)=false
      and public.club_membership_access_window_allows(m.id,now())
      and c.user_id is not null and coalesce(verified.ok,false),false)
  ) order by c.id),'[]'::jsonb) into result
  from public.club_customers c
  left join lateral (
    select m.id,m.status,m.starts_at,m.ends_at from public.club_membership_holders h
    join public.club_memberships m on m.id=h.membership_id and m.organisation_id=h.organisation_id
    where h.organisation_id=p_organisation_id and (h.customer_id=c.id or (c.user_id is not null and h.user_id=c.user_id))
    order by case m.status when 'active' then 0 when 'pending' then 1 when 'paused' then 2 when 'suspended' then 2 when 'expired' then 3 when 'cancelled' then 4 else 5 end,m.starts_at desc,m.created_at desc limit 1
  ) m on true
  left join public.club_member_access_projection projection on projection.organisation_id=c.organisation_id and projection.customer_id=c.id
  left join lateral (select public.club_access_safety_facts(p_organisation_id,c.id,null,now()) facts) safety
    on m.id is not null and m.status='active' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()) and projection.access_allowed
  left join lateral (select exists(select 1 from auth.users u where u.id=c.user_id and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)) ok) verified on true
  left join lateral (select exists(select 1 from public.club_access_credentials ac where ac.organisation_id=c.organisation_id and ac.customer_id=c.id and ac.status='active'
    and (ac.valid_from is null or ac.valid_from<=now()) and (ac.valid_until is null or ac.valid_until>now())
    and (ac.credential_type='qr' or (ac.credential_type='pin' and ac.pin_length=6))) ok) credentials on true
  where c.organisation_id=p_organisation_id;
  return result;
end; $$;
revoke all on function public.club_list_member_directory_access_facts(uuid) from public,anon,authenticated;
grant execute on function public.club_list_member_directory_access_facts(uuid) to authenticated;


revoke all on function public.club_access_safety_facts(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
create or replace function public.club_start_membership_joining(
  p_organisation_id uuid,p_product_id uuid,p_location_id uuid,p_first_name text,p_last_name text,
  p_email text,p_phone text,p_date_of_birth date,p_address_line_1 text,p_address_line_2 text,
  p_town_city text,p_postcode text,p_emergency_name text,p_emergency_phone text,
  p_terms_accepted boolean,p_privacy_accepted boolean,p_marketing_consent boolean,
  p_payment_method text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_user uuid:=auth.uid(); v_auth record; v_customer public.club_customers%rowtype;
  v_product public.club_products%rowtype; v_request public.club_membership_join_requests%rowtype;
  v_status text; v_payment_state text; v_method text; v_checkout text; v_slug text;
  v_joining_fee integer:=0; v_first_period integer:=0; v_upfront integer:=0; v_fee_configured boolean:=false;
begin
  if v_user is null then raise exception 'Sign in to start joining' using errcode='42501'; end if;
  select lower(btrim(email)) email,email_confirmed_at into v_auth from auth.users where id=v_user;
  if v_auth.email_confirmed_at is null then raise exception 'Confirm your email before joining' using errcode='42501'; end if;
  if v_auth.email is distinct from lower(btrim(p_email)) then raise exception 'Joining email must match the signed-in account' using errcode='42501'; end if;
  if nullif(btrim(p_first_name),'') is null or nullif(btrim(p_last_name),'') is null or nullif(btrim(p_phone),'') is null
    or (p_date_of_birth is not null and p_date_of_birth>=current_date) or nullif(btrim(p_address_line_1),'') is null
    or nullif(btrim(p_postcode),'') is null or nullif(btrim(p_emergency_name),'') is null
    or nullif(btrim(p_emergency_phone),'') is null or not coalesce(p_terms_accepted,false)
    or not coalesce(p_privacy_accepted,false) or nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'Joining details are incomplete' using errcode='22023';
  end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'Venue is unavailable' using errcode='22023'; end if;
  select p,o.slug into v_product,v_slug from public.club_products p join public.club_organisations o on o.id=p.organisation_id
    where p.id=p_product_id and p.organisation_id=p_organisation_id and p.kind='membership' and p.sellable and p.archived_at is null and o.active and o.member_joinable;
  if not found then raise exception 'Membership product is unavailable' using errcode='22023'; end if;
  v_checkout:=case when v_product.price_minor=0 then 'free' when v_product.billing='recurring' then 'monthly_recurring'
    when v_product.duration_days=1 then 'day_pass' when v_product.duration_days=7 then 'week_pass'
    when v_product.duration_days>=365 then 'annual_one_off' else 'one_off' end;
  if v_checkout='monthly_recurring' then
    select coalesce(sum(amount_minor),0)::integer,count(*)>0 into v_joining_fee,v_fee_configured from public.club_membership_initial_charges
      where organisation_id=p_organisation_id and product_id=v_product.id and charge_type='joining_fee' and required and active;
    if v_slug='madhouse-gym' and not v_fee_configured then raise exception 'Monthly joining fee is not configured' using errcode='55000'; end if;
  end if;
  v_first_period:=case when v_product.price_minor=0 then 0 else v_product.price_minor end;
  v_upfront:=v_joining_fee+v_first_period;
  v_method:=case when v_checkout='free' then 'none' when v_checkout='monthly_recurring' then 'card_and_direct_debit'
    when v_slug='madhouse-gym' then 'card' else coalesce(nullif(p_payment_method,''),'card') end;
  if v_method not in ('none','card','direct_debit','card_and_direct_debit','staff_manual') then raise exception 'Choose a valid payment route' using errcode='22023'; end if;
  select * into v_customer from public.club_customers where organisation_id=p_organisation_id and user_id=v_user for update;
  if not found then
    if exists(select 1 from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_auth.email and user_id is distinct from v_user) then raise exception 'An existing member record matches this email; claim it instead' using errcode='23505'; end if;
    insert into public.club_customers(organisation_id,user_id,display_name,email,phone,status)
      values(p_organisation_id,v_user,btrim(p_first_name)||' '||btrim(p_last_name),v_auth.email,btrim(p_phone),'customer') returning * into v_customer;
  end if;
  update public.club_customers set display_name=btrim(p_first_name)||' '||btrim(p_last_name),email=v_auth.email,phone=btrim(p_phone),
    first_name=btrim(p_first_name),last_name=btrim(p_last_name),date_of_birth=coalesce(p_date_of_birth,date_of_birth),address_line_1=btrim(p_address_line_1),
    address_line_2=nullif(btrim(p_address_line_2),''),town_city=nullif(btrim(p_town_city),''),postcode=upper(btrim(p_postcode)),
    emergency_contact_name=btrim(p_emergency_name),emergency_contact_phone=btrim(p_emergency_phone),
    terms_accepted_at=coalesce(terms_accepted_at,now()),privacy_accepted_at=coalesce(privacy_accepted_at,now()),
    marketing_consent=coalesce(p_marketing_consent,false),marketing_consent_at=case when p_marketing_consent then now() else null end,updated_at=now()
    where id=v_customer.id returning * into v_customer;
  insert into public.profiles(id,email,display_name,first_name,last_name) values(v_user,v_auth.email,v_customer.display_name,btrim(p_first_name),btrim(p_last_name))
    on conflict(id) do update set email=excluded.email,display_name=excluded.display_name,first_name=excluded.first_name,last_name=excluded.last_name;
  insert into public.club_members(organisation_id,user_id,role,active,preferred_location_id) values(p_organisation_id,v_user,'member',true,p_location_id)
    on conflict(organisation_id,user_id) do update set active=true,preferred_location_id=excluded.preferred_location_id;
  select * into v_request from public.club_membership_join_requests where organisation_id=p_organisation_id and user_id=v_user and status not in ('completed','cancelled') for update;
  v_status:=case when v_checkout='free' then 'ready_to_activate' when v_method='staff_manual' then 'staff_review' else 'payment_required' end;
  v_payment_state:=case when v_checkout='free' then 'not_required' when v_method='staff_manual' then 'pending' else 'unavailable' end;
  if found then
    update public.club_membership_join_requests set customer_id=v_customer.id,product_id=v_product.id,location_id=p_location_id,status=v_status,
      payment_method=v_method,payment_state=v_payment_state,payment_provider=case when v_method in ('card','card_and_direct_debit') then 'stripe' when v_method='direct_debit' then 'gocardless' end,
      checkout_kind=v_checkout,joining_fee_minor=v_joining_fee,first_period_minor=v_first_period,upfront_amount_minor=v_upfront,
      upfront_provider=case when v_checkout='free' then null else 'stripe' end,upfront_payment_state=case when v_checkout='free' then 'not_required' else 'unavailable' end,
      recurring_provider=case when v_checkout='monthly_recurring' then 'gocardless' end,
      recurring_authority_state=case when v_checkout='monthly_recurring' then 'unavailable' else 'not_required' end,
      billing_anchor_day=case when v_checkout='monthly_recurring' then extract(day from current_date)::integer end,
      paid_through_at=null,payment_failure_reason=null,last_activity_at=now(),reminder_eligible_at=case when v_upfront>0 then now()+interval '24 hours' end,updated_at=now()
      where id=v_request.id returning * into v_request;
  else
    insert into public.club_membership_join_requests(organisation_id,user_id,customer_id,product_id,location_id,status,idempotency_key,payment_method,payment_state,payment_provider,last_activity_at,reminder_eligible_at,
      checkout_kind,joining_fee_minor,first_period_minor,upfront_amount_minor,upfront_provider,upfront_payment_state,recurring_provider,recurring_authority_state,billing_anchor_day)
    values(p_organisation_id,v_user,v_customer.id,v_product.id,p_location_id,v_status,btrim(p_idempotency_key),v_method,v_payment_state,
      case when v_method in ('card','card_and_direct_debit') then 'stripe' when v_method='direct_debit' then 'gocardless' end,now(),case when v_upfront>0 then now()+interval '24 hours' end,
      v_checkout,v_joining_fee,v_first_period,v_upfront,case when v_checkout='free' then null else 'stripe' end,case when v_checkout='free' then 'not_required' else 'unavailable' end,
      case when v_checkout='monthly_recurring' then 'gocardless' end,case when v_checkout='monthly_recurring' then 'unavailable' else 'not_required' end,
      case when v_checkout='monthly_recurring' then extract(day from current_date)::integer end) returning * into v_request;
  end if;
  insert into public.club_member_notification_intents(organisation_id,user_id,join_request_id,category,template_key,state,idempotency_key,not_before)
    values(p_organisation_id,v_user,v_request.id,case when v_upfront>0 then 'billing' else 'member_service' end,'join_incomplete','unavailable','join-reminder:'||v_request.id,coalesce(v_request.reminder_eligible_at,now()+interval '24 hours'))
    on conflict(organisation_id,idempotency_key) do nothing;
  return jsonb_build_object('request',to_jsonb(v_request),'customer',to_jsonb(v_customer),'product',to_jsonb(v_product));
end; $$;
revoke all on function public.club_start_membership_joining(uuid,uuid,uuid,text,text,text,text,date,text,text,text,text,text,text,boolean,boolean,boolean,text,text) from public,anon,authenticated;

commit;
