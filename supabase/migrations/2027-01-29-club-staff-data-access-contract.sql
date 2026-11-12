-- CONTRACT phase: run only after the application using secure RPCs/projections
-- is deployed everywhere and old instances are drained. Existing RLS policies are
-- retained; this transaction narrows column privileges and retires legacy RPC grants.
begin;

do $$
declare t text; required_policy record;
begin
  foreach t in array array['club_customers','club_members','club_orders','club_order_items','club_payments','club_refunds'] loop
    if to_regclass('public.'||t) is null then
      raise exception 'Required table public.% is missing; no grants were changed',t;
    end if;
    if not exists(select 1 from pg_class r join pg_namespace n on n.oid=r.relnamespace where n.nspname='public' and r.relname=t and r.relrowsecurity) then
      raise exception 'RLS must remain enabled on public.% before CONTRACT',t;
    end if;
  end loop;
  for required_policy in select * from (values
    ('club_customers','club_customers_self_select'),('club_customers','club_customers_staff_select'),
    ('club_members','club_members_self_select'),('club_members','club_members_staff_select'),
    ('club_orders','club_orders_self_select'),('club_orders','club_orders_staff_select'),
    ('club_order_items','club_order_items_order_select'),
    ('club_payments','club_payments_self_select'),('club_payments','club_payments_staff_select'),
    ('club_refunds','club_refunds_staff_select'),('club_glow_age_verifications','glow_age_self_staff')
  ) as p(table_name,policy_name) loop
    if not exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename=required_policy.table_name and p.policyname=required_policy.policy_name) then
      raise exception 'Required organisation-scoped policy %.% is missing; no grants were changed',required_policy.table_name,required_policy.policy_name;
    end if;
  end loop;
  if to_regprocedure('public.club_get_member_contact_secure(uuid,uuid)') is null
     or to_regprocedure('public.club_update_member_contact_secure(uuid,uuid,text,text,text,text,text)') is null
     or to_regprocedure('public.club_get_member_emergency_contact(uuid,uuid)') is null
     or to_regprocedure('public.club_list_finance_reconciliation(uuid,timestamptz,timestamptz,uuid)') is null
     or to_regprocedure('public.club_approve_staff_refund(uuid,integer,text,text,text)') is null
     or to_regprocedure('public.club_approve_staff_line_refund(uuid,jsonb,text,text,text)') is null
     or to_regprocedure('public.club_glow_record_age_confirmation(uuid,uuid,boolean,text)') is null
     or to_regprocedure('public.club_glow_complete_customer_details_secure(uuid,text,text,text)') is null
     or to_regprocedure('public.club_record_cash_payment_secure(uuid,integer,text)') is null
     or to_regprocedure('public.club_list_madhouse_apparel_orders_secure(uuid)') is null
     or to_regprocedure('public.club_glow_age_status_secure(uuid,uuid)') is null
     or to_regprocedure('public.club_glow_ensure_customer_secure(uuid)') is null
     or to_regprocedure('public.club_glow_my_customer_account_secure(uuid)') is null
     or to_regprocedure('public.club_glow_scan_session_request_secure(uuid,text)') is null
     or to_regprocedure('public.club_list_customer_billing_secure(uuid,uuid)') is null then
    raise exception 'Required secure application RPC is missing; no grants were changed';
  end if;
end $$;

-- Remove broad table and prior per-column SELECT grants from client roles.
do $$
declare t text; c record;
begin
  foreach t in array array['club_customers','club_members','club_orders','club_order_items','club_payments','club_refunds'] loop
    execute format('revoke select on table public.%I from public,anon,authenticated',t);
    for c in select column_name from information_schema.columns where table_schema='public' and table_name=t loop
      execute format('revoke select (%I) on table public.%I from public,anon,authenticated',c.column_name,t);
    end loop;
  end loop;
end $$;

grant select (id,organisation_id,user_id,display_name,email,phone,status,created_at,updated_at,first_name,last_name,preferred_location_id)
  on public.club_customers to authenticated;
grant select (id,organisation_id,user_id,role,active,created_at,preferred_location_id)
  on public.club_members to authenticated;
grant select (id,organisation_id,location_id,customer_id,user_id,channel,status,currency,subtotal_minor,discount_minor,total_minor,created_at,updated_at)
  on public.club_orders to authenticated;
grant select (id,order_id,organisation_id,product_id,product_name,quantity,unit_price_minor,line_total_minor,stock_tracked,created_at)
  on public.club_order_items to authenticated;
grant select (id,order_id,organisation_id,method,amount_minor,currency,status,created_at,updated_at)
  on public.club_payments to authenticated;
grant select (id,payment_id,order_id,organisation_id,amount_minor,reason,created_at)
  on public.club_refunds to authenticated;

-- Retire old broad or DOB-bearing RPC access after the new application is live.
revoke all on function public.club_get_member_contact(uuid,uuid),public.club_update_member_contact(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.club_issue_staff_refund(uuid,integer,text,text,text),public.club_issue_staff_line_refund(uuid,jsonb,text,text,text) from public,anon,authenticated;
revoke all on function public.club_glow_record_age_verification(uuid,uuid,date,text) from public,anon,authenticated;
revoke all on function public.club_glow_complete_customer_details(uuid,text,text,text,date) from public,anon,authenticated;
revoke all on function public.club_record_cash_payment(uuid,integer,text) from public,anon,authenticated;
revoke all on function public.club_list_madhouse_apparel_orders(uuid) from public,anon,authenticated;
revoke all on function public.club_glow_age_status(uuid,uuid) from public,anon,authenticated;
revoke all on function public.club_glow_ensure_customer(uuid) from public,anon,authenticated;
revoke all on function public.club_glow_my_customer_account(uuid) from public,anon,authenticated;
revoke all on function public.club_list_customer_billing(uuid,uuid) from public,anon,authenticated;
revoke all on table public.club_glow_age_verifications from public,anon,authenticated;
revoke all on function public.club_glow_scan_session_request(uuid,text) from public,anon,authenticated;
grant execute on function public.club_glow_scan_session_request(uuid,text) to authenticated;

commit;
