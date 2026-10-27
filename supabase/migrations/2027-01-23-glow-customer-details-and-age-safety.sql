-- Capture Glow Zone customer details on the existing shared Auth/customer identity
-- and keep self-declared DOB distinct from staff ID verification. This creates no
-- membership, entitlement, payment, credit, stock or provider record.
begin;

create or replace function public.club_glow_effective_age_status(p_organisation_id uuid,p_user_id uuid)
returns text language sql stable security definer set search_path=pg_catalog,public as $$
  select case
    when c.date_of_birth > (current_date-interval '18 years')::date then 'under_18'
    when a.status='under_18' or a.date_of_birth > (current_date-interval '18 years')::date then 'under_18'
    when a.status='verified' and a.date_of_birth <= (current_date-interval '18 years')::date
      and (c.date_of_birth is null or c.date_of_birth=a.date_of_birth) then 'verified'
    else 'required' end
  from (select 1) seed
  left join public.club_customers c on c.organisation_id=p_organisation_id and c.user_id=p_user_id
  left join public.club_glow_age_verifications a on a.organisation_id=p_organisation_id and a.user_id=p_user_id;
$$;
revoke all on function public.club_glow_effective_age_status(uuid,uuid) from public,anon,authenticated;

create or replace function public.club_glow_ensure_customer(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_user_id uuid:=auth.uid(); v_email text; v_verified_at timestamptz;
  v_first text; v_last text; v_phone text; v_dob date; v_raw_dob text; v_count integer;
  v_customer public.club_customers%rowtype; v_status text; v_missing jsonb:='[]'::jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not exists(select 1 from public.club_organisations o where o.id=p_organisation_id and o.active
    and exists(select 1 from public.club_location_service_hours h where h.organisation_id=o.id and h.service_key='sunbeds')) then
    raise exception 'Glow Zone is unavailable' using errcode='22023';
  end if;
  select lower(btrim(u.email)),u.email_confirmed_at,
    coalesce(nullif(btrim(p.first_name),''),nullif(btrim(u.raw_user_meta_data->>'first_name'),'')),
    coalesce(nullif(btrim(p.last_name),''),nullif(btrim(u.raw_user_meta_data->>'last_name'),'')),
    nullif(btrim(u.raw_user_meta_data->>'phone'),''),nullif(btrim(u.raw_user_meta_data->>'date_of_birth'),'')
  into v_email,v_verified_at,v_first,v_last,v_phone,v_raw_dob
  from auth.users u left join public.profiles p on p.id=u.id where u.id=v_user_id;
  if v_email is null or v_verified_at is null then raise exception 'Verified email required' using errcode='42501'; end if;
  if v_phone is not null and (length(v_phone) not between 7 and 25 or v_phone !~ '^\+?[0-9][0-9 ()-]*$') then v_phone:=null; end if;
  if v_raw_dob ~ '^\d{4}-\d{2}-\d{2}$' then begin v_dob:=v_raw_dob::date; exception when others then v_dob:=null; end; end if;
  if v_dob is not null and (v_dob>=current_date or v_dob<'1900-01-01'::date) then v_dob:=null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':'||v_user_id::text,0));
  select * into v_customer from public.club_customers where organisation_id=p_organisation_id and user_id=v_user_id for update;
  if found then v_status:='already_linked';
  else
    select count(*) into v_count from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_email;
    if v_count>1 then raise exception 'Customer records require staff review' using errcode='23505'; end if;
    if v_count=1 then
      select * into v_customer from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_email for update;
      if v_customer.user_id is not null and v_customer.user_id<>v_user_id then raise exception 'Customer record is already linked' using errcode='23505'; end if;
      update public.club_customers set user_id=v_user_id,updated_at=now() where id=v_customer.id returning * into v_customer;
      v_status:='linked_existing';
      insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
        values(p_organisation_id,v_user_id,'customer','glow.customer_self_linked','customer',v_customer.id,jsonb_build_object('match','verified_email'));
    else
      insert into public.club_customers(organisation_id,user_id,display_name,email,phone,status,first_name,last_name,date_of_birth)
      values(p_organisation_id,v_user_id,coalesce(nullif(concat_ws(' ',v_first,v_last),''),split_part(v_email,'@',1),'Glow Zone customer'),v_email,v_phone,'customer',v_first,v_last,v_dob)
      returning * into v_customer;
      v_status:='created';
      insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
        values(p_organisation_id,v_user_id,'customer','glow.customer_created','customer',v_customer.id,jsonb_build_object('source','verified_account'));
    end if;
  end if;
  update public.club_customers set
    first_name=coalesce(nullif(btrim(first_name),''),v_first),last_name=coalesce(nullif(btrim(last_name),''),v_last),
    phone=case when length(btrim(coalesce(phone,''))) between 7 and 25 and btrim(phone) ~ '^\+?[0-9][0-9 ()-]*$' then phone else v_phone end,
    date_of_birth=case when date_of_birth between '1900-01-01'::date and current_date-1 then date_of_birth else v_dob end,
    email=coalesce(nullif(btrim(email),''),v_email),updated_at=now()
  where id=v_customer.id returning * into v_customer;
  insert into public.profiles(id,email,display_name,first_name,last_name)
  values(v_user_id,v_email,coalesce(nullif(concat_ws(' ',v_first,v_last),''),split_part(v_email,'@',1)),v_first,v_last)
  on conflict(id) do update set first_name=coalesce(nullif(btrim(public.profiles.first_name),''),excluded.first_name),
    last_name=coalesce(nullif(btrim(public.profiles.last_name),''),excluded.last_name),email=coalesce(public.profiles.email,excluded.email);
  if nullif(btrim(v_customer.first_name),'') is null then v_missing:=v_missing||'"firstName"'::jsonb; end if;
  if nullif(btrim(v_customer.last_name),'') is null then v_missing:=v_missing||'"lastName"'::jsonb; end if;
  if nullif(btrim(v_customer.phone),'') is null then v_missing:=v_missing||'"phone"'::jsonb; end if;
  if v_customer.date_of_birth is null then v_missing:=v_missing||'"dateOfBirth"'::jsonb; end if;
  return jsonb_build_object('customer_id',v_customer.id,'status',v_status,'missing_fields',v_missing);
end; $$;
revoke all on function public.club_glow_ensure_customer(uuid) from public,anon,authenticated;
grant execute on function public.club_glow_ensure_customer(uuid) to authenticated;

create or replace function public.club_glow_complete_customer_details(
  p_organisation_id uuid,p_first_name text,p_last_name text,p_phone text,p_date_of_birth date
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid(); v_email text; v_confirmed timestamptz; c public.club_customers%rowtype;
begin
  select lower(btrim(email)),email_confirmed_at into v_email,v_confirmed from auth.users where id=v_user;
  if v_user is null or v_confirmed is null then raise exception 'Verified account required' using errcode='42501'; end if;
  if not exists(select 1 from public.club_organisations o where o.id=p_organisation_id and o.active
    and exists(select 1 from public.club_location_service_hours h where h.organisation_id=o.id and h.service_key='sunbeds')) then
    raise exception 'Glow Zone is unavailable' using errcode='22023';
  end if;
  if nullif(btrim(p_first_name),'') is null or nullif(btrim(p_last_name),'') is null
    or length(btrim(p_phone)) not between 7 and 25 or btrim(p_phone) !~ '^\+?[0-9][0-9 ()-]*$'
    or p_date_of_birth is null or p_date_of_birth>=current_date or p_date_of_birth<'1900-01-01'::date then
    raise exception 'Glow Zone customer details are incomplete' using errcode='22023';
  end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and user_id=v_user for update;
  if not found then raise exception 'Glow Zone customer record is not linked' using errcode='42501'; end if;
  update public.club_customers set first_name=coalesce(nullif(btrim(first_name),''),btrim(p_first_name)),
    last_name=coalesce(nullif(btrim(last_name),''),btrim(p_last_name)),
    phone=case when length(btrim(coalesce(phone,''))) between 7 and 25 and btrim(phone) ~ '^\+?[0-9][0-9 ()-]*$' then phone else btrim(p_phone) end,
    date_of_birth=case when date_of_birth between '1900-01-01'::date and current_date-1 then date_of_birth else p_date_of_birth end,
    email=coalesce(nullif(btrim(email),''),v_email),updated_at=now()
  where id=c.id returning * into c;
  insert into public.profiles(id,email,display_name,first_name,last_name)
  values(v_user,v_email,btrim(p_first_name)||' '||btrim(p_last_name),btrim(p_first_name),btrim(p_last_name))
  on conflict(id) do update set first_name=coalesce(nullif(btrim(public.profiles.first_name),''),excluded.first_name),
    last_name=coalesce(nullif(btrim(public.profiles.last_name),''),excluded.last_name),email=coalesce(public.profiles.email,excluded.email);
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    values(p_organisation_id,v_user,'customer','glow.customer_details_completed','customer',c.id,jsonb_build_object('missing_fields_completed',true));
  return jsonb_build_object('customer_id',c.id,'complete',true,'declared_under_18',c.date_of_birth>(current_date-interval '18 years')::date);
end; $$;
revoke all on function public.club_glow_complete_customer_details(uuid,text,text,text,date) from public,anon;
grant execute on function public.club_glow_complete_customer_details(uuid,text,text,text,date) to authenticated;

create or replace function public.club_glow_age_status(p_organisation_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; a public.club_glow_age_verifications%rowtype; v_status text;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then
    raise exception 'Glow Zone age status is not permitted' using errcode='42501';
  end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and user_id=p_user_id;
  if not found then return null; end if;
  select * into a from public.club_glow_age_verifications where organisation_id=p_organisation_id and user_id=p_user_id;
  v_status:=public.club_glow_effective_age_status(p_organisation_id,p_user_id);
  return jsonb_build_object('date_of_birth',coalesce(c.date_of_birth,a.date_of_birth),'declared_date_of_birth',c.date_of_birth,
    'status',v_status,'first_name',c.first_name,'last_name',c.last_name,'email',c.email,'phone',c.phone,
    'verified_at',case when v_status='verified' then a.verified_at end,'verification_method',case when v_status='verified' then a.verification_method end);
end; $$;
revoke all on function public.club_glow_age_status(uuid,uuid) from public,anon;
grant execute on function public.club_glow_age_status(uuid,uuid) to authenticated;

create or replace function public.club_glow_record_age_verification(p_organisation_id uuid,p_user_id uuid,p_date_of_birth date,p_method text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_glow_age_verifications%rowtype; v_declared date;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'induction.perform') then
    raise exception 'Age verification is not permitted' using errcode='42501';
  end if;
  if p_date_of_birth is null or p_date_of_birth>=current_date or p_date_of_birth<'1900-01-01'::date or nullif(btrim(p_method),'') is null then
    raise exception 'Valid ID details are required' using errcode='22023';
  end if;
  select date_of_birth into v_declared from public.club_customers where organisation_id=p_organisation_id and user_id=p_user_id;
  if not found then raise exception 'Glow Zone customer not found' using errcode='P0002'; end if;
  if v_declared>(current_date-interval '18 years')::date then raise exception 'Declared under-18 restriction cannot be overridden' using errcode='42501'; end if;
  if v_declared is not null and v_declared<>p_date_of_birth then raise exception 'ID date of birth does not match the declared customer details' using errcode='22023'; end if;
  insert into public.club_glow_age_verifications(organisation_id,user_id,date_of_birth,status,verified_at,verified_by,verification_method)
  values(p_organisation_id,p_user_id,p_date_of_birth,case when p_date_of_birth<=(current_date-interval '18 years')::date then 'verified' else 'under_18' end,
    case when p_date_of_birth<=(current_date-interval '18 years')::date then now() end,
    case when p_date_of_birth<=(current_date-interval '18 years')::date then auth.uid() end,btrim(p_method))
  on conflict(organisation_id,user_id) do update set date_of_birth=excluded.date_of_birth,status=excluded.status,
    verified_at=excluded.verified_at,verified_by=excluded.verified_by,verification_method=excluded.verification_method
  returning * into r;
  return to_jsonb(r);
end; $$;
revoke all on function public.club_glow_record_age_verification(uuid,uuid,date,text) from public,anon;
grant execute on function public.club_glow_record_age_verification(uuid,uuid,date,text) to authenticated;

create or replace function public.club_glow_create_session_request(p_organisation_id uuid,p_bed_type text,p_duration_minutes integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid(); v_token text:='GLOW-'||upper(encode(extensions.gen_random_bytes(16),'hex'));
  v_request public.club_glow_session_requests%rowtype; v_balance integer; v_customer public.club_customers%rowtype;
begin
  if v_user is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if p_bed_type not in ('stand_up','lying_down') or p_duration_minutes not between 1 and 15 then raise exception 'Choose a bed and between 1 and 15 minutes' using errcode='22023'; end if;
  if not exists(select 1 from public.club_organisations o where o.id=p_organisation_id and o.slug='madhouse-gym' and o.active
    and exists(select 1 from public.club_locations l where l.organisation_id=o.id and l.active and lower(l.name) like '%carlton%')) then raise exception 'Glow Zone is only available at Carlton' using errcode='22023'; end if;
  select * into v_customer from public.club_customers where organisation_id=p_organisation_id and user_id=v_user;
  if not found then raise exception 'Glow Zone customer account is not linked' using errcode='42501'; end if;
  if v_customer.date_of_birth>(current_date-interval '18 years')::date then raise exception 'Glow Zone sunbeds are available only to customers aged 18 or over' using errcode='42501'; end if;
  select coalesce(sum(l.remaining_quantity) filter(where l.expires_at is null or l.expires_at>now()),0)::integer into v_balance
    from public.club_service_credit_lots l where l.organisation_id=p_organisation_id and l.user_id=v_user and l.credit_key='sunbed_minutes';
  if v_balance<p_duration_minutes then raise exception 'Insufficient Glow Zone minutes' using errcode='22023'; end if;
  update public.club_glow_session_requests set status='expired',updated_at=now() where organisation_id=p_organisation_id and user_id=v_user and status='pending' and expires_at<=now();
  update public.club_glow_session_requests set status='cancelled',cancelled_at=now(),updated_at=now() where organisation_id=p_organisation_id and user_id=v_user and status='pending';
  insert into public.club_glow_session_requests(organisation_id,user_id,bed_type,duration_minutes,token_hash,token_suffix,expires_at)
  values(p_organisation_id,v_user,p_bed_type,p_duration_minutes,extensions.digest(convert_to(v_token,'UTF8'),'sha256'),right(v_token,6),now()+interval '5 minutes') returning * into v_request;
  return public.club_glow_request_json(v_request)||jsonb_build_object('token',v_token);
end; $$;

create or replace function public.club_glow_scan_session_request(p_organisation_id uuid,p_token text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_glow_session_requests%rowtype; c public.club_customers%rowtype; age_status text; available integer;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'services.manage') then raise exception 'Glow Zone reception permission required' using errcode='42501'; end if;
  select * into r from public.club_glow_session_requests where organisation_id=p_organisation_id and token_hash=extensions.digest(convert_to(upper(btrim(p_token)),'UTF8'),'sha256');
  if not found then raise exception 'Session request not found' using errcode='P0002'; end if;
  if r.status='pending' and r.expires_at<=now() then update public.club_glow_session_requests set status='expired',updated_at=now() where id=r.id returning * into r; end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and user_id=r.user_id;
  age_status:=public.club_glow_effective_age_status(p_organisation_id,r.user_id);
  select coalesce(sum(l.remaining_quantity) filter(where l.expires_at is null or l.expires_at>now()),0)::integer into available
    from public.club_service_credit_lots l where l.organisation_id=p_organisation_id and l.user_id=r.user_id and l.credit_key='sunbed_minutes';
  return public.club_glow_request_json(r)||jsonb_build_object('user_id',r.user_id,'customer_name',coalesce(c.display_name,'Glow Zone customer'),
    'customer_email',c.email,'customer_phone',c.phone,'declared_date_of_birth',c.date_of_birth,'balance_minutes',available,'age_status',coalesce(age_status,'required'));
end; $$;

create or replace function public.club_glow_spend(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_minutes integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v jsonb; u public.club_service_credit_usage%rowtype; l record; take integer; left_qty integer:=p_minutes; alloc jsonb:='[]'::jsonb; adult boolean;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) or p_minutes<=0 then raise exception 'Glow Zone usage is not permitted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and lower(name) like '%carlton%') then raise exception 'Glow Zone is only available at Carlton' using errcode='22023'; end if;
  if exists(select 1 from public.club_service_credit_usage where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key) then select to_jsonb(x) into v from public.club_service_credit_usage x where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; return v; end if;
  adult:=public.club_glow_effective_age_status(p_organisation_id,p_user_id)='verified';
  if not coalesce(adult,false) then raise exception 'Glow Zone age verification required' using errcode='42501'; end if;
  for l in select * from public.club_service_credit_lots where organisation_id=p_organisation_id and user_id=p_user_id and credit_key='sunbed_minutes' and remaining_quantity>0 and (expires_at is null or expires_at>now()) order by expires_at nulls last,granted_at,id for update loop
    exit when left_qty=0; take:=least(left_qty,l.remaining_quantity); update public.club_service_credit_lots set remaining_quantity=remaining_quantity-take where id=l.id;
    alloc:=alloc||jsonb_build_array(jsonb_build_object('lot_id',l.id,'quantity',take)); left_qty:=left_qty-take;
  end loop;
  if left_qty>0 then raise exception 'Insufficient Glow Zone minutes' using errcode='22023'; end if;
  insert into public.club_service_credit_usage(organisation_id,user_id,location_id,minutes,actor_user_id,idempotency_key,allocations,qualifying_loyalty)
  values(p_organisation_id,p_user_id,p_location_id,p_minutes,auth.uid(),p_idempotency_key,alloc,p_minutes>=5) returning * into u;
  return to_jsonb(u);
end; $$;

revoke all on function public.club_glow_create_session_request(uuid,text,integer),public.club_glow_scan_session_request(uuid,text),public.club_glow_spend(uuid,uuid,uuid,integer,text) from public,anon;
grant execute on function public.club_glow_create_session_request(uuid,text,integer),public.club_glow_scan_session_request(uuid,text),public.club_glow_spend(uuid,uuid,uuid,integer,text) to authenticated;

commit;
