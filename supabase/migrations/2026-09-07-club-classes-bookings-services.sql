-- R12 Club classes, bookings and guest services foundation.
-- Forward-only migration: prepare and review; do not execute from the application.

alter table public.club_locations
  add constraint club_locations_id_organisation_unique unique (id, organisation_id);

create table public.club_customers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null check (length(btrim(display_name)) > 0),
  email text,
  phone text,
  status text not null default 'customer' check (status in ('guest','member','customer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id)
);
create unique index club_customers_organisation_user_unique
  on public.club_customers(organisation_id, user_id) where user_id is not null;
create index club_customers_organisation_idx on public.club_customers(organisation_id);

create table public.club_class_types (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  description text,
  default_duration_minutes integer not null check (default_duration_minutes > 0),
  default_capacity integer check (default_capacity > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  unique (organisation_id, name)
);

create table public.club_class_sessions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null,
  class_type_id uuid not null,
  host_user_id uuid references auth.users(id) on delete set null,
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer check (capacity > 0),
  booking_opens_at timestamptz,
  booking_closes_at timestamptz,
  cancellation_closes_at timestamptz,
  visibility text not null default 'public' check (visibility in ('public','members_only','private')),
  status text not null default 'scheduled' check (status in ('scheduled','cancelled','completed')),
  recurrence_metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  foreign key (location_id, organisation_id) references public.club_locations(id, organisation_id),
  foreign key (class_type_id, organisation_id) references public.club_class_types(id, organisation_id),
  check (ends_at > starts_at),
  check (booking_opens_at is null or booking_closes_at is null or booking_opens_at < booking_closes_at),
  check (booking_closes_at is null or booking_closes_at <= starts_at),
  check (cancellation_closes_at is null or cancellation_closes_at <= starts_at),
  check (recurrence_metadata is null or jsonb_typeof(recurrence_metadata) = 'object')
);
create index club_class_sessions_organisation_starts_idx on public.club_class_sessions(organisation_id, starts_at);
create index club_class_sessions_location_starts_idx on public.club_class_sessions(location_id, starts_at);
create index club_class_sessions_host_starts_idx on public.club_class_sessions(host_user_id, starts_at) where host_user_id is not null;

create table public.club_class_bookings (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  session_id uuid not null,
  customer_id uuid not null,
  status text not null check (status in ('confirmed','cancelled','waitlisted')),
  booked_at timestamptz not null default now(),
  cancelled_at timestamptz,
  attendance_state text not null default 'pending' check (attendance_state in ('pending','checked_in','attended','no_show')),
  entitlement_usage_id uuid references public.club_entitlement_usage(id) on delete set null,
  payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  foreign key (session_id, organisation_id) references public.club_class_sessions(id, organisation_id),
  foreign key (customer_id, organisation_id) references public.club_customers(id, organisation_id),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create unique index club_class_bookings_active_customer_unique
  on public.club_class_bookings(session_id, customer_id)
  where status in ('confirmed','waitlisted');
create index club_class_bookings_customer_idx on public.club_class_bookings(customer_id, booked_at desc);
create index club_class_bookings_session_status_idx on public.club_class_bookings(session_id, status);

create table public.club_services (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid,
  name text not null check (length(btrim(name)) > 0),
  description text,
  category text not null check (length(btrim(category)) > 0),
  duration_minutes integer check (duration_minutes > 0),
  price_minor integer check (price_minor >= 0),
  currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  foreign key (location_id, organisation_id) references public.club_locations(id, organisation_id),
  unique nulls not distinct (organisation_id, location_id, name)
);

create table public.club_service_transactions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null,
  service_id uuid not null,
  customer_id uuid,
  staff_user_id uuid references auth.users(id) on delete set null,
  quantity integer not null check (quantity > 0),
  unit_price_minor integer not null check (unit_price_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  payment_status text not null check (payment_status in ('unpaid','pending','paid','waived','refunded')),
  payment_method text check (payment_method is null or length(btrim(payment_method)) > 0),
  payment_reference text,
  fulfilment_status text not null check (fulfilment_status in ('pending','fulfilled','cancelled','failed')),
  external_fulfilment_reference text,
  occurred_at timestamptz not null default now(),
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, organisation_id) references public.club_locations(id, organisation_id),
  foreign key (service_id, organisation_id) references public.club_services(id, organisation_id),
  foreign key (customer_id, organisation_id) references public.club_customers(id, organisation_id),
  check (metadata is null or jsonb_typeof(metadata) = 'object')
);
create index club_service_transactions_organisation_occurred_idx on public.club_service_transactions(organisation_id, occurred_at desc);
create index club_service_transactions_customer_idx on public.club_service_transactions(customer_id, occurred_at desc) where customer_id is not null;

alter table public.club_customers enable row level security;
alter table public.club_class_types enable row level security;
alter table public.club_class_sessions enable row level security;
alter table public.club_class_bookings enable row level security;
alter table public.club_services enable row level security;
alter table public.club_service_transactions enable row level security;

create or replace function public.club_has_customer_access(target_organisation_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.club_customers where organisation_id = target_organisation_id and user_id = auth.uid())
    or public.club_has_active_role(target_organisation_id, array['member','trainer','gym_staff','gym_admin','owner','guest'])
  );
$$;

create or replace function public.club_is_session_host(target_session_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select auth.uid() is not null and exists (
    select 1 from public.club_class_sessions where id = target_session_id and host_user_id = auth.uid()
  );
$$;

create policy club_customers_self_select on public.club_customers for select to authenticated
  using (user_id = auth.uid());
create policy club_customers_staff_select on public.club_customers for select to authenticated
  using (public.club_has_active_role(organisation_id, array['gym_staff','gym_admin','owner']));

create policy club_class_types_customer_select on public.club_class_types for select to authenticated
  using (public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']) or (active and public.club_has_customer_access(organisation_id)));

create policy club_class_sessions_customer_select on public.club_class_sessions for select to authenticated
  using (
    public.club_has_active_role(organisation_id, array['gym_staff','gym_admin','owner'])
    or host_user_id = auth.uid()
    or (visibility = 'public' and public.club_has_customer_access(organisation_id))
    or (visibility = 'members_only' and public.club_has_active_role(organisation_id, array['member','trainer','gym_staff','gym_admin','owner']))
  );

create policy club_class_bookings_self_select on public.club_class_bookings for select to authenticated
  using (exists (select 1 from public.club_customers customer where customer.id = customer_id and customer.user_id = auth.uid()));
create policy club_class_bookings_staff_select on public.club_class_bookings for select to authenticated
  using (public.club_has_active_role(organisation_id, array['gym_staff','gym_admin','owner']) or public.club_is_session_host(session_id));

create policy club_services_customer_select on public.club_services for select to authenticated
  using (public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']) or (active and public.club_has_customer_access(organisation_id)));

create policy club_service_transactions_self_select on public.club_service_transactions for select to authenticated
  using (exists (select 1 from public.club_customers customer where customer.id = customer_id and customer.user_id = auth.uid()));
create policy club_service_transactions_staff_select on public.club_service_transactions for select to authenticated
  using (public.club_has_active_role(organisation_id, array['gym_staff','gym_admin','owner']));

create or replace function public.club_save_class_type(
  p_id uuid, p_organisation_id uuid, p_name text, p_description text,
  p_default_duration_minutes integer, p_default_capacity integer, p_active boolean
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row public.club_class_types%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id, array['gym_admin','owner']) then raise exception 'Class type administration is not permitted' using errcode = '42501'; end if;
  if nullif(btrim(p_name), '') is null or p_default_duration_minutes <= 0 or (p_default_capacity is not null and p_default_capacity <= 0) or p_active is null then raise exception 'Invalid class type input' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.club_class_types(organisation_id,name,description,default_duration_minutes,default_capacity,active)
    values(p_organisation_id,btrim(p_name),p_description,p_default_duration_minutes,p_default_capacity,p_active) returning * into v_row;
  else
    update public.club_class_types set name=btrim(p_name),description=p_description,default_duration_minutes=p_default_duration_minutes,default_capacity=p_default_capacity,active=p_active,updated_at=now()
    where id=p_id and organisation_id=p_organisation_id returning * into v_row;
    if not found then raise exception 'Class type not found' using errcode = 'P0002'; end if;
  end if;
  return to_jsonb(v_row);
end; $$;

create or replace function public.club_save_class_session(
  p_id uuid, p_organisation_id uuid, p_location_id uuid, p_class_type_id uuid,
  p_host_user_id uuid, p_title text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_capacity integer, p_booking_opens_at timestamptz, p_booking_closes_at timestamptz,
  p_cancellation_closes_at timestamptz, p_visibility text, p_status text, p_recurrence_metadata jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row public.club_class_sessions%rowtype; v_existing public.club_class_sessions%rowtype; v_admin boolean;
begin
  v_admin := auth.uid() is not null and public.club_has_active_role(p_organisation_id, array['gym_admin','owner']);
  if p_id is null then
    if not v_admin then raise exception 'Class session creation is not permitted' using errcode = '42501'; end if;
  else
    select * into v_existing from public.club_class_sessions where id=p_id and organisation_id=p_organisation_id for update;
    if not found then raise exception 'Class session not found' using errcode = 'P0002'; end if;
    if not v_admin and not (v_existing.host_user_id=auth.uid() and p_host_user_id=auth.uid() and public.club_has_active_role(p_organisation_id,array['trainer'])) then raise exception 'Class session update is not permitted' using errcode = '42501'; end if;
    if p_capacity is not null and (select count(*) from public.club_class_bookings where session_id=p_id and status='confirmed') > p_capacity then raise exception 'Capacity is below existing confirmed bookings' using errcode='22023'; end if;
  end if;
  if p_ends_at<=p_starts_at or (p_capacity is not null and p_capacity<=0) or p_visibility not in ('public','members_only','private') or p_status not in ('scheduled','cancelled','completed') or (p_recurrence_metadata is not null and jsonb_typeof(p_recurrence_metadata)<>'object') then raise exception 'Invalid class session input' using errcode='22023'; end if;
  if p_host_user_id is not null and not exists(
    select 1 from public.club_members member
    where member.organisation_id=p_organisation_id and member.user_id=p_host_user_id
      and member.active and member.role in ('trainer','gym_admin','owner')
  ) then
    raise exception 'Class host is not authorised' using errcode='22023';
  end if;
  if p_id is null then
    insert into public.club_class_sessions(organisation_id,location_id,class_type_id,host_user_id,title,starts_at,ends_at,capacity,booking_opens_at,booking_closes_at,cancellation_closes_at,visibility,status,recurrence_metadata)
    values(p_organisation_id,p_location_id,p_class_type_id,p_host_user_id,p_title,p_starts_at,p_ends_at,p_capacity,p_booking_opens_at,p_booking_closes_at,p_cancellation_closes_at,p_visibility,p_status,p_recurrence_metadata) returning * into v_row;
  else
    update public.club_class_sessions set location_id=p_location_id,class_type_id=p_class_type_id,host_user_id=p_host_user_id,title=p_title,starts_at=p_starts_at,ends_at=p_ends_at,capacity=p_capacity,booking_opens_at=p_booking_opens_at,booking_closes_at=p_booking_closes_at,cancellation_closes_at=p_cancellation_closes_at,visibility=p_visibility,status=p_status,recurrence_metadata=p_recurrence_metadata,updated_at=now()
    where id=p_id and organisation_id=p_organisation_id returning * into v_row;
  end if;
  return to_jsonb(v_row);
end; $$;

create or replace function public.club_create_customer(
  p_organisation_id uuid, p_user_id uuid, p_display_name text, p_email text, p_phone text, p_status text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row public.club_customers%rowtype; v_staff boolean;
begin
  v_staff := auth.uid() is not null and public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']);
  if auth.uid() is null or (not v_staff and p_user_id is distinct from auth.uid()) then raise exception 'Customer creation is not permitted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_organisations where id=p_organisation_id and active) then raise exception 'Organisation is unavailable' using errcode='22023'; end if;
  if nullif(btrim(p_display_name),'') is null or p_status not in ('guest','member','customer') or (not v_staff and p_status<>'customer') then raise exception 'Invalid customer input' using errcode='22023'; end if;
  insert into public.club_customers(organisation_id,user_id,display_name,email,phone,status) values(p_organisation_id,p_user_id,btrim(p_display_name),p_email,p_phone,p_status) returning * into v_row;
  return to_jsonb(v_row);
end; $$;

create or replace function public.club_link_customer_user(p_customer_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row public.club_customers%rowtype;
begin
  select * into v_row from public.club_customers where id=p_customer_id for update;
  if not found then raise exception 'Customer not found' using errcode='P0002'; end if;
  if auth.uid() is null or not public.club_has_active_role(v_row.organisation_id,array['gym_admin','owner']) then raise exception 'Customer linking is not permitted' using errcode='42501'; end if;
  if p_user_id is null or v_row.user_id is not null then raise exception 'Customer is already linked or target is invalid' using errcode='22023'; end if;
  update public.club_customers set user_id=p_user_id,updated_at=now() where id=v_row.id returning * into v_row;
  return to_jsonb(v_row);
end; $$;

create or replace function public.club_create_class_booking(p_session_id uuid, p_customer_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_session public.club_class_sessions%rowtype; v_customer public.club_customers%rowtype; v_row public.club_class_bookings%rowtype; v_staff boolean; v_count integer;
begin
  select * into v_session from public.club_class_sessions where id=p_session_id for update;
  if not found then raise exception 'Class session not found' using errcode='P0002'; end if;
  select * into v_customer from public.club_customers where id=p_customer_id and organisation_id=v_session.organisation_id;
  if not found then raise exception 'Customer is not in the session organisation' using errcode='22023'; end if;
  v_staff := public.club_has_active_role(v_session.organisation_id,array['gym_staff','gym_admin','owner']);
  if auth.uid() is null or (v_customer.user_id is distinct from auth.uid() and not v_staff) then raise exception 'Booking creation is not permitted' using errcode='42501'; end if;
  if v_session.status<>'scheduled' then raise exception 'Session is not bookable' using errcode='22023'; end if;
  if p_status not in ('confirmed','waitlisted') then raise exception 'Invalid initial booking status' using errcode='22023'; end if;
  if not v_staff and ((v_session.booking_opens_at is not null and now()<v_session.booking_opens_at) or (v_session.booking_closes_at is not null and now()>=v_session.booking_closes_at)) then raise exception 'Session booking window is closed' using errcode='22023'; end if;
  if not v_staff and v_session.visibility='private' then raise exception 'Session is private' using errcode='42501'; end if;
  if not v_staff and v_session.visibility='members_only' and not public.club_has_active_role(v_session.organisation_id,array['member','trainer','gym_staff','gym_admin','owner']) then raise exception 'Session requires active membership' using errcode='42501'; end if;
  if exists(select 1 from public.club_class_bookings where session_id=p_session_id and customer_id=p_customer_id and status in ('confirmed','waitlisted')) then raise exception 'Active booking already exists' using errcode='23505'; end if;
  if p_status='confirmed' and v_session.capacity is not null then
    select count(*) into v_count from public.club_class_bookings where session_id=p_session_id and status='confirmed';
    if v_count>=v_session.capacity then raise exception 'Session capacity reached' using errcode='22023'; end if;
  end if;
  insert into public.club_class_bookings(organisation_id,session_id,customer_id,status,cancelled_at)
  values(v_session.organisation_id,p_session_id,p_customer_id,p_status,null) returning * into v_row;
  return to_jsonb(v_row);
end; $$;

create or replace function public.club_get_class_availability(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_session public.club_class_sessions%rowtype;
  v_confirmed_count integer;
  v_waitlisted_count integer;
begin
  select * into v_session from public.club_class_sessions where id=p_session_id;
  if not found then raise exception 'Class session not found' using errcode='P0002'; end if;
  if auth.uid() is null or not (
    public.club_has_active_role(v_session.organisation_id,array['gym_staff','gym_admin','owner'])
    or v_session.host_user_id=auth.uid()
    or (v_session.visibility='public' and public.club_has_customer_access(v_session.organisation_id))
    or (v_session.visibility='members_only' and public.club_has_active_role(v_session.organisation_id,array['member','trainer','gym_staff','gym_admin','owner']))
  ) then raise exception 'Class availability is not permitted' using errcode='42501'; end if;
  select
    count(*) filter (where status='confirmed'),
    count(*) filter (where status='waitlisted')
  into v_confirmed_count,v_waitlisted_count
  from public.club_class_bookings where session_id=v_session.id;
  return jsonb_build_object(
    'session_id',v_session.id,
    'capacity',v_session.capacity,
    'confirmed_count',v_confirmed_count,
    'spaces_remaining',case when v_session.capacity is null then null else greatest(v_session.capacity-v_confirmed_count,0) end,
    'waitlisted_count',v_waitlisted_count,
    'is_full',v_session.capacity is not null and v_confirmed_count>=v_session.capacity
  );
end; $$;

create or replace function public.club_cancel_class_booking(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row public.club_class_bookings%rowtype; v_customer public.club_customers%rowtype; v_session public.club_class_sessions%rowtype; v_staff boolean;
begin
  select * into v_row from public.club_class_bookings where id=p_booking_id for update;
  if not found then raise exception 'Booking not found' using errcode='P0002'; end if;
  select * into v_customer from public.club_customers where id=v_row.customer_id;
  select * into v_session from public.club_class_sessions where id=v_row.session_id;
  v_staff := public.club_has_active_role(v_row.organisation_id,array['gym_staff','gym_admin','owner']) or v_session.host_user_id=auth.uid();
  if auth.uid() is null or (v_customer.user_id is distinct from auth.uid() and not v_staff) then raise exception 'Booking cancellation is not permitted' using errcode='42501'; end if;
  if v_row.status='cancelled' then return to_jsonb(v_row); end if;
  if not v_staff and v_session.cancellation_closes_at is not null and now()>=v_session.cancellation_closes_at then raise exception 'Cancellation window is closed' using errcode='22023'; end if;
  update public.club_class_bookings set status='cancelled',cancelled_at=now(),updated_at=now() where id=v_row.id returning * into v_row;
  return to_jsonb(v_row);
end; $$;

create or replace function public.club_set_booking_attendance(p_booking_id uuid, p_attendance_state text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row public.club_class_bookings%rowtype; v_host uuid;
begin
  select * into v_row from public.club_class_bookings where id=p_booking_id for update;
  if not found then raise exception 'Booking not found' using errcode='P0002'; end if;
  select host_user_id into v_host from public.club_class_sessions where id=v_row.session_id;
  if auth.uid() is null or (not public.club_has_active_role(v_row.organisation_id,array['gym_staff','gym_admin','owner']) and v_host is distinct from auth.uid()) then raise exception 'Attendance update is not permitted' using errcode='42501'; end if;
  if v_row.status<>'confirmed' or p_attendance_state not in ('pending','checked_in','attended','no_show') then raise exception 'Invalid attendance update' using errcode='22023'; end if;
  update public.club_class_bookings set attendance_state=p_attendance_state,updated_at=now() where id=v_row.id returning * into v_row;
  return to_jsonb(v_row);
end; $$;

create or replace function public.club_save_service(
  p_id uuid,p_organisation_id uuid,p_location_id uuid,p_name text,p_description text,p_category text,p_duration_minutes integer,p_price_minor integer,p_currency text,p_active boolean
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row public.club_services%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Service administration is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_name),'') is null or nullif(btrim(p_category),'') is null or (p_duration_minutes is not null and p_duration_minutes<=0) or (p_price_minor is not null and p_price_minor<0) or p_currency!~'^[A-Z]{3}$' or p_active is null then raise exception 'Invalid service input' using errcode='22023'; end if;
  if p_id is null then
    insert into public.club_services(organisation_id,location_id,name,description,category,duration_minutes,price_minor,currency,active) values(p_organisation_id,p_location_id,btrim(p_name),p_description,btrim(p_category),p_duration_minutes,p_price_minor,p_currency,p_active) returning * into v_row;
  else
    update public.club_services set location_id=p_location_id,name=btrim(p_name),description=p_description,category=btrim(p_category),duration_minutes=p_duration_minutes,price_minor=p_price_minor,currency=p_currency,active=p_active,updated_at=now() where id=p_id and organisation_id=p_organisation_id returning * into v_row;
    if not found then raise exception 'Service not found' using errcode='P0002'; end if;
  end if;
  return to_jsonb(v_row);
end; $$;

create or replace function public.club_create_service_transaction(
  p_organisation_id uuid,p_location_id uuid,p_service_id uuid,p_customer_id uuid,p_quantity integer,p_unit_price_minor integer,p_currency text,p_payment_status text,p_payment_method text,p_payment_reference text,p_fulfilment_status text,p_external_fulfilment_reference text,p_occurred_at timestamptz,p_metadata jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row public.club_service_transactions%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Service transaction creation is not permitted' using errcode='42501'; end if;
  if p_quantity<=0 or p_unit_price_minor<0 or p_currency!~'^[A-Z]{3}$' or p_payment_status not in ('unpaid','pending','paid','waived','refunded') or p_fulfilment_status not in ('pending','fulfilled','cancelled','failed') or (p_metadata is not null and jsonb_typeof(p_metadata)<>'object') then raise exception 'Invalid service transaction input' using errcode='22023'; end if;
  if not exists(select 1 from public.club_services where id=p_service_id and organisation_id=p_organisation_id and (location_id is null or location_id=p_location_id)) then raise exception 'Service is unavailable at location' using errcode='22023'; end if;
  if p_customer_id is not null and not exists(select 1 from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id) then raise exception 'Customer is not in transaction organisation' using errcode='22023'; end if;
  insert into public.club_service_transactions(organisation_id,location_id,service_id,customer_id,staff_user_id,quantity,unit_price_minor,currency,payment_status,payment_method,payment_reference,fulfilment_status,external_fulfilment_reference,occurred_at,metadata)
  values(p_organisation_id,p_location_id,p_service_id,p_customer_id,auth.uid(),p_quantity,p_unit_price_minor,p_currency,p_payment_status,p_payment_method,p_payment_reference,p_fulfilment_status,p_external_fulfilment_reference,coalesce(p_occurred_at,now()),p_metadata) returning * into v_row;
  return to_jsonb(v_row);
end; $$;

create or replace function public.club_update_service_transaction(
  p_transaction_id uuid,p_payment_status text,p_payment_method text,p_payment_reference text,p_fulfilment_status text,p_external_fulfilment_reference text,p_metadata jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row public.club_service_transactions%rowtype;
begin
  select * into v_row from public.club_service_transactions where id=p_transaction_id for update;
  if not found then raise exception 'Service transaction not found' using errcode='P0002'; end if;
  if auth.uid() is null or not public.club_has_active_role(v_row.organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Service transaction update is not permitted' using errcode='42501'; end if;
  if p_payment_status not in ('unpaid','pending','paid','waived','refunded') or p_fulfilment_status not in ('pending','fulfilled','cancelled','failed') or (p_metadata is not null and jsonb_typeof(p_metadata)<>'object') then raise exception 'Invalid service transaction update' using errcode='22023'; end if;
  update public.club_service_transactions set payment_status=p_payment_status,payment_method=p_payment_method,payment_reference=p_payment_reference,fulfilment_status=p_fulfilment_status,external_fulfilment_reference=p_external_fulfilment_reference,metadata=p_metadata,updated_at=now() where id=v_row.id returning * into v_row;
  return to_jsonb(v_row);
end; $$;

revoke all on function public.club_has_customer_access(uuid) from public;
revoke all on function public.club_is_session_host(uuid) from public;
grant execute on function public.club_has_customer_access(uuid) to authenticated;
grant execute on function public.club_is_session_host(uuid) to authenticated;

revoke all on function public.club_save_class_type(uuid,uuid,text,text,integer,integer,boolean) from public;
revoke all on function public.club_save_class_session(uuid,uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,integer,timestamptz,timestamptz,timestamptz,text,text,jsonb) from public;
revoke all on function public.club_create_customer(uuid,uuid,text,text,text,text) from public;
revoke all on function public.club_link_customer_user(uuid,uuid) from public;
revoke all on function public.club_create_class_booking(uuid,uuid,text) from public;
revoke all on function public.club_get_class_availability(uuid) from public;
revoke all on function public.club_cancel_class_booking(uuid) from public;
revoke all on function public.club_set_booking_attendance(uuid,text) from public;
revoke all on function public.club_save_service(uuid,uuid,uuid,text,text,text,integer,integer,text,boolean) from public;
revoke all on function public.club_create_service_transaction(uuid,uuid,uuid,uuid,integer,integer,text,text,text,text,text,text,timestamptz,jsonb) from public;
revoke all on function public.club_update_service_transaction(uuid,text,text,text,text,text,jsonb) from public;

grant execute on function public.club_save_class_type(uuid,uuid,text,text,integer,integer,boolean) to authenticated;
grant execute on function public.club_save_class_session(uuid,uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,integer,timestamptz,timestamptz,timestamptz,text,text,jsonb) to authenticated;
grant execute on function public.club_create_customer(uuid,uuid,text,text,text,text) to authenticated;
grant execute on function public.club_link_customer_user(uuid,uuid) to authenticated;
grant execute on function public.club_create_class_booking(uuid,uuid,text) to authenticated;
grant execute on function public.club_get_class_availability(uuid) to authenticated;
grant execute on function public.club_cancel_class_booking(uuid) to authenticated;
grant execute on function public.club_set_booking_attendance(uuid,text) to authenticated;
grant execute on function public.club_save_service(uuid,uuid,uuid,text,text,text,integer,integer,text,boolean) to authenticated;
grant execute on function public.club_create_service_transaction(uuid,uuid,uuid,uuid,integer,integer,text,text,text,text,text,text,timestamptz,jsonb) to authenticated;
grant execute on function public.club_update_service_transaction(uuid,text,text,text,text,text,jsonb) to authenticated;

revoke all privileges on table public.club_customers,public.club_class_types,public.club_class_sessions,public.club_class_bookings,public.club_services,public.club_service_transactions from public,anon,authenticated;
grant select on table public.club_customers,public.club_class_types,public.club_class_sessions,public.club_class_bookings,public.club_services,public.club_service_transactions to authenticated;

comment on column public.club_class_bookings.entitlement_usage_id is 'Future link to an atomically consumed class credit; this migration does not consume entitlements.';
comment on column public.club_class_bookings.payment_reference is 'Provider-neutral future payment linkage; payment collection is out of scope.';
comment on column public.club_class_sessions.recurrence_metadata is 'Opaque recurrence provenance/template metadata only; no recurrence engine is implemented.';
