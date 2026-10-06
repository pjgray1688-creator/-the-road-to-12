-- Durable member acquisition, verified-email activation and provider-safe payment handoff.
-- This migration creates no users, imports no members and activates no paid membership.

alter table public.club_customers
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists date_of_birth date,
  add column if not exists address_line_1 text,
  add column if not exists address_line_2 text,
  add column if not exists town_city text,
  add column if not exists postcode text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists privacy_accepted_at timestamptz,
  add column if not exists marketing_consent boolean not null default false,
  add column if not exists marketing_consent_at timestamptz;

alter table public.club_membership_join_requests
  drop constraint if exists club_membership_join_requests_status_check;
alter table public.club_membership_join_requests
  add constraint club_membership_join_requests_status_check check (status in (
    'details_recorded','payment_required','payment_pending','payment_failed','retry_required',
    'staff_review','ready_to_activate','active','completed','cancelled'
  )),
  add column if not exists location_id uuid,
  add column if not exists payment_method text,
  add column if not exists payment_state text not null default 'required',
  add column if not exists payment_provider text,
  add column if not exists payment_provider_reference text,
  add column if not exists payment_failure_reason text,
  add column if not exists membership_id uuid,
  add column if not exists last_activity_at timestamptz not null default now(),
  add column if not exists reminder_eligible_at timestamptz,
  add column if not exists completed_at timestamptz,
  add constraint club_join_location_org_fk foreign key(location_id,organisation_id) references public.club_locations(id,organisation_id),
  add constraint club_join_membership_org_fk foreign key(membership_id,organisation_id) references public.club_memberships(id,organisation_id),
  add constraint club_join_payment_method_check check(payment_method is null or payment_method in ('none','card','direct_debit','staff_manual')),
  add constraint club_join_payment_state_check check(payment_state in ('not_required','required','pending','failed','unavailable','confirmed'));
alter table public.club_membership_join_requests
  add constraint club_join_requests_id_org_key unique(id,organisation_id);

with duplicate_open as (
  select id,row_number() over(partition by organisation_id,user_id order by updated_at desc,created_at desc) position
  from public.club_membership_join_requests where status not in ('completed','cancelled')
)
update public.club_membership_join_requests set status='cancelled',updated_at=now()
where id in (select id from duplicate_open where position>1);
create unique index if not exists club_join_requests_one_open_per_user
  on public.club_membership_join_requests(organisation_id,user_id)
  where status not in ('completed','cancelled');

create table if not exists public.club_member_notification_intents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  join_request_id uuid,
  category text not null check(category in ('member_service','billing')),
  template_key text not null,
  state text not null default 'unavailable' check(state in ('pending','unavailable','sent','failed','cancelled')),
  idempotency_key text not null,
  not_before timestamptz not null default now(),
  provider_reference text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique(organisation_id,idempotency_key),
  foreign key(join_request_id,organisation_id) references public.club_membership_join_requests(id,organisation_id) on delete cascade
);
alter table public.club_member_notification_intents enable row level security;
revoke all on table public.club_member_notification_intents from public,anon,authenticated;

create or replace function public.club_list_join_locations(p_organisation_id uuid)
returns setof jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object('id',l.id,'name',l.name)
  from public.club_locations l join public.club_organisations o on o.id=l.organisation_id
  where l.organisation_id=p_organisation_id and l.active and o.active and o.member_joinable order by l.name;
$$;
revoke all on function public.club_list_join_locations(uuid) from public,anon,authenticated;
grant execute on function public.club_list_join_locations(uuid) to anon,authenticated;
grant execute on function public.club_list_joinable_organisations() to anon,authenticated;
grant execute on function public.club_list_joinable_memberships(uuid) to anon,authenticated;

drop function if exists public.club_start_membership_joining(uuid,uuid,text,text,text,text);
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
  v_status text; v_payment_state text; v_method text;
begin
  if v_user is null then raise exception 'Sign in to start joining' using errcode='42501'; end if;
  select lower(btrim(email)) email,email_confirmed_at,raw_user_meta_data into v_auth from auth.users where id=v_user;
  if v_auth.email_confirmed_at is null then raise exception 'Confirm your email before joining' using errcode='42501'; end if;
  if v_auth.email is distinct from lower(btrim(p_email)) then raise exception 'Joining email must match the signed-in account' using errcode='42501'; end if;
  if nullif(btrim(p_first_name),'') is null or nullif(btrim(p_last_name),'') is null
    or nullif(btrim(p_phone),'') is null or p_date_of_birth is null or p_date_of_birth>=current_date
    or nullif(btrim(p_address_line_1),'') is null or nullif(btrim(p_postcode),'') is null
    or nullif(btrim(p_emergency_name),'') is null or nullif(btrim(p_emergency_phone),'') is null
    or not coalesce(p_terms_accepted,false) or not coalesce(p_privacy_accepted,false)
    or nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'Joining details are incomplete' using errcode='22023';
  end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'Venue is unavailable' using errcode='22023'; end if;
  select p.* into v_product from public.club_products p join public.club_organisations o on o.id=p.organisation_id
    where p.id=p_product_id and p.organisation_id=p_organisation_id and p.kind='membership' and p.sellable and p.archived_at is null and o.active and o.member_joinable;
  if not found then raise exception 'Membership product is unavailable' using errcode='22023'; end if;
  v_method:=case when v_product.price_minor=0 then 'none' else p_payment_method end;
  if v_method not in ('none','card','direct_debit','staff_manual') or (v_product.price_minor>0 and v_method='none') then raise exception 'Choose a payment method' using errcode='22023'; end if;
  select * into v_customer from public.club_customers where organisation_id=p_organisation_id and user_id=v_user for update;
  if not found then
    if exists(select 1 from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_auth.email and user_id is distinct from v_user) then
      raise exception 'An existing member record matches this email; claim it instead' using errcode='23505';
    end if;
    insert into public.club_customers(organisation_id,user_id,display_name,email,phone,status) values(
      p_organisation_id,v_user,btrim(p_first_name)||' '||btrim(p_last_name),v_auth.email,btrim(p_phone),'customer'
    ) returning * into v_customer;
  end if;
  update public.club_customers set display_name=btrim(p_first_name)||' '||btrim(p_last_name),email=v_auth.email,phone=btrim(p_phone),
    first_name=btrim(p_first_name),last_name=btrim(p_last_name),date_of_birth=p_date_of_birth,address_line_1=btrim(p_address_line_1),
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
  v_status:=case when v_product.price_minor=0 then 'ready_to_activate' when v_method='staff_manual' then 'staff_review' else 'payment_required' end;
  v_payment_state:=case when v_product.price_minor=0 then 'not_required' when v_method='staff_manual' then 'pending' else 'unavailable' end;
  if found then
    update public.club_membership_join_requests set customer_id=v_customer.id,product_id=v_product.id,location_id=p_location_id,status=v_status,
      payment_method=v_method,payment_state=v_payment_state,payment_provider=case when v_method='card' then 'stripe' when v_method='direct_debit' then 'gocardless' end,
      payment_failure_reason=null,last_activity_at=now(),reminder_eligible_at=case when v_product.price_minor>0 then now()+interval '24 hours' end,updated_at=now()
      where id=v_request.id returning * into v_request;
  else
    insert into public.club_membership_join_requests(organisation_id,user_id,customer_id,product_id,location_id,status,idempotency_key,payment_method,payment_state,payment_provider,last_activity_at,reminder_eligible_at)
    values(p_organisation_id,v_user,v_customer.id,v_product.id,p_location_id,v_status,btrim(p_idempotency_key),v_method,v_payment_state,
      case when v_method='card' then 'stripe' when v_method='direct_debit' then 'gocardless' end,now(),case when v_product.price_minor>0 then now()+interval '24 hours' end) returning * into v_request;
  end if;
  insert into public.club_member_notification_intents(organisation_id,user_id,join_request_id,category,template_key,state,idempotency_key,not_before)
    values(p_organisation_id,v_user,v_request.id,case when v_product.price_minor>0 then 'billing' else 'member_service' end,'join_incomplete','unavailable','join-reminder:'||v_request.id,coalesce(v_request.reminder_eligible_at,now()+interval '24 hours'))
    on conflict(organisation_id,idempotency_key) do nothing;
  return jsonb_build_object('request',to_jsonb(v_request),'customer',to_jsonb(v_customer),'product',to_jsonb(v_product));
end; $$;
revoke all on function public.club_start_membership_joining(uuid,uuid,uuid,text,text,text,text,date,text,text,text,text,text,text,boolean,boolean,boolean,text,text) from public,anon;
grant execute on function public.club_start_membership_joining(uuid,uuid,uuid,text,text,text,text,date,text,text,text,text,text,text,boolean,boolean,boolean,text,text) to authenticated;

create or replace function public.club_activate_no_payment_join(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; p public.club_products%rowtype; m public.club_memberships%rowtype; v_end timestamptz;
begin
  select * into r from public.club_membership_join_requests where id=p_request_id and user_id=auth.uid() for update;
  if not found or r.status not in ('ready_to_activate','active') or r.payment_state<>'not_required' then raise exception 'Join request is not ready' using errcode='42501'; end if;
  select * into p from public.club_products where id=r.product_id and organisation_id=r.organisation_id and price_minor=0 and sellable and archived_at is null;
  if not found then raise exception 'No-payment membership is unavailable' using errcode='22023'; end if;
  select * into m from public.club_memberships where organisation_id=r.organisation_id and assignment_idempotency_key='join:'||r.id for update;
  if not found then
    v_end:=case when p.duration_days is null then null else now()+make_interval(days=>p.duration_days) end;
    insert into public.club_memberships(organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key)
      values(r.organisation_id,p.id,'active',now(),v_end,'member_join','join:'||r.id) returning * into m;
    insert into public.club_membership_holders(id,membership_id,organisation_id,user_id) values(gen_random_uuid(),m.id,r.organisation_id,auth.uid());
    insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
      select auth.uid(),m.organisation_id,m.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,m.starts_at,m.ends_at,m.source
      from public.club_product_entitlements e where e.product_id=p.id;
  end if;
  update public.club_membership_join_requests set status='active',payment_state='not_required',membership_id=m.id,completed_at=coalesce(completed_at,now()),last_activity_at=now(),updated_at=now() where id=r.id;
  update public.club_member_notification_intents set state='cancelled' where join_request_id=r.id and template_key='join_incomplete';
  return jsonb_build_object('request_id',r.id,'membership_id',m.id,'status','active');
end; $$;
revoke all on function public.club_activate_no_payment_join(uuid) from public,anon;
grant execute on function public.club_activate_no_payment_join(uuid) to authenticated;

create or replace function public.club_get_my_join_state(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select j.*,p.name product_name,p.price_minor,p.currency,p.billing,l.name location_name into r
    from public.club_membership_join_requests j join public.club_products p on p.id=j.product_id left join public.club_locations l on l.id=j.location_id
    where j.organisation_id=p_organisation_id and j.user_id=auth.uid() order by j.updated_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id',r.id,'status',r.status,'payment_state',r.payment_state,'payment_method',r.payment_method,
    'payment_provider',r.payment_provider,'product_name',r.product_name,'price_minor',r.price_minor,'currency',r.currency,
    'billing',r.billing,'location_name',r.location_name,'membership_id',r.membership_id,'updated_at',r.updated_at);
end; $$;
revoke all on function public.club_get_my_join_state(uuid) from public,anon;
grant execute on function public.club_get_my_join_state(uuid) to authenticated;

create or replace function public.club_retry_join_payment(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype;
begin
  select * into r from public.club_membership_join_requests where id=p_request_id and user_id=auth.uid() for update;
  if not found or r.payment_method not in ('card','direct_debit') or r.status not in ('payment_required','payment_failed','retry_required') then raise exception 'Payment retry is unavailable' using errcode='42501'; end if;
  update public.club_membership_join_requests set status='payment_required',payment_state='unavailable',payment_failure_reason=null,last_activity_at=now(),updated_at=now() where id=r.id returning * into r;
  return jsonb_build_object('id',r.id,'status',r.status,'payment_state',r.payment_state,'payment_provider',r.payment_provider);
end; $$;
revoke all on function public.club_retry_join_payment(uuid) from public,anon;
grant execute on function public.club_retry_join_payment(uuid) to authenticated;

create or replace function public.club_preview_existing_member_claim(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_email text; v_verified timestamptz; v_count integer; c public.club_customers%rowtype;
begin
  select lower(btrim(email)),email_confirmed_at into v_email,v_verified from auth.users where id=auth.uid();
  if auth.uid() is null or v_verified is null then return jsonb_build_object('state','email_verification_required'); end if;
  select count(*) into v_count from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_email;
  if v_count=0 then return jsonb_build_object('state','staff_help_required'); end if;
  if v_count>1 then return jsonb_build_object('state','ambiguous','message','More than one member record uses this email'); end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_email;
  if c.user_id=auth.uid() then return jsonb_build_object('state','already_linked'); end if;
  if c.user_id is not null then return jsonb_build_object('state','staff_help_required'); end if;
  return jsonb_build_object('state','ready','customer_id',c.id,'display_name',c.display_name,'email',c.email,
    'memberships',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',p.name,'status',m.status)) from public.club_membership_holders h join public.club_memberships m on m.id=h.membership_id join public.club_products p on p.id=m.product_id where h.customer_id=c.id),'[]'::jsonb));
end; $$;
revoke all on function public.club_preview_existing_member_claim(uuid) from public,anon;
grant execute on function public.club_preview_existing_member_claim(uuid) to authenticated;

create or replace function public.club_claim_existing_member(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_email text; v_verified timestamptz; v_count integer; c public.club_customers%rowtype; h record; e record; actor_role text;
begin
  select lower(btrim(email)),email_confirmed_at into v_email,v_verified from auth.users where id=auth.uid();
  if auth.uid() is null or v_verified is null then raise exception 'Verified account required' using errcode='42501'; end if;
  select count(*) into v_count from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_email;
  if v_count<>1 then raise exception 'Member record is missing or ambiguous' using errcode='42501'; end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id and user_id is null and lower(btrim(email))=v_email for update;
  if not found then raise exception 'Member record does not match this account' using errcode='42501'; end if;
  if exists(select 1 from public.club_customers where organisation_id=p_organisation_id and user_id=auth.uid() and id<>c.id) then raise exception 'Account is already linked to another member' using errcode='23505'; end if;
  insert into public.club_members(organisation_id,user_id,role,active) values(p_organisation_id,auth.uid(),'member',true)
    on conflict(organisation_id,user_id) do update set active=true;
  update public.club_customers set user_id=auth.uid(),updated_at=now() where id=c.id returning * into c;
  for h in select m.*,p.id product_id from public.club_membership_holders holder join public.club_memberships m on m.id=holder.membership_id join public.club_products p on p.id=m.product_id where holder.customer_id=c.id loop
    if exists(select 1 from public.club_membership_holders where membership_id=h.id and user_id=auth.uid()) then delete from public.club_membership_holders where membership_id=h.id and customer_id=c.id; else update public.club_membership_holders set user_id=auth.uid(),customer_id=null where membership_id=h.id and customer_id=c.id; end if;
    insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
      select auth.uid(),h.organisation_id,h.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,h.starts_at,h.ends_at,h.source
      from public.club_product_entitlements e where e.product_id=h.product_id and not exists(select 1 from public.club_entitlement_grants g where g.membership_id=h.id and g.user_id=auth.uid() and g.entitlement_key=e.entitlement_key);
  end loop;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid();
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    values(p_organisation_id,auth.uid(),actor_role,'member.account_self_claimed','customer',c.id,jsonb_build_object('match','verified_email'));
  return jsonb_build_object('customer_id',c.id,'status','linked');
end; $$;
revoke all on function public.club_claim_existing_member(uuid,uuid) from public,anon;
grant execute on function public.club_claim_existing_member(uuid,uuid) to authenticated;

create or replace function public.club_staff_link_member_account(p_organisation_id uuid,p_customer_id uuid,p_target_email text,p_verification_method text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; target_user uuid; actor_role text; h record;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.link_account') then raise exception 'Account linking is not permitted' using errcode='42501'; end if;
  if p_verification_method not in ('photo_id','membership_reference','in_person') or length(btrim(coalesce(p_reason,'')))<8 then raise exception 'Verification evidence and reason are required' using errcode='22023'; end if;
  select id into target_user from auth.users where lower(btrim(email))=lower(btrim(p_target_email)) and email_confirmed_at is not null;
  if target_user is null then raise exception 'No verified R12 account matches that email' using errcode='P0002'; end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id for update;
  if not found or (c.user_id is not null and c.user_id<>target_user) then raise exception 'Member record cannot be linked' using errcode='23505'; end if;
  if exists(select 1 from public.club_customers where organisation_id=p_organisation_id and user_id=target_user and id<>c.id) then raise exception 'R12 account is already linked to another member' using errcode='23505'; end if;
  insert into public.club_members(organisation_id,user_id,role,active) values(p_organisation_id,target_user,'member',true)
    on conflict(organisation_id,user_id) do update set active=true;
  update public.club_customers set user_id=target_user,updated_at=now() where id=c.id;
  for h in select membership_id from public.club_membership_holders where customer_id=c.id loop
    if exists(select 1 from public.club_membership_holders where membership_id=h.membership_id and user_id=target_user) then delete from public.club_membership_holders where membership_id=h.membership_id and customer_id=c.id; else update public.club_membership_holders set user_id=target_user,customer_id=null where membership_id=h.membership_id and customer_id=c.id; end if;
  end loop;
  insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
    select target_user,m.organisation_id,m.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,m.starts_at,m.ends_at,m.source
    from public.club_memberships m join public.club_product_entitlements e on e.product_id=m.product_id join public.club_membership_holders holder on holder.membership_id=m.id and holder.user_id=target_user
    where m.organisation_id=p_organisation_id and not exists(select 1 from public.club_entitlement_grants g where g.membership_id=m.id and g.user_id=target_user and g.entitlement_key=e.entitlement_key);
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid();
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,reason,metadata)
    values(p_organisation_id,auth.uid(),actor_role,'member.account_staff_linked','customer',c.id,btrim(p_reason),jsonb_build_object('target_user_id',target_user,'verification_method',p_verification_method));
  return jsonb_build_object('customer_id',c.id,'user_id',target_user,'status','linked');
end; $$;
revoke all on function public.club_staff_link_member_account(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.club_staff_link_member_account(uuid,uuid,text,text,text) to authenticated;
