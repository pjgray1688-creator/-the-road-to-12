-- Short-lived member-created Glow Zone requests, redeemed atomically by authorised Carlton staff.
-- Forward-only migration artifact: review before applying. It is not executed by the application.

create table public.club_glow_session_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  bed_type text not null check (bed_type in ('stand_up','lying_down')),
  duration_minutes integer not null check (duration_minutes between 1 and 15),
  token_hash bytea not null,
  token_suffix text not null,
  status text not null default 'pending' check (status in ('pending','cancelled','redeemed','expired')),
  expires_at timestamptz not null,
  cancelled_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id) on delete set null,
  location_id uuid,
  usage_id uuid references public.club_service_credit_usage(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, token_hash),
  foreign key (location_id, organisation_id) references public.club_locations(id, organisation_id),
  check (expires_at > created_at),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check ((status = 'redeemed') = (redeemed_at is not null))
);

create unique index club_glow_one_pending_request_per_user
  on public.club_glow_session_requests(organisation_id, user_id) where status = 'pending';
create index club_glow_session_requests_expiry_idx
  on public.club_glow_session_requests(organisation_id, status, expires_at);

alter table public.club_glow_session_requests enable row level security;
revoke all on table public.club_glow_session_requests from public, anon, authenticated;
grant select on table public.club_glow_session_requests to authenticated;
create policy glow_session_request_owner_staff_read on public.club_glow_session_requests
  for select to authenticated using (
    user_id = auth.uid()
    or public.club_capability_allowed(organisation_id, auth.uid(), 'services.manage')
  );

create or replace function public.club_glow_request_json(r public.club_glow_session_requests)
returns jsonb language sql stable set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'id', r.id, 'bed_type', r.bed_type, 'duration_minutes', r.duration_minutes,
    'status', case when r.status = 'pending' and r.expires_at <= now() then 'expired' else r.status end,
    'expires_at', r.expires_at, 'created_at', r.created_at, 'redeemed_at', r.redeemed_at,
    'token_suffix', r.token_suffix
  );
$$;

create or replace function public.club_glow_create_session_request(
  p_organisation_id uuid, p_bed_type text, p_duration_minutes integer
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_user uuid := auth.uid();
  v_token text := 'GLOW-' || upper(encode(extensions.gen_random_bytes(16), 'hex'));
  v_request public.club_glow_session_requests%rowtype;
  v_balance integer;
begin
  if v_user is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_bed_type not in ('stand_up','lying_down') or p_duration_minutes not between 1 and 15 then
    raise exception 'Choose a bed and between 1 and 15 minutes' using errcode = '22023';
  end if;
  if not exists(
    select 1 from public.club_organisations o where o.id=p_organisation_id and o.slug='madhouse-gym' and o.active
      and exists(select 1 from public.club_locations l where l.organisation_id=o.id and l.active and lower(l.name) like '%carlton%')
  ) then raise exception 'Glow Zone is only available at Carlton' using errcode='22023'; end if;
  if not exists(select 1 from public.club_customers c where c.organisation_id=p_organisation_id and c.user_id=v_user) then
    raise exception 'Glow Zone customer account is not linked' using errcode = '42501';
  end if;
  select coalesce(sum(l.remaining_quantity) filter(where l.expires_at is null or l.expires_at > now()), 0)::integer
    into v_balance from public.club_service_credit_lots l
    where l.organisation_id=p_organisation_id and l.user_id=v_user and l.credit_key='sunbed_minutes';
  if v_balance < p_duration_minutes then raise exception 'Insufficient Glow Zone minutes' using errcode = '22023'; end if;
  update public.club_glow_session_requests set status='expired', updated_at=now()
    where organisation_id=p_organisation_id and user_id=v_user and status='pending' and expires_at<=now();
  -- A new request supersedes an unredeemed one, so a lost browser session cannot strand the member.
  update public.club_glow_session_requests set status='cancelled',cancelled_at=now(),updated_at=now()
    where organisation_id=p_organisation_id and user_id=v_user and status='pending';
  insert into public.club_glow_session_requests(
    organisation_id,user_id,bed_type,duration_minutes,token_hash,token_suffix,expires_at
  ) values (
    p_organisation_id,v_user,p_bed_type,p_duration_minutes,
    extensions.digest(convert_to(v_token,'UTF8'),'sha256'),right(v_token,6),now()+interval '5 minutes'
  ) returning * into v_request;
  return public.club_glow_request_json(v_request) || jsonb_build_object('token',v_token);
end;
$$;

create or replace function public.club_glow_get_session_request(p_organisation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.club_glow_session_requests%rowtype;
begin
  select * into r from public.club_glow_session_requests
    where id=p_request_id and organisation_id=p_organisation_id and user_id=auth.uid();
  if not found then raise exception 'Session request not found' using errcode='P0002'; end if;
  if r.status='pending' and r.expires_at<=now() then
    update public.club_glow_session_requests set status='expired',updated_at=now() where id=r.id returning * into r;
  end if;
  return public.club_glow_request_json(r);
end;
$$;

create or replace function public.club_glow_cancel_session_request(p_organisation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.club_glow_session_requests%rowtype;
begin
  select * into r from public.club_glow_session_requests
    where id=p_request_id and organisation_id=p_organisation_id and user_id=auth.uid() for update;
  if not found then raise exception 'Session request not found' using errcode='P0002'; end if;
  if r.status='redeemed' then raise exception 'This session has already been approved' using errcode='22023'; end if;
  if r.status='pending' and r.expires_at>now() then
    update public.club_glow_session_requests set status='cancelled',cancelled_at=now(),updated_at=now()
      where id=r.id returning * into r;
  elsif r.status='pending' then
    update public.club_glow_session_requests set status='expired',updated_at=now() where id=r.id returning * into r;
  end if;
  return public.club_glow_request_json(r);
end;
$$;

create or replace function public.club_glow_scan_session_request(p_organisation_id uuid,p_token text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.club_glow_session_requests%rowtype; c public.club_customers%rowtype; age_status text; available integer;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'services.manage') then
    raise exception 'Glow Zone reception permission required' using errcode='42501';
  end if;
  select * into r from public.club_glow_session_requests
    where organisation_id=p_organisation_id
      and token_hash=extensions.digest(convert_to(upper(btrim(p_token)),'UTF8'),'sha256');
  if not found then raise exception 'Session request not found' using errcode='P0002'; end if;
  if r.status='pending' and r.expires_at<=now() then
    update public.club_glow_session_requests set status='expired',updated_at=now() where id=r.id returning * into r;
  end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and user_id=r.user_id;
  select case when a.status='verified' and a.date_of_birth <= (current_date-interval '18 years')::date then 'verified'
              when a.status='under_18' or a.date_of_birth > (current_date-interval '18 years')::date then 'under_18'
              else 'required' end into age_status
    from public.club_glow_age_verifications a where a.organisation_id=p_organisation_id and a.user_id=r.user_id;
  select coalesce(sum(l.remaining_quantity) filter(where l.expires_at is null or l.expires_at>now()),0)::integer into available
    from public.club_service_credit_lots l where l.organisation_id=p_organisation_id and l.user_id=r.user_id and l.credit_key='sunbed_minutes';
  return public.club_glow_request_json(r) || jsonb_build_object(
    'user_id',r.user_id,'customer_name',coalesce(c.display_name,'Glow Zone customer'),
    'customer_email',c.email,'balance_minutes',available,'age_status',coalesce(age_status,'required')
  );
end;
$$;

create or replace function public.club_glow_confirm_session_request(
  p_organisation_id uuid,p_location_id uuid,p_token text,p_bed_type text,p_duration_minutes integer
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.club_glow_session_requests%rowtype; usage jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'services.manage')
    or not public.club_location_authorized(p_organisation_id,p_location_id) then
    raise exception 'Glow Zone reception permission required' using errcode='42501';
  end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and lower(name) like '%carlton%') then
    raise exception 'Glow Zone is only available at Carlton' using errcode='22023';
  end if;
  select * into r from public.club_glow_session_requests
    where organisation_id=p_organisation_id
      and token_hash=extensions.digest(convert_to(upper(btrim(p_token)),'UTF8'),'sha256') for update;
  if not found then raise exception 'Session request not found' using errcode='P0002'; end if;
  if r.status='redeemed' then return public.club_glow_request_json(r) || jsonb_build_object('already_used',true,'usage_id',r.usage_id); end if;
  if r.status='cancelled' then raise exception 'This session request was cancelled' using errcode='22023'; end if;
  if r.status='expired' or r.expires_at<=now() then
    if r.status='pending' then update public.club_glow_session_requests set status='expired',updated_at=now() where id=r.id; end if;
    raise exception 'This session request has expired' using errcode='22023';
  end if;
  if p_bed_type<>r.bed_type or p_duration_minutes<>r.duration_minutes then
    raise exception 'Confirm the requested bed and duration exactly' using errcode='22023';
  end if;
  usage := public.club_glow_spend(p_organisation_id,r.user_id,p_location_id,r.duration_minutes,'glow-session:'||r.id::text);
  update public.club_glow_session_requests set status='redeemed',redeemed_at=now(),redeemed_by=auth.uid(),
    location_id=p_location_id,usage_id=(usage->>'id')::uuid,updated_at=now() where id=r.id returning * into r;
  return public.club_glow_request_json(r) || jsonb_build_object('already_used',false,'usage_id',r.usage_id);
end;
$$;

-- Align the existing staff UI with the existing induction.perform permission. The adult test remains fail-closed.
create or replace function public.club_glow_record_age_verification(p_organisation_id uuid,p_user_id uuid,p_date_of_birth date,p_method text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_glow_age_verifications%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'induction.perform') then
    raise exception 'Age verification is not permitted' using errcode='42501';
  end if;
  insert into public.club_glow_age_verifications(organisation_id,user_id,date_of_birth,status,verified_at,verified_by,verification_method)
  values(p_organisation_id,p_user_id,p_date_of_birth,case when p_date_of_birth <= (current_date-interval '18 years')::date then 'verified' else 'under_18' end,
    case when p_date_of_birth <= (current_date-interval '18 years')::date then now() end,
    case when p_date_of_birth <= (current_date-interval '18 years')::date then auth.uid() end,p_method)
  on conflict(organisation_id,user_id) do update set date_of_birth=excluded.date_of_birth,status=excluded.status,
    verified_at=excluded.verified_at,verified_by=excluded.verified_by,verification_method=excluded.verification_method
  returning * into r;
  return to_jsonb(r);
end;
$$;

revoke all on function public.club_glow_request_json(public.club_glow_session_requests),
  public.club_glow_create_session_request(uuid,text,integer),public.club_glow_get_session_request(uuid,uuid),
  public.club_glow_cancel_session_request(uuid,uuid),public.club_glow_scan_session_request(uuid,text),
  public.club_glow_confirm_session_request(uuid,uuid,text,text,integer),
  public.club_glow_record_age_verification(uuid,uuid,date,text) from public,anon,authenticated;
grant execute on function public.club_glow_create_session_request(uuid,text,integer),
  public.club_glow_get_session_request(uuid,uuid),public.club_glow_cancel_session_request(uuid,uuid),
  public.club_glow_scan_session_request(uuid,text),public.club_glow_confirm_session_request(uuid,uuid,text,text,integer),
  public.club_glow_record_age_verification(uuid,uuid,date,text) to authenticated;
