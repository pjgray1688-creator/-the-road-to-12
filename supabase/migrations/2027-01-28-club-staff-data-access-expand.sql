-- EXPAND phase: install secure projections and supporting schema/RPCs while retaining
-- existing direct table grants and legacy RPC access for the old application.
-- Apply before the application release. CONTRACT runs only after all old instances drain.
begin;

-- Check the earliest prerequisite before any DDL so an out-of-order deploy
-- fails with a clear message and rolls back without partial changes.
do $$
begin
  if to_regclass('public.club_customers') is null then
    raise exception 'Required table public.club_customers is missing; no security changes were applied';
  end if;
  if to_regclass('public.club_glow_age_verifications') is null then
    raise exception 'Required table public.club_glow_age_verifications is missing; no security changes were applied';
  end if;
end $$;

-- Emergency contacts are operational safety data used by authorised staff.
-- Add nullable fields only where the acquisition workflow has not added them;
-- no existing customer rows are populated or rewritten by this statement.
alter table public.club_customers
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text;

do $$
declare t text; c text;
begin
  foreach t in array array['club_customers','club_members','club_orders','club_order_items','club_payments','club_refunds'] loop
    if to_regclass('public.'||t) is null then raise exception 'Required Club table public.% is missing',t; end if;
    if not exists(select 1 from pg_class r join pg_namespace n on n.oid=r.relnamespace where n.nspname='public' and r.relname=t and r.relrowsecurity) then
      raise exception 'RLS must be enabled on public.% before column grants can be narrowed',t;
    end if;
  end loop;
  foreach c in array array['id','organisation_id','user_id','display_name','email','phone','status','created_at','updated_at','address_line_1','address_line_2','town_city','postcode','date_of_birth','emergency_contact_name','emergency_contact_phone','first_name','last_name'] loop
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_customers' and column_name=c) then
      raise exception 'Required customer column public.club_customers.% is missing',c;
    end if;
  end loop;
  if to_regprocedure('public.club_capability_allowed(uuid,uuid,text)') is null
     or to_regprocedure('public.club_glow_carlton_staff_allowed(uuid)') is null
     or to_regprocedure('public.club_location_authorized(uuid,uuid)') is null
     or to_regprocedure('public.club_has_active_role(uuid,text[])') is null
     or to_regprocedure('public.club_glow_record_age_verification(uuid,uuid,date,text)') is null
     or to_regprocedure('public.club_issue_staff_refund(uuid,integer,text,text,text)') is null
     or to_regprocedure('public.club_issue_staff_line_refund(uuid,jsonb,text,text,text)') is null
     or to_regprocedure('public.club_get_member_contact(uuid,uuid)') is null
     or to_regprocedure('public.club_update_member_contact(uuid,uuid,text,text,text,text,text)') is null
     or to_regprocedure('public.club_glow_complete_customer_details(uuid,text,text,text,date)') is null
     or to_regprocedure('public.club_finalize_paid_order(uuid,uuid)') is null
     or to_regprocedure('public.club_glow_request_json(public.club_glow_session_requests)') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null
     or to_regclass('auth.users') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception 'Required authorization or workflow RPC is missing; no permissions have been changed';
  end if;
  foreach t in array array['club_audit_events','club_locations','club_organisations','club_location_service_hours','club_glow_session_requests','club_service_credit_lots','club_membership_billing_obligations','club_membership_billing_arrangements','club_membership_join_requests','club_membership_holders','club_madhouse_apparel_order_details','club_madhouse_apparel_order_activity','profiles'] loop
    if to_regclass('public.'||t) is null then raise exception 'Required workflow table public.% is missing; no security changes were applied',t; end if;
  end loop;
  if exists (
    select 1 from (values ('id'),('email'),('email_confirmed_at'),('raw_user_meta_data')) required(column_name)
    where not exists(select 1 from information_schema.columns c where c.table_schema='auth' and c.table_name='users' and c.column_name=required.column_name)
  ) then
    raise exception 'Required auth.users identity columns are missing; no application functions have been installed';
  end if;
  if exists (
    select 1 from (values
      ('club_audit_events','organisation_id'),('club_audit_events','actor_user_id'),('club_audit_events','actor_role'),('club_audit_events','action'),('club_audit_events','target_type'),('club_audit_events','target_id'),('club_audit_events','metadata'),
      ('club_members','organisation_id'),('club_members','user_id'),('club_members','active'),('club_members','role'),('club_members','preferred_location_id'),
      ('club_organisations','id'),('club_organisations','active'),
      ('club_locations','id'),('club_locations','organisation_id'),('club_locations','active'),
      ('club_location_service_hours','organisation_id'),('club_location_service_hours','service_key'),
      ('club_glow_session_requests','id'),('club_glow_session_requests','organisation_id'),('club_glow_session_requests','user_id'),('club_glow_session_requests','bed_type'),('club_glow_session_requests','duration_minutes'),('club_glow_session_requests','token_hash'),('club_glow_session_requests','token_suffix'),('club_glow_session_requests','status'),('club_glow_session_requests','expires_at'),('club_glow_session_requests','created_at'),('club_glow_session_requests','redeemed_at'),('club_glow_session_requests','updated_at'),
      ('club_service_credit_lots','organisation_id'),('club_service_credit_lots','user_id'),('club_service_credit_lots','credit_key'),('club_service_credit_lots','remaining_quantity'),('club_service_credit_lots','expires_at'),
      ('club_membership_holders','membership_id'),('club_membership_holders','organisation_id'),('club_membership_holders','user_id'),('club_membership_holders','customer_id'),
      ('club_membership_billing_obligations','id'),('club_membership_billing_obligations','organisation_id'),('club_membership_billing_obligations','arrangement_id'),('club_membership_billing_obligations','membership_id'),('club_membership_billing_obligations','customer_id'),('club_membership_billing_obligations','user_id'),('club_membership_billing_obligations','amount_minor'),('club_membership_billing_obligations','currency'),('club_membership_billing_obligations','next_due_at'),('club_membership_billing_obligations','state'),('club_membership_billing_obligations','payment_method_family'),('club_membership_billing_obligations','failure_reason'),('club_membership_billing_obligations','provider_status'),('club_membership_billing_obligations','provider_charge_date'),
      ('club_membership_billing_arrangements','id'),('club_membership_billing_arrangements','organisation_id'),('club_membership_billing_arrangements','membership_id'),('club_membership_billing_arrangements','provider_type'),('club_membership_billing_arrangements','provider_authority_state'),('club_membership_billing_arrangements','collection_status'),('club_membership_billing_arrangements','action_required_reason'),('club_membership_billing_arrangements','coverage_paid_through_at'),
      ('club_membership_join_requests','organisation_id'),('club_membership_join_requests','membership_id'),('club_membership_join_requests','stripe_merchant_entity'),('club_membership_join_requests','updated_at'),
      ('profiles','id'),('profiles','email'),('profiles','display_name'),('profiles','first_name'),('profiles','last_name'),
      ('club_madhouse_apparel_order_details','order_id'),('club_madhouse_apparel_order_details','organisation_id'),
      ('club_madhouse_apparel_order_activity','id'),('club_madhouse_apparel_order_activity','order_id'),('club_madhouse_apparel_order_activity','organisation_id'),
      ('club_madhouse_apparel_order_activity','activity_type'),('club_madhouse_apparel_order_activity','from_status'),('club_madhouse_apparel_order_activity','to_status'),('club_madhouse_apparel_order_activity','details'),('club_madhouse_apparel_order_activity','created_at'),
      ('club_orders','id'),('club_orders','organisation_id'),('club_orders','location_id'),('club_orders','customer_id'),('club_orders','user_id'),('club_orders','channel'),('club_orders','status'),('club_orders','currency'),('club_orders','subtotal_minor'),('club_orders','discount_minor'),('club_orders','total_minor'),('club_orders','created_at'),('club_orders','updated_at'),
      ('club_order_items','id'),('club_order_items','order_id'),('club_order_items','organisation_id'),('club_order_items','product_id'),('club_order_items','product_name'),('club_order_items','quantity'),('club_order_items','unit_price_minor'),('club_order_items','line_total_minor'),('club_order_items','stock_tracked'),('club_order_items','created_at'),
      ('club_payments','id'),('club_payments','order_id'),('club_payments','organisation_id'),('club_payments','method'),('club_payments','amount_minor'),('club_payments','currency'),('club_payments','status'),('club_payments','created_at'),('club_payments','updated_at'),('club_payments','stripe_merchant_entity'),('club_payments','external_reference'),
      ('club_refunds','id'),('club_refunds','payment_id'),('club_refunds','order_id'),('club_refunds','organisation_id'),('club_refunds','amount_minor'),('club_refunds','reason'),('club_refunds','created_at')
    ) required(table_name,column_name)
    where not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=required.table_name and c.column_name=required.column_name)
  ) then
    raise exception 'Required audit or membership-billing column is missing; no security changes were applied';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_customers' and column_name='preferred_location_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='preferred_location_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_payments' and column_name='stripe_merchant_entity') then
    raise exception 'Required home-location or payment reporting column is missing';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_glow_age_verifications' and column_name in ('organisation_id','user_id','date_of_birth','status','verified_by','verified_at','verification_method') group by table_name having count(*)=7) then
    raise exception 'Glow age-verification schema is incomplete';
  end if;
end $$;

-- Home-address access remains a separate, owner/permissions-manager action.
create or replace function public.club_get_member_contact_secure(p_organisation_id uuid,p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; can_see_address boolean;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.create') then
    raise exception 'Member contact access is not permitted' using errcode='42501';
  end if;
  if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active) then
    raise exception 'Member is not active in this organisation' using errcode='P0002';
  end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and user_id=p_user_id;
  if not found then raise exception 'Linked member customer record was not found' using errcode='P0002'; end if;
  can_see_address:=public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage');
  return jsonb_build_object('phone',c.phone) || case when can_see_address then jsonb_build_object('address_line_1',c.address_line_1,'address_line_2',c.address_line_2,'town_city',c.town_city,'postcode',c.postcode) else '{}'::jsonb end;
end; $$;

create or replace function public.club_update_member_contact_secure(
  p_organisation_id uuid,p_user_id uuid,p_phone text,p_address_line_1 text,
  p_address_line_2 text,p_town_city text,p_postcode text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; can_edit_address boolean;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.create') then
    raise exception 'Member contact editing is not permitted' using errcode='42501';
  end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and user_id=p_user_id for update;
  if not found or not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active) then
    raise exception 'Linked member customer record was not found' using errcode='P0002';
  end if;
  can_edit_address:=public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage');
  return public.club_update_member_contact(p_organisation_id,p_user_id,p_phone,
    case when can_edit_address then p_address_line_1 else c.address_line_1 end,
    case when can_edit_address then p_address_line_2 else c.address_line_2 end,
    case when can_edit_address then p_town_city else c.town_city end,
    case when can_edit_address then p_postcode else c.postcode end);
end; $$;
revoke all on function public.club_get_member_contact_secure(uuid,uuid) from public,anon,authenticated;
revoke all on function public.club_update_member_contact_secure(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.club_get_member_contact_secure(uuid,uuid),public.club_update_member_contact_secure(uuid,uuid,text,text,text,text,text) to authenticated;

-- Emergency contacts are returned only for a specific customer and purpose,
-- not in organisation-wide customer search payloads.
create or replace function public.club_get_member_emergency_contact(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; actor_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.view')
    or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner','trainer']) then
    raise exception 'Emergency contact access is not permitted' using errcode='42501';
  end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id;
  if not found then raise exception 'Customer is not in this organisation' using errcode='P0002'; end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    values(p_organisation_id,auth.uid(),actor_role,'member.emergency_contact_viewed','customer',c.id,jsonb_build_object('purpose','member_safety'));
  return jsonb_build_object('name',c.emergency_contact_name,'phone',c.emergency_contact_phone);
end; $$;
revoke all on function public.club_get_member_emergency_contact(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_get_member_emergency_contact(uuid,uuid) to authenticated;

-- Finance-only projection. It deliberately excludes provider references,
-- account IDs and raw metadata while retaining the existing report fields.
create or replace function public.club_list_finance_reconciliation(p_organisation_id uuid,p_from timestamptz,p_to timestamptz,p_location_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.view') then
    raise exception 'Finance access is not permitted' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_from>p_to or p_to-p_from>interval '367 days' then
    raise exception 'Finance date range is invalid' using errcode='22023';
  end if;
  if p_location_id is not null and not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id) then
    raise exception 'Location is outside this organisation' using errcode='42501';
  end if;
  return jsonb_build_object(
    'orders',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'created_at',o.created_at,'location_id',o.location_id,'status',o.status,'subtotal_minor',o.subtotal_minor,'discount_minor',o.discount_minor,'total_minor',o.total_minor,'currency',o.currency,'channel',o.channel,
      'club_order_items',(select coalesce(jsonb_agg(jsonb_build_object('product_name',i.product_name,'quantity',i.quantity) order by i.created_at),'[]'::jsonb) from public.club_order_items i where i.order_id=o.id and i.organisation_id=o.organisation_id)) order by o.created_at desc),'[]'::jsonb)
      from public.club_orders o where o.organisation_id=p_organisation_id and o.created_at between p_from and p_to and (p_location_id is null or o.location_id=p_location_id)),
    'payments',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'order_id',p.order_id,'created_at',p.created_at,'method',p.method,'amount_minor',p.amount_minor,'status',p.status,'stripe_merchant_entity',p.stripe_merchant_entity) order by p.created_at),'[]'::jsonb)
      from public.club_payments p join public.club_orders o on o.id=p.order_id and o.organisation_id=p.organisation_id where p.organisation_id=p_organisation_id and p.created_at between p_from and p_to and (p_location_id is null or o.location_id=p_location_id)),
    'refunds',(select coalesce(jsonb_agg(jsonb_build_object('amount_minor',r.amount_minor,'order_id',r.order_id,'created_at',r.created_at) order by r.created_at),'[]'::jsonb)
      from public.club_refunds r join public.club_orders o on o.id=r.order_id and o.organisation_id=r.organisation_id where r.organisation_id=p_organisation_id and r.created_at between p_from and p_to and (p_location_id is null or o.location_id=p_location_id)));
end; $$;
revoke all on function public.club_list_finance_reconciliation(uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.club_list_finance_reconciliation(uuid,timestamptz,timestamptz,uuid) to authenticated;

-- Refund status remains visible through the safe table projection, but the
-- mutation RPC is callable only through an explicit management approval gate.
create or replace function public.club_approve_staff_refund(p_payment_id uuid,p_amount_minor integer,p_reason text,p_external_reference text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare _org uuid; result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select organisation_id into _org from public.club_payments where id=p_payment_id;
  if _org is null then raise exception 'Payment not found' using errcode='P0002'; end if;
  if not public.club_capability_allowed(_org,auth.uid(),'refunds.approve') then raise exception 'Refund approval permission required' using errcode='42501'; end if;
  result:=public.club_issue_staff_refund(p_payment_id,p_amount_minor,p_reason,p_external_reference,p_idempotency_key);
  return result-'external_reference'-'created_by'-'idempotency_key';
end; $$;

create or replace function public.club_approve_staff_line_refund(p_payment_id uuid,p_allocations jsonb,p_reason text,p_external_reference text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare _org uuid; result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select organisation_id into _org from public.club_payments where id=p_payment_id;
  if _org is null or not public.club_capability_allowed(_org,auth.uid(),'refunds.approve') then raise exception 'Refund approval permission required' using errcode='42501'; end if;
  result:=public.club_issue_staff_line_refund(p_payment_id,p_allocations,p_reason,p_external_reference,p_idempotency_key);
  return result-'external_reference'-'created_by'-'idempotency_key';
end; $$;
revoke all on function public.club_approve_staff_refund(uuid,integer,text,text,text) from public,anon,authenticated;
revoke all on function public.club_approve_staff_line_refund(uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.club_approve_staff_refund(uuid,integer,text,text,text),public.club_approve_staff_line_refund(uuid,jsonb,text,text,text) to authenticated;

-- Avoid returning provider references/account identifiers through the cash
-- settlement RPC. The caller only consumes the safe payment status projection.
create or replace function public.club_record_cash_payment_secure(p_order_id uuid,p_amount_minor integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_orders%rowtype; p public.club_payments%rowtype; existing public.club_payments%rowtype;
begin
  select * into o from public.club_orders where id=p_order_id for update;
  if not found then raise exception 'Order not found' using errcode='P0002'; end if;
  if auth.uid() is null or not public.club_has_active_role(o.organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Cash settlement is not permitted' using errcode='42501'; end if;
  if o.status in ('awaiting_cash_verification','cash_disputed') then raise exception 'Order requires cash declaration resolution' using errcode='22023'; end if;
  if p_amount_minor<>o.total_minor or p_amount_minor<0 or o.status<>'pending_payment' then raise exception 'Order is not eligible for cash settlement' using errcode='22023'; end if;
  select * into existing from public.club_payments where organisation_id=o.organisation_id and external_reference=p_idempotency_key and order_id=o.id;
  if found then return jsonb_build_object('id',existing.id,'order_id',existing.order_id,'organisation_id',existing.organisation_id,'method',existing.method,'amount_minor',existing.amount_minor,'currency',existing.currency,'status',existing.status,'created_at',existing.created_at,'updated_at',existing.updated_at); end if;
  insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status) values(o.id,o.organisation_id,'cash',p_idempotency_key,p_amount_minor,o.currency,'paid') returning * into p;
  update public.club_orders set status='paid',updated_at=now() where id=o.id;
  perform public.club_finalize_paid_order(o.id,auth.uid());
  return jsonb_build_object('id',p.id,'order_id',p.order_id,'organisation_id',p.organisation_id,'method',p.method,'amount_minor',p.amount_minor,'currency',p.currency,'status',p.status,'created_at',p.created_at,'updated_at',p.updated_at);
end; $$;
revoke all on function public.club_record_cash_payment_secure(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.club_record_cash_payment_secure(uuid,integer,text) to authenticated;

-- The published Madhouse order manager does not need Stripe account IDs or raw
-- provider references. Keep its existing authorised order/detail payload.
create or replace function public.club_list_madhouse_apparel_orders_secure(p_organisation_id uuid)
returns setof jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or p_organisation_id<>'fa44592a-1593-4ad3-a621-63a4a4bcbceb'
    or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then
    raise exception 'Apparel order access is not permitted' using errcode='42501';
  end if;
  return query select jsonb_build_object('order',jsonb_build_object(
      'id',o.id,'created_at',o.created_at,'status',o.status,'subtotal_minor',o.subtotal_minor,
      'discount_minor',o.discount_minor,'total_minor',o.total_minor,'currency',o.currency),
    'details',jsonb_build_object('order_id',d.order_id,'order_number',d.order_number,
      'customer_first_name',d.customer_first_name,'customer_surname',d.customer_surname,
      'customer_email',d.customer_email,'customer_phone',d.customer_phone,
      'delivery_address',d.delivery_address,'billing_address',d.billing_address,
      'billing_same_as_delivery',d.billing_same_as_delivery,'delivery_minor',d.delivery_minor,
      'courier',d.courier,'tracking_number',d.tracking_number,'tracking_url',d.tracking_url,
      'fulfilment_status',d.fulfilment_status),
    'items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'product_name',i.product_name,
      'variant_colour',i.variant_colour,'variant_size',i.variant_size,'quantity',i.quantity,
      'unit_price_minor',i.unit_price_minor,'line_total_minor',i.line_total_minor,
      'discount_minor',i.discount_minor) order by i.id),'[]'::jsonb)
      from public.club_order_items i where i.order_id=o.id and i.organisation_id=o.organisation_id),
    'payments',(select coalesce(jsonb_agg(jsonb_build_object('method',p.method,'status',p.status,'amount_minor',p.amount_minor,'stripe_merchant_entity',p.stripe_merchant_entity) order by p.created_at),'[]'::jsonb) from public.club_payments p where p.order_id=o.id and p.organisation_id=o.organisation_id),
    'activity',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'activity_type',a.activity_type,'from_status',a.from_status,'to_status',a.to_status,'created_at',a.created_at) order by a.created_at),'[]'::jsonb) from public.club_madhouse_apparel_order_activity a where a.order_id=o.id and a.organisation_id=o.organisation_id))
    from public.club_madhouse_apparel_order_details d join public.club_orders o on o.id=d.order_id and o.organisation_id=d.organisation_id
    where d.organisation_id=p_organisation_id and o.status<>'pending_payment' order by o.created_at desc;
end; $$;
revoke all on function public.club_list_madhouse_apparel_orders_secure(uuid) from public,anon,authenticated;
grant execute on function public.club_list_madhouse_apparel_orders_secure(uuid) to authenticated;

-- New Glow Zone confirmations do not store DOB. Legacy DOB values remain
-- untouched here; any historical-data cleanup requires a separate review.
alter table public.club_glow_age_verifications alter column date_of_birth drop not null;

create or replace function public.club_glow_effective_age_status(p_organisation_id uuid,p_user_id uuid)
returns text language sql stable security invoker set search_path=pg_catalog,public as $$
  select case when c.date_of_birth>(current_date-interval '18 years')::date then 'under_18'
    when a.status='under_18' then 'under_18'
    when a.status='verified' and a.verified_by is not null and a.verified_at is not null then 'verified'
    else 'required' end
  from (select 1) seed
  left join public.club_customers c on c.organisation_id=p_organisation_id and c.user_id=p_user_id
  left join public.club_glow_age_verifications a on a.organisation_id=p_organisation_id and a.user_id=p_user_id;
$$;
-- Internal helper only. Nested authorised SECURITY DEFINER RPCs invoke it as
-- their owner; callers cannot query another customer's verification state.
revoke all on function public.club_glow_effective_age_status(uuid,uuid) from public,anon,authenticated;

create or replace function public.club_glow_record_age_confirmation(p_organisation_id uuid,p_user_id uuid,p_is_adult boolean,p_method text default 'visual_id_check')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_glow_age_verifications%rowtype; declared_dob date; actor_role text;
begin
  if auth.uid() is null or not public.club_glow_carlton_staff_allowed(p_organisation_id)
    or not public.club_capability_allowed(p_organisation_id,auth.uid(),'induction.perform') then
    raise exception 'Age verification permission required at Carlton' using errcode='42501';
  end if;
  if p_is_adult is null or p_method is null or p_method not in ('visual_id_check','other_approved_id_check') then raise exception 'Record an in-person age check' using errcode='22023'; end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  if actor_role is null then raise exception 'Active Club staff access is required' using errcode='42501'; end if;
  if not exists(select 1 from public.club_customers where organisation_id=p_organisation_id and user_id=p_user_id) then raise exception 'Glow customer is not linked' using errcode='P0002'; end if;
  select date_of_birth into declared_dob from public.club_customers where organisation_id=p_organisation_id and user_id=p_user_id;
  if p_is_adult and declared_dob>(current_date-interval '18 years')::date then raise exception 'Customer profile indicates under 18' using errcode='42501'; end if;
  insert into public.club_glow_age_verifications(organisation_id,user_id,date_of_birth,status,verified_at,verified_by,verification_method)
  values(p_organisation_id,p_user_id,null,case when p_is_adult then 'verified' else 'under_18' end,now(),auth.uid(),p_method)
  on conflict(organisation_id,user_id) do update set status=excluded.status,verified_at=excluded.verified_at,verified_by=excluded.verified_by,verification_method=excluded.verification_method
  returning * into r;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    values(p_organisation_id,auth.uid(),actor_role,'glow.age_check_recorded','customer',null,jsonb_build_object('user_id',p_user_id,'status',r.status,'method',r.verification_method));
  return jsonb_build_object('status',r.status,'verified_at',r.verified_at,'verified_by',r.verified_by,'verification_method',r.verification_method);
end; $$;
revoke all on function public.club_glow_record_age_confirmation(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.club_glow_record_age_confirmation(uuid,uuid,boolean,text) to authenticated;

create or replace function public.club_glow_age_status_secure(p_organisation_id uuid,p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; a public.club_glow_age_verifications%rowtype; v_status text;
begin
  if auth.uid() is null or not public.club_glow_carlton_staff_allowed(p_organisation_id) then raise exception 'Glow Zone age status is not permitted' using errcode='42501'; end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and user_id=p_user_id;
  if not found then return null; end if;
  select * into a from public.club_glow_age_verifications where organisation_id=p_organisation_id and user_id=p_user_id;
  v_status:=public.club_glow_effective_age_status(p_organisation_id,p_user_id);
  return jsonb_build_object('status',v_status,'verified_at',case when a.status in ('verified','under_18') then a.verified_at end,
    'verified_by',case when a.status in ('verified','under_18') then a.verified_by end,'first_name',c.first_name,'last_name',c.last_name,'email',c.email,'phone',c.phone);
end; $$;
revoke all on function public.club_glow_age_status_secure(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_glow_age_status_secure(uuid,uuid) to authenticated;

-- Glow customer setup gathers only identity/contact details. It does not copy
-- DOB from Auth metadata or request DOB through the Glow-specific form.
create or replace function public.club_glow_ensure_customer_secure(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid(); v_email text; v_confirmed timestamptz; v_first text; v_last text; v_phone text; v_customer public.club_customers%rowtype; v_count integer; v_state text; v_missing jsonb:='[]'::jsonb;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not exists(select 1 from public.club_organisations o where o.id=p_organisation_id and o.active and exists(select 1 from public.club_location_service_hours h where h.organisation_id=o.id and h.service_key='sunbeds')) then raise exception 'Glow Zone is unavailable' using errcode='22023'; end if;
  select lower(btrim(u.email)),u.email_confirmed_at,
    coalesce(nullif(btrim(p.first_name),''),nullif(btrim(u.raw_user_meta_data->>'first_name'),'')),
    coalesce(nullif(btrim(p.last_name),''),nullif(btrim(u.raw_user_meta_data->>'last_name'),'')),
    nullif(btrim(u.raw_user_meta_data->>'phone'),'')
    into v_email,v_confirmed,v_first,v_last,v_phone
    from auth.users u left join public.profiles p on p.id=u.id where u.id=v_user;
  if v_email is null or v_confirmed is null then raise exception 'Verified email required' using errcode='42501'; end if;
  if v_phone is not null and (length(v_phone) not between 7 and 25 or v_phone !~ '^\+?[0-9][0-9 ()-]*$') then v_phone:=null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':'||v_user::text,0));
  select * into v_customer from public.club_customers where organisation_id=p_organisation_id and user_id=v_user for update;
  if found then v_state:='already_linked';
  else
    select count(*) into v_count from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_email;
    if v_count>1 then raise exception 'Customer records require staff review' using errcode='23505'; end if;
    if v_count=1 then
      select * into v_customer from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_email for update;
      if v_customer.user_id is not null and v_customer.user_id<>v_user then raise exception 'Customer record is already linked' using errcode='23505'; end if;
      update public.club_customers set user_id=v_user,updated_at=now() where id=v_customer.id returning * into v_customer;
      v_state:='linked_existing';
      insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
        values(p_organisation_id,v_user,'customer','glow.customer_self_linked','customer',v_customer.id,jsonb_build_object('match','verified_email'));
    else
      insert into public.club_customers(organisation_id,user_id,display_name,email,phone,status,first_name,last_name)
        values(p_organisation_id,v_user,coalesce(nullif(concat_ws(' ',v_first,v_last),''),split_part(v_email,'@',1),'Glow Zone customer'),v_email,v_phone,'customer',v_first,v_last)
        returning * into v_customer;
      v_state:='created';
      insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
        values(p_organisation_id,v_user,'customer','glow.customer_created','customer',v_customer.id,jsonb_build_object('source','verified_account'));
    end if;
  end if;
  update public.club_customers set
    first_name=coalesce(nullif(btrim(first_name),''),v_first),last_name=coalesce(nullif(btrim(last_name),''),v_last),
    phone=case when length(btrim(coalesce(phone,''))) between 7 and 25 and btrim(phone) ~ '^\+?[0-9][0-9 ()-]*$' then phone else v_phone end,
    email=coalesce(nullif(btrim(email),''),v_email),updated_at=now()
    where id=v_customer.id returning * into v_customer;
  insert into public.profiles(id,email,display_name,first_name,last_name)
    values(v_user,v_email,coalesce(nullif(concat_ws(' ',v_first,v_last),''),split_part(v_email,'@',1)),v_first,v_last)
    on conflict(id) do update set first_name=coalesce(nullif(btrim(public.profiles.first_name),''),excluded.first_name),last_name=coalesce(nullif(btrim(public.profiles.last_name),''),excluded.last_name),email=coalesce(public.profiles.email,excluded.email);
  if nullif(btrim(v_customer.first_name),'') is null then v_missing:=v_missing||'"firstName"'::jsonb; end if;
  if nullif(btrim(v_customer.last_name),'') is null then v_missing:=v_missing||'"lastName"'::jsonb; end if;
  if nullif(btrim(v_customer.phone),'') is null then v_missing:=v_missing||'"phone"'::jsonb; end if;
  return jsonb_build_object('customer_id',v_customer.id,'status',v_state,'missing_fields',v_missing);
end; $$;
revoke all on function public.club_glow_ensure_customer_secure(uuid) from public,anon,authenticated;
grant execute on function public.club_glow_ensure_customer_secure(uuid) to authenticated;

create or replace function public.club_glow_complete_customer_details_secure(p_organisation_id uuid,p_first_name text,p_last_name text,p_phone text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid(); v_email text; v_confirmed timestamptz; c public.club_customers%rowtype;
begin
  select lower(btrim(email)),email_confirmed_at into v_email,v_confirmed from auth.users where id=v_user;
  if v_user is null or v_confirmed is null then raise exception 'Verified account required' using errcode='42501'; end if;
  if not exists(select 1 from public.club_organisations o where o.id=p_organisation_id and o.active and exists(select 1 from public.club_location_service_hours h where h.organisation_id=o.id and h.service_key='sunbeds')) then raise exception 'Glow Zone is unavailable' using errcode='22023'; end if;
  if nullif(btrim(p_first_name),'') is null or length(btrim(p_first_name))>80 or nullif(btrim(p_last_name),'') is null or length(btrim(p_last_name))>80 or length(btrim(p_phone)) not between 7 and 25 or btrim(p_phone) !~ '^\+?[0-9][0-9 ()-]*$' then raise exception 'Glow Zone customer details are incomplete' using errcode='22023'; end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and user_id=v_user for update;
  if not found then raise exception 'Glow Zone customer record is not linked' using errcode='42501'; end if;
  update public.club_customers set first_name=coalesce(nullif(btrim(first_name),''),btrim(p_first_name)),last_name=coalesce(nullif(btrim(last_name),''),btrim(p_last_name)),phone=case when length(btrim(coalesce(phone,''))) between 7 and 25 and btrim(phone) ~ '^\+?[0-9][0-9 ()-]*$' then phone else btrim(p_phone) end,email=coalesce(nullif(btrim(email),''),v_email),updated_at=now() where id=c.id returning * into c;
  insert into public.profiles(id,email,display_name,first_name,last_name) values(v_user,v_email,btrim(p_first_name)||' '||btrim(p_last_name),btrim(p_first_name),btrim(p_last_name)) on conflict(id) do update set first_name=coalesce(nullif(btrim(public.profiles.first_name),''),excluded.first_name),last_name=coalesce(nullif(btrim(public.profiles.last_name),''),excluded.last_name),email=coalesce(public.profiles.email,excluded.email);
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata) values(p_organisation_id,v_user,'customer','glow.customer_details_completed','customer',c.id,jsonb_build_object('missing_fields_completed',true));
  return jsonb_build_object('customer_id',c.id,'complete',true);
end; $$;
revoke all on function public.club_glow_complete_customer_details_secure(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.club_glow_complete_customer_details_secure(uuid,text,text,text) to authenticated;

create or replace function public.club_glow_my_customer_account_secure(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype;
begin
  if auth.uid() is null or not exists(select 1 from public.club_location_service_hours h where h.organisation_id=p_organisation_id and h.service_key='sunbeds') then raise exception 'Glow account access is not permitted' using errcode='42501'; end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and user_id=auth.uid();
  if not found then return null; end if;
  return jsonb_build_object('id',c.id,'organisation_id',c.organisation_id,'status',c.status,'first_name',c.first_name,'last_name',c.last_name,'email',c.email,'phone',c.phone,
    'age_status',public.club_glow_effective_age_status(p_organisation_id,auth.uid()));
end; $$;
revoke all on function public.club_glow_my_customer_account_secure(uuid) from public,anon,authenticated;
grant execute on function public.club_glow_my_customer_account_secure(uuid) to authenticated;

create or replace function public.club_glow_scan_session_request_secure(p_organisation_id uuid,p_token text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_glow_session_requests%rowtype; c public.club_customers%rowtype; age_status text; available integer;
begin
  if not public.club_glow_carlton_staff_allowed(p_organisation_id) then raise exception 'Glow Zone reception permission required at Carlton' using errcode='42501'; end if;
  select * into r from public.club_glow_session_requests where organisation_id=p_organisation_id and token_hash=extensions.digest(convert_to(upper(btrim(p_token)),'UTF8'),'sha256');
  if not found then raise exception 'Session request not found' using errcode='P0002'; end if;
  if r.status='pending' and r.expires_at<=now() then update public.club_glow_session_requests set status='expired',updated_at=now() where id=r.id returning * into r; end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and user_id=r.user_id;
  age_status:=public.club_glow_effective_age_status(p_organisation_id,r.user_id);
  select coalesce(sum(l.remaining_quantity) filter(where l.expires_at is null or l.expires_at>now()),0)::integer into available
    from public.club_service_credit_lots l where l.organisation_id=p_organisation_id and l.user_id=r.user_id and l.credit_key='sunbed_minutes';
  return public.club_glow_request_json(r)||jsonb_build_object('user_id',r.user_id,'customer_name',coalesce(c.display_name,'Glow Zone customer'),
    'customer_email',c.email,'customer_phone',c.phone,'balance_minutes',available,'age_status',coalesce(age_status,'required'));
end; $$;

-- Membership billing pages need customer-facing state, not the provider's raw
-- payment reference. Keep the existing capability and tenant checks.
create or replace function public.club_list_customer_billing_secure(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'id',obligation.id,'membership_id',obligation.membership_id,'amount_minor',obligation.amount_minor,
  'currency',obligation.currency,'next_due_at',obligation.next_due_at,'state',obligation.state,
  'payment_method_family',obligation.payment_method_family,'provider_type',arrangement.provider_type,
  'stripe_merchant_entity',case when arrangement.provider_type='stripe' then join_request.stripe_merchant_entity end,
  'failure_reason',obligation.failure_reason,'provider_status',obligation.provider_status,
  'provider_charge_date',obligation.provider_charge_date,'mandate_status',arrangement.provider_authority_state,
  'collection_status',arrangement.collection_status,'action_required_reason',arrangement.action_required_reason,
  'paid_through_at',arrangement.coverage_paid_through_at
) order by obligation.next_due_at),'[]'::jsonb)
from public.club_membership_billing_obligations obligation
join public.club_membership_billing_arrangements arrangement on arrangement.id=obligation.arrangement_id and arrangement.organisation_id=obligation.organisation_id
left join lateral (select request.stripe_merchant_entity from public.club_membership_join_requests request where request.organisation_id=arrangement.organisation_id and request.membership_id=arrangement.membership_id order by request.updated_at desc limit 1) join_request on true
where obligation.organisation_id=p_organisation_id
  and auth.uid() is not null
  and (obligation.customer_id=p_customer_id
    or exists(select 1 from public.club_customers customer where customer.id=p_customer_id and customer.organisation_id=obligation.organisation_id and customer.user_id=obligation.user_id)
    or exists(select 1 from public.club_membership_holders holder join public.club_customers customer on customer.id=p_customer_id and customer.organisation_id=holder.organisation_id where holder.organisation_id=obligation.organisation_id and holder.membership_id=obligation.membership_id and (holder.customer_id=customer.id or (customer.user_id is not null and holder.user_id=customer.user_id))))
  and (public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') or public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.extend_grace'));
$$;
revoke all on function public.club_list_customer_billing_secure(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_list_customer_billing_secure(uuid,uuid) to authenticated;

-- Raw age-verification rows are no longer directly selectable. Purpose-built
-- self/staff RPCs above return only the appropriate result.
revoke all on function public.club_glow_scan_session_request_secure(uuid,text) from public,anon,authenticated;
grant execute on function public.club_glow_scan_session_request_secure(uuid,text) to authenticated;

-- Existing discount-verification records already include product_id (the
-- concession/eligibility type), status, verifier and timestamp. No parallel
-- concession table or workflow is introduced.

commit;
