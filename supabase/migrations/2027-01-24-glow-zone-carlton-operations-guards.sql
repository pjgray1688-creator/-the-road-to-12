-- Enforce the existing Glow Zone Carlton workflow at the database boundary.
-- No balance, sale, customer, or session records are changed by this migration.

create or replace function public.club_glow_carlton_staff_allowed(p_organisation_id uuid)
returns boolean
language sql stable security definer
set search_path=pg_catalog,public
as $$
  select auth.uid() is not null
    and public.club_capability_allowed(p_organisation_id, auth.uid(), 'services.manage')
    and exists (
      select 1
      from public.club_organisations o
      join public.club_locations l on l.organisation_id=o.id
      where o.id=p_organisation_id and o.slug='madhouse-gym' and o.active
        and l.active and lower(l.name) like '%carlton%'
        and public.club_location_authorized(p_organisation_id,l.id)
    );
$$;
revoke all on function public.club_glow_carlton_staff_allowed(uuid) from public,anon;
grant execute on function public.club_glow_carlton_staff_allowed(uuid) to authenticated;

-- Reception lookup is read-only with respect to minutes. It may expire a stale request,
-- but only authorised Carlton service staff can retrieve customer/session data.
create or replace function public.club_glow_scan_session_request(p_organisation_id uuid,p_token text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_glow_session_requests%rowtype; c public.club_customers%rowtype; age_status text; available integer;
begin
  if not public.club_glow_carlton_staff_allowed(p_organisation_id) then
    raise exception 'Glow Zone reception permission required at Carlton' using errcode='42501';
  end if;
  select * into r from public.club_glow_session_requests
    where organisation_id=p_organisation_id
      and token_hash=extensions.digest(convert_to(upper(btrim(p_token)),'UTF8'),'sha256');
  if not found then raise exception 'Session request not found' using errcode='P0002'; end if;
  if r.status='pending' and r.expires_at<=now() then
    update public.club_glow_session_requests set status='expired',updated_at=now() where id=r.id returning * into r;
  end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and user_id=r.user_id;
  age_status:=public.club_glow_effective_age_status(p_organisation_id,r.user_id);
  select coalesce(sum(l.remaining_quantity) filter(where l.expires_at is null or l.expires_at>now()),0)::integer
    into available from public.club_service_credit_lots l
    where l.organisation_id=p_organisation_id and l.user_id=r.user_id and l.credit_key='sunbed_minutes';
  return public.club_glow_request_json(r)||jsonb_build_object(
    'user_id',r.user_id,'customer_name',coalesce(c.display_name,'Glow Zone customer'),
    'customer_email',c.email,'customer_phone',c.phone,'declared_date_of_birth',c.date_of_birth,
    'balance_minutes',available,'age_status',coalesce(age_status,'required'));
end;
$$;

-- A spend can only be reached through the security-definer confirmation RPC. Requiring
-- a matching pending request also protects against future internal callers bypassing QR.
create or replace function public.club_glow_spend(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_minutes integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v jsonb; u public.club_service_credit_usage%rowtype; l record; take integer; left_qty integer:=p_minutes; alloc jsonb:='[]'::jsonb;
begin
  if not public.club_glow_carlton_staff_allowed(p_organisation_id) or p_minutes<=0
    or not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active and lower(name) like '%carlton%'
      and public.club_location_authorized(p_organisation_id,p_location_id)) then
    raise exception 'Glow Zone usage is not permitted at Carlton' using errcode='42501';
  end if;
  if p_idempotency_key !~ '^glow-session:[0-9a-fA-F-]{36}$'
    or not exists(select 1 from public.club_glow_session_requests r where r.id::text=substr(p_idempotency_key,14)
      and r.organisation_id=p_organisation_id and r.user_id=p_user_id and r.status='pending'
      and r.expires_at>now() and r.duration_minutes=p_minutes) then
    raise exception 'A valid pending Glow Zone session request is required' using errcode='42501';
  end if;
  if exists(select 1 from public.club_service_credit_usage where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key) then
    select to_jsonb(x) into v from public.club_service_credit_usage x where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key;
    return v;
  end if;
  if public.club_glow_effective_age_status(p_organisation_id,p_user_id)<>'verified' then
    raise exception 'Glow Zone age verification required' using errcode='42501';
  end if;
  for l in select * from public.club_service_credit_lots where organisation_id=p_organisation_id and user_id=p_user_id
      and credit_key='sunbed_minutes' and remaining_quantity>0 and (expires_at is null or expires_at>now())
      order by expires_at nulls last,granted_at,id for update loop
    exit when left_qty=0;
    take:=least(left_qty,l.remaining_quantity);
    update public.club_service_credit_lots set remaining_quantity=remaining_quantity-take where id=l.id;
    alloc:=alloc||jsonb_build_array(jsonb_build_object('lot_id',l.id,'quantity',take)); left_qty:=left_qty-take;
  end loop;
  if left_qty>0 then raise exception 'Insufficient Glow Zone minutes' using errcode='22023'; end if;
  insert into public.club_service_credit_usage(organisation_id,user_id,location_id,minutes,actor_user_id,idempotency_key,allocations,qualifying_loyalty)
    values(p_organisation_id,p_user_id,p_location_id,p_minutes,auth.uid(),p_idempotency_key,alloc,p_minutes>=5) returning * into u;
  return to_jsonb(u);
end;
$$;
revoke all on function public.club_glow_spend(uuid,uuid,uuid,integer,text) from public,anon,authenticated;

-- Preserve the established catalogue prices and atomic sale-to-credit-lot behaviour.
create or replace function public.club_glow_complete_sale(
  p_organisation_id uuid,p_location_id uuid,p_user_id uuid,p_package_id text,
  p_minutes integer,p_tender_type text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_glow_sales%rowtype; price integer;
begin
  if not public.club_glow_carlton_staff_allowed(p_organisation_id)
    or not public.club_location_authorized(p_organisation_id,p_location_id)
    or not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active and lower(name) like '%carlton%') then
    raise exception 'Glow Zone sale is not permitted at Carlton' using errcode='42501';
  end if;
  if (p_tender_type='cash' and not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.record_cash'))
    or (p_tender_type='external_card' and not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take'))
    or p_tender_type not in ('cash','external_card') then
    raise exception 'Tender is not authorised' using errcode='42501';
  end if;
  if nullif(btrim(p_idempotency_key),'') is null then raise exception 'A sale reference is required' using errcode='22023'; end if;
  select * into s from public.club_glow_sales where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key;
  if found then
    if s.location_id<>p_location_id or s.user_id<>p_user_id or s.package_id<>p_package_id or s.minutes<>p_minutes or s.tender_type<>p_tender_type or s.actor_user_id<>auth.uid() then
      raise exception 'Sale reference has already been used' using errcode='23505';
    end if;
    return to_jsonb(s);
  end if;
  if p_package_id in ('member-30','member-60','member-100') then
    if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active and role='member') then
      raise exception 'Member package requires active membership' using errcode='42501';
    end if;
    price:=case p_package_id when 'member-30' then 1000 when 'member-60' then 1800 else 3000 end;
  elsif p_package_id in ('standard-30','standard-60','standard-100') then
    price:=case p_package_id when 'standard-30' then 1500 when 'standard-60' then 2500 else 4000 end;
  elsif p_package_id='payg' then price:=p_minutes*100;
  else raise exception 'Unknown Glow Zone package' using errcode='22023'; end if;
  if p_minutes<=0 or (p_package_id<>'payg' and p_minutes<>case when p_package_id like '%-30' then 30 when p_package_id like '%-60' then 60 else 100 end) then
    raise exception 'Invalid Glow Zone quantity' using errcode='22023';
  end if;
  insert into public.club_glow_sales(organisation_id,location_id,user_id,package_id,minutes,amount_minor,tender_type,actor_user_id,idempotency_key)
    values(p_organisation_id,p_location_id,p_user_id,p_package_id,p_minutes,price,p_tender_type,auth.uid(),p_idempotency_key) returning * into s;
  insert into public.club_service_credit_lots(organisation_id,user_id,credit_key,unit,original_quantity,remaining_quantity,expires_at,source_type,source_reference,location_id,actor_user_id,idempotency_key)
    values(p_organisation_id,p_user_id,'sunbed_minutes','minute',p_minutes,p_minutes,now()+interval '3 months','purchased',s.id::text,p_location_id,auth.uid(),'sale:'||s.id::text)
    on conflict(organisation_id,idempotency_key) do nothing;
  return to_jsonb(s);
end;
$$;

create or replace function public.club_glow_grant_manual(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_minutes integer,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_lot public.club_service_credit_lots%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner'])
    or not public.club_capability_allowed(p_organisation_id,auth.uid(),'services.manage')
    or not public.club_glow_carlton_staff_allowed(p_organisation_id)
    or not public.club_location_authorized(p_organisation_id,p_location_id)
    or not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active and lower(name) like '%carlton%')
    or p_minutes<=0 or nullif(btrim(p_reason),'') is null or nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'Glow Zone balance adjustment is not permitted' using errcode='42501';
  end if;
  select * into v_lot from public.club_service_credit_lots where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key;
  if found then
    if v_lot.user_id<>p_user_id or v_lot.location_id<>p_location_id or v_lot.original_quantity<>p_minutes or v_lot.source_reference<>btrim(p_reason) or v_lot.actor_user_id<>auth.uid() then
      raise exception 'Adjustment reference has already been used' using errcode='23505';
    end if;
    return to_jsonb(v_lot);
  end if;
  insert into public.club_service_credit_lots(organisation_id,user_id,credit_key,unit,original_quantity,remaining_quantity,expires_at,source_type,source_reference,location_id,actor_user_id,idempotency_key)
    values(p_organisation_id,p_user_id,'sunbed_minutes','minute',p_minutes,p_minutes,now()+interval '3 months','manual_adjustment',btrim(p_reason),p_location_id,auth.uid(),p_idempotency_key)
    returning * into v_lot;
  return to_jsonb(v_lot);
end;
$$;

create or replace function public.club_glow_adjust_remove(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_minutes integer,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_glow_adjustments%rowtype; l record; take integer; left_qty integer:=p_minutes; alloc jsonb:='[]'::jsonb;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner'])
    or not public.club_capability_allowed(p_organisation_id,auth.uid(),'services.manage')
    or not public.club_glow_carlton_staff_allowed(p_organisation_id)
    or not public.club_location_authorized(p_organisation_id,p_location_id)
    or not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active and lower(name) like '%carlton%')
    or p_minutes<=0 or nullif(btrim(p_reason),'') is null or nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'Glow Zone balance removal is not permitted' using errcode='42501';
  end if;
  select * into a from public.club_glow_adjustments where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key;
  if found then
    if a.user_id<>p_user_id or a.location_id<>p_location_id or a.minutes<>p_minutes or a.reason<>btrim(p_reason) or a.actor_user_id<>auth.uid() then
      raise exception 'Adjustment reference has already been used' using errcode='23505';
    end if;
    return to_jsonb(a);
  end if;
  for l in select * from public.club_service_credit_lots where organisation_id=p_organisation_id and user_id=p_user_id and credit_key='sunbed_minutes'
      and remaining_quantity>0 and (expires_at is null or expires_at>now()) order by expires_at nulls last,granted_at,id for update loop
    exit when left_qty=0;
    take:=least(left_qty,l.remaining_quantity);
    update public.club_service_credit_lots set remaining_quantity=remaining_quantity-take where id=l.id;
    alloc:=alloc||jsonb_build_array(jsonb_build_object('lot_id',l.id,'quantity',take)); left_qty:=left_qty-take;
  end loop;
  if left_qty>0 then raise exception 'Insufficient Glow Zone minutes' using errcode='22023'; end if;
  insert into public.club_glow_adjustments(organisation_id,user_id,location_id,minutes,direction,reason,actor_user_id,allocations,idempotency_key)
    values(p_organisation_id,p_user_id,p_location_id,p_minutes,'remove',btrim(p_reason),auth.uid(),alloc,p_idempotency_key) returning * into a;
  return to_jsonb(a);
end;
$$;

create or replace function public.club_glow_record_age_verification(p_organisation_id uuid,p_user_id uuid,p_date_of_birth date,p_method text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_glow_age_verifications%rowtype; v_declared date;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'induction.perform')
    or not public.club_glow_carlton_staff_allowed(p_organisation_id) then
    raise exception 'Age verification is not permitted at Carlton' using errcode='42501';
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
      verified_at=excluded.verified_at,verified_by=excluded.verified_by,verification_method=excluded.verification_method returning * into r;
  return to_jsonb(r);
end;
$$;

-- Read RPCs honour the customer's self-view and otherwise require Carlton service access.
create or replace function public.club_glow_balance(p_organisation_id uuid,p_user_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
  select case when auth.uid()=p_user_id or public.club_glow_carlton_staff_allowed(p_organisation_id)
    then jsonb_build_object('minutes',coalesce(sum(remaining_quantity) filter(where expires_at is null or expires_at>now()),0),
      'next_expiry',min(expires_at) filter(where remaining_quantity>0 and expires_at>now()))
    else jsonb_build_object('minutes',0,'next_expiry',null) end
  from public.club_service_credit_lots where organisation_id=p_organisation_id and user_id=p_user_id and credit_key='sunbed_minutes';
$$;
create or replace function public.club_glow_age_status(p_organisation_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; a public.club_glow_age_verifications%rowtype; v_status text;
begin
  if auth.uid() is null or not public.club_glow_carlton_staff_allowed(p_organisation_id) then raise exception 'Glow Zone age status is not permitted' using errcode='42501'; end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and user_id=p_user_id;
  if not found then return null; end if;
  select * into a from public.club_glow_age_verifications where organisation_id=p_organisation_id and user_id=p_user_id;
  v_status:=public.club_glow_effective_age_status(p_organisation_id,p_user_id);
  return jsonb_build_object('date_of_birth',coalesce(c.date_of_birth,a.date_of_birth),'declared_date_of_birth',c.date_of_birth,'status',v_status,
    'first_name',c.first_name,'last_name',c.last_name,'email',c.email,'phone',c.phone,
    'verified_at',case when v_status='verified' then a.verified_at end,
    'verification_method',case when v_status='verified' then a.verification_method end);
end;
$$;
create or replace function public.club_glow_history(p_organisation_id uuid,p_user_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(x order by created_at desc),'[]'::jsonb) from (
    select jsonb_build_object('kind','credit','minutes',original_quantity,'remaining',remaining_quantity,'source',source_type,'reason',source_reference,'expires_at',expires_at,'location_id',location_id,'created_at',created_at) x,created_at from public.club_service_credit_lots where organisation_id=p_organisation_id and user_id=p_user_id and credit_key='sunbed_minutes'
    union all select jsonb_build_object('kind','usage','minutes',-minutes,'source','usage','created_at',created_at,'location_id',location_id,'qualifying_loyalty',qualifying_loyalty),created_at from public.club_service_credit_usage where organisation_id=p_organisation_id and user_id=p_user_id and location_id in (select id from public.club_locations where organisation_id=p_organisation_id and lower(name) like '%carlton%')
    union all select jsonb_build_object('kind','adjustment','minutes',case when direction='add' then minutes else -minutes end,'source','manual_adjustment','reason',reason,'created_at',created_at,'location_id',location_id),created_at from public.club_glow_adjustments where organisation_id=p_organisation_id and user_id=p_user_id
  ) x where auth.uid()=p_user_id or public.club_glow_carlton_staff_allowed(p_organisation_id);
$$;
create or replace function public.club_glow_loyalty(p_organisation_id uuid,p_user_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object('qualifying_sessions',coalesce(sum(case when qualifying_loyalty then 1 else 0 end),0),
    'threshold',9,'reward_earned',coalesce(sum(case when qualifying_loyalty then 1 else 0 end),0)>=9)
  from public.club_service_credit_usage where organisation_id=p_organisation_id and user_id=p_user_id
    and (auth.uid()=p_user_id or public.club_glow_carlton_staff_allowed(p_organisation_id));
$$;

-- Tighten direct table reads for Glow-specific private records while preserving customer self-access.
drop policy if exists glow_sales_self_staff on public.club_glow_sales;
create policy glow_sales_self_staff on public.club_glow_sales for select to authenticated
  using(user_id=auth.uid() or public.club_glow_carlton_staff_allowed(organisation_id));
drop policy if exists glow_sales_finance_read on public.club_glow_sales;
create policy glow_sales_finance_read on public.club_glow_sales for select to authenticated
  using(public.club_capability_allowed(organisation_id,auth.uid(),'finance.view'));
drop policy if exists glow_age_self_staff on public.club_glow_age_verifications;
create policy glow_age_self_staff on public.club_glow_age_verifications for select to authenticated
  using(user_id=auth.uid() or public.club_glow_carlton_staff_allowed(organisation_id));
drop policy if exists glow_adjustments_self_staff on public.club_glow_adjustments;
create policy glow_adjustments_self_staff on public.club_glow_adjustments for select to authenticated
  using(user_id=auth.uid() or public.club_glow_carlton_staff_allowed(organisation_id));

revoke all on function public.club_glow_scan_session_request(uuid,text),public.club_glow_complete_sale(uuid,uuid,uuid,text,integer,text,text),
  public.club_glow_grant_manual(uuid,uuid,uuid,integer,text,text),public.club_glow_adjust_remove(uuid,uuid,uuid,integer,text,text),
  public.club_glow_record_age_verification(uuid,uuid,date,text),public.club_glow_balance(uuid,uuid),
  public.club_glow_age_status(uuid,uuid),public.club_glow_history(uuid,uuid),public.club_glow_loyalty(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_glow_scan_session_request(uuid,text),public.club_glow_complete_sale(uuid,uuid,uuid,text,integer,text,text),
  public.club_glow_grant_manual(uuid,uuid,uuid,integer,text,text),public.club_glow_adjust_remove(uuid,uuid,uuid,integer,text,text),
  public.club_glow_record_age_verification(uuid,uuid,date,text),public.club_glow_balance(uuid,uuid),
  public.club_glow_age_status(uuid,uuid),public.club_glow_history(uuid,uuid),public.club_glow_loyalty(uuid,uuid) to authenticated;

comment on function public.club_glow_spend(uuid,uuid,uuid,integer,text) is
  'Internal atomic Glow Zone spend. Authenticated clients must use club_glow_confirm_session_request.';
