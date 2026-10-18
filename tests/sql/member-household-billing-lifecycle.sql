-- Disposable PostgreSQL integration fixture for household membership billing,
-- access projection, cash evidence and identity separation. All rows roll back.
-- Run only through scripts/validate-coach-nutrition-reconciliation-postgres.sh.
begin;

insert into auth.users(id,email) values
 ('40000000-0000-4000-8000-000000000001','household-owner@example.test'),
 ('40000000-0000-4000-8000-000000000002','shared-household@example.test'),
 ('40000000-0000-4000-8000-000000000003','shared-household@example.test'),
 ('40000000-0000-4000-8000-000000000004','payer-one@example.test'),
 ('40000000-0000-4000-8000-000000000005','payer-two@example.test'),
 ('40000000-0000-4000-8000-000000000006','cash-expired@example.test'),
 ('40000000-0000-4000-8000-000000000007','cash-cancelled@example.test');

insert into public.club_organisations(id,name,slug) values
 ('40000000-0000-4000-8000-000000000010','Household lifecycle test','household-lifecycle-test');
insert into public.club_locations(id,organisation_id,name,access_mode) values
 ('40000000-0000-4000-8000-000000000011','40000000-0000-4000-8000-000000000010','Rotherham','CHECKIN_ONLY'),
 ('40000000-0000-4000-8000-000000000012','40000000-0000-4000-8000-000000000010','Carlton','CHECKIN_ONLY');
insert into public.club_members(organisation_id,user_id,role,active,preferred_location_id) values
 ('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000001','owner',true,'40000000-0000-4000-8000-000000000011'),
 ('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000002','member',true,'40000000-0000-4000-8000-000000000011'),
 ('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000003','member',true,'40000000-0000-4000-8000-000000000012'),
 ('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000004','member',true,'40000000-0000-4000-8000-000000000011'),
 ('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000005','member',true,'40000000-0000-4000-8000-000000000012'),
 ('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000006','member',true,'40000000-0000-4000-8000-000000000011'),
 ('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000007','member',true,'40000000-0000-4000-8000-000000000012');

insert into public.club_customers(id,organisation_id,user_id,display_name,email,status) values
 ('40000000-0000-4000-8000-000000000020','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000002','Household member one','shared-household@example.test','member'),
 ('40000000-0000-4000-8000-000000000021','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000003','Household member two','shared-household@example.test','member'),
 ('40000000-0000-4000-8000-000000000022','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000004','Household payer','payer-one@example.test','member'),
 ('40000000-0000-4000-8000-000000000023','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000005','Separate payer','payer-two@example.test','member'),
 ('40000000-0000-4000-8000-000000000024','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000006','Cash expired member','cash-expired@example.test','member'),
 ('40000000-0000-4000-8000-000000000025','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000007','Cash cancelled member','cash-cancelled@example.test','member'),
 ('40000000-0000-4000-8000-000000000026','40000000-0000-4000-8000-000000000010',null,'Member without email',null,'member');

insert into public.club_products(id,organisation_id,name,kind,price_minor,currency,billing,duration_days) values
 ('40000000-0000-4000-8000-000000000030','40000000-0000-4000-8000-000000000010','Household membership','membership',5000,'GBP','recurring',null),
 ('40000000-0000-4000-8000-000000000031','40000000-0000-4000-8000-000000000010','Independent membership','membership',3000,'GBP','recurring',null),
 ('40000000-0000-4000-8000-000000000032','40000000-0000-4000-8000-000000000010','Cash membership','membership',2500,'GBP','recurring',null),
 ('40000000-0000-4000-8000-000000000033','40000000-0000-4000-8000-000000000010','Cash monthly schedule test','membership',2500,'GBP','recurring',null),
 ('40000000-0000-4000-8000-000000000034','40000000-0000-4000-8000-000000000010','Day pass','membership',500,'GBP','one_off',1),
 ('40000000-0000-4000-8000-000000000035','40000000-0000-4000-8000-000000000010','Week pass','membership',1200,'GBP','one_off',7);
insert into public.club_product_entitlements(product_id,organisation_id,position,entitlement_key,scope,location_ids) values
 ('40000000-0000-4000-8000-000000000030','40000000-0000-4000-8000-000000000010',0,'gym_access','organisation','{}'),
 ('40000000-0000-4000-8000-000000000031','40000000-0000-4000-8000-000000000010',0,'gym_access','organisation','{}'),
 ('40000000-0000-4000-8000-000000000032','40000000-0000-4000-8000-000000000010',0,'gym_access','organisation','{}');

insert into public.club_memberships(id,organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key) values
 ('40000000-0000-4000-8000-000000000040','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000030','active',now()-interval '60 days',null,'household_fixture','household-main'),
 ('40000000-0000-4000-8000-000000000041','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000032','expired',now()-interval '90 days',now()-interval '1 day','cash_fixture','cash-expired'),
 ('40000000-0000-4000-8000-000000000042','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000032','cancelled',now()-interval '90 days',now()-interval '1 day','cash_fixture','cash-cancelled');
insert into public.club_membership_holders(id,membership_id,organisation_id,user_id) values
 ('40000000-0000-4000-8000-000000000050','40000000-0000-4000-8000-000000000040','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000002'),
 ('40000000-0000-4000-8000-000000000051','40000000-0000-4000-8000-000000000040','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000003'),
 ('40000000-0000-4000-8000-000000000052','40000000-0000-4000-8000-000000000041','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000006'),
 ('40000000-0000-4000-8000-000000000053','40000000-0000-4000-8000-000000000042','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000007');
insert into public.club_memberships(id,organisation_id,product_id,status,starts_at,source,assignment_idempotency_key) values
 ('40000000-0000-4000-8000-000000000045','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000033','active',now()-interval '60 days','cash_schedule_fixture','cash-schedule-member'),
 ('40000000-0000-4000-8000-000000000046','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000034','active',now()-interval '1 day','pass_fixture','day-pass-member'),
 ('40000000-0000-4000-8000-000000000047','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000035','active',now()-interval '1 day','pass_fixture','week-pass-member');
insert into public.club_membership_holders(id,membership_id,organisation_id,user_id) values
 ('40000000-0000-4000-8000-000000000056','40000000-0000-4000-8000-000000000045','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000004'),
 ('40000000-0000-4000-8000-000000000057','40000000-0000-4000-8000-000000000046','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000004'),
 ('40000000-0000-4000-8000-000000000058','40000000-0000-4000-8000-000000000047','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000005');
insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,starts_at,ends_at,source) values
 ('40000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000040','gym_access','organisation','{}',now()-interval '60 days',null,'household_fixture'),
 ('40000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000040','gym_access','organisation','{}',now()-interval '60 days',null,'household_fixture'),
 ('40000000-0000-4000-8000-000000000006','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000041','gym_access','organisation','{}',now()-interval '90 days',now()-interval '1 day','cash_fixture'),
 ('40000000-0000-4000-8000-000000000007','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000042','gym_access','organisation','{}',now()-interval '90 days',now()-interval '1 day','cash_fixture');

-- One shared arrangement has two holders but exactly one payer and one
-- obligation per period. The two holder profiles intentionally share email;
-- the payer is a separate identity. A missing-email customer stays unlinked.
insert into public.club_membership_billing_policies(organisation_id,grace_period_days,suspend_after_days,max_retries,access_suspension_enabled)
values('40000000-0000-4000-8000-000000000010',7,14,0,true);
insert into public.club_membership_billing_arrangements(id,organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,amount_minor,currency,frequency,next_due_at)
values('40000000-0000-4000-8000-000000000060','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000040','40000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000022','cash','cash',5000,'GBP','monthly',now()-interval '10 days');
insert into public.club_membership_billing_obligations(id,organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,amount_minor,currency,frequency,next_due_at,period_key,state,coverage_start_at,coverage_end_at)
values('40000000-0000-4000-8000-000000000061','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000060','40000000-0000-4000-8000-000000000040','40000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000022','cash','cash',5000,'GBP','monthly',now()-interval '10 days','household-period-1','due',now()-interval '10 days',public.club_membership_anniversary(now()-interval '10 days',extract(day from (now()-interval '10 days') at time zone 'UTC')::integer,1));

-- Day/week passes are fixed-term products and cannot receive a monthly billing
-- arrangement, even if a caller tries to enrol them through the recurring path.
do $$
begin
  begin
    insert into public.club_membership_billing_arrangements(organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,amount_minor,currency,frequency,next_due_at)
    values('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000046','40000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000022','cash','cash',500,'GBP','monthly',now());
    raise exception 'Day pass created a monthly obligation arrangement';
  exception when sqlstate '22023' then null; end;
  begin
    insert into public.club_membership_billing_arrangements(organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,amount_minor,currency,frequency,next_due_at)
    values('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000047','40000000-0000-4000-8000-000000000005','40000000-0000-4000-8000-000000000023','cash','cash',1200,'GBP','monthly',now());
    raise exception 'Week pass created a monthly obligation arrangement';
  exception when sqlstate '22023' then null; end;
end $$;

insert into public.club_membership_billing_arrangements(id,organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,amount_minor,currency,frequency,next_due_at,billing_anchor_day)
values('40000000-0000-4000-8000-000000000067','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000045','40000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000022','cash','cash',2500,'GBP','monthly','2024-01-31 10:00:00+00',31);
insert into public.club_membership_billing_obligations(id,organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,amount_minor,currency,frequency,next_due_at,period_key,state,coverage_start_at,coverage_end_at)
values('40000000-0000-4000-8000-000000000068','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000067','40000000-0000-4000-8000-000000000045','40000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000022','cash','cash',2500,'GBP','monthly','2024-01-31 10:00:00+00','cash-schedule-2024-01','due','2024-01-31 10:00:00+00','2024-02-29 10:00:00+00');

-- Exercise early, on-time and late receipts against distinct scheduled periods.
-- The final late receipt follows a missed month and must not rebase anniversaries
-- to the cash receipt date.
select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$
declare obligation_id uuid; due_at timestamptz; period_start date; period_end date; result jsonb; billing_item jsonb;
begin
  select item.value into billing_item
  from jsonb_array_elements(public.club_list_customer_billing('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000022')) item(value)
  where item.value->>'id'='40000000-0000-4000-8000-000000000068';
  if billing_item is null then raise exception 'Authorised billing projection did not return the scheduled January period'; end if;
  obligation_id:=(billing_item->>'id')::uuid;
  due_at:=(billing_item->>'next_due_at')::timestamptz;
  period_start:=((billing_item->>'coverage_start_at')::timestamptz at time zone 'UTC')::date;
  period_end:=((billing_item->>'coverage_end_at')::timestamptz at time zone 'UTC')::date-1;
  if period_start<>date '2024-01-31' or period_end<>date '2024-02-28' then raise exception 'January month-end period was not represented correctly'; end if;
  result:=public.club_record_verified_membership_cash_payment('40000000-0000-4000-8000-000000000010',obligation_id,'40000000-0000-4000-8000-000000000011',2500,'GBP','cash-early-jan',date '2024-01-30',period_start,period_end,period_end,'Synthetic early cash receipt');
  begin
    perform public.club_record_verified_membership_cash_payment('40000000-0000-4000-8000-000000000010',obligation_id,'40000000-0000-4000-8000-000000000011',2500,'GBP','cash-early-jan',date '2024-01-30',period_start,period_end,period_end-1,'Conflicting evidence must not overwrite');
    raise exception 'Idempotent cash receipt accepted conflicting verification evidence';
  exception when unique_violation then null; end;
  result:=public.club_record_verified_membership_cash_payment('40000000-0000-4000-8000-000000000010',obligation_id,'40000000-0000-4000-8000-000000000011',2500,'GBP','cash-early-jan',date '2024-01-30',period_start,period_end,period_end,'Synthetic early cash receipt');
  if not exists(select 1 from jsonb_array_elements(public.club_list_customer_billing('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000022')) item(value)
    where item.value->>'membership_id'='40000000-0000-4000-8000-000000000045' and (item.value->>'next_due_at')::timestamptz=timestamptz '2024-02-29 10:00:00+00') then raise exception 'Jan 31 leap-year anniversary did not land on Feb 29'; end if;
  select item.value into billing_item from jsonb_array_elements(public.club_list_customer_billing('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000022')) item(value)
  where item.value->>'membership_id'='40000000-0000-4000-8000-000000000045' and (item.value->>'next_due_at')::timestamptz=timestamptz '2024-02-29 10:00:00+00';
  obligation_id:=(billing_item->>'id')::uuid;
  due_at:=(billing_item->>'next_due_at')::timestamptz;
  period_start:=((billing_item->>'coverage_start_at')::timestamptz at time zone 'UTC')::date;
  period_end:=((billing_item->>'coverage_end_at')::timestamptz at time zone 'UTC')::date-1;
  if period_start<>date '2024-02-29' or period_end<>date '2024-03-30' then raise exception 'Leap-day monthly period was not represented correctly'; end if;
  result:=public.club_record_verified_membership_cash_payment('40000000-0000-4000-8000-000000000010',obligation_id,'40000000-0000-4000-8000-000000000011',2500,'GBP','cash-on-time-feb',date '2024-02-29',period_start,period_end,period_end,'Synthetic on-time cash receipt');
  if not exists(select 1 from jsonb_array_elements(public.club_list_customer_billing('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000022')) item(value)
    where item.value->>'membership_id'='40000000-0000-4000-8000-000000000045' and (item.value->>'next_due_at')::timestamptz=timestamptz '2024-03-31 10:00:00+00') then raise exception 'Leap-day payment lost the original 31st anniversary'; end if;
  select item.value into billing_item from jsonb_array_elements(public.club_list_customer_billing('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000022')) item(value)
  where item.value->>'membership_id'='40000000-0000-4000-8000-000000000045' and (item.value->>'next_due_at')::timestamptz=timestamptz '2024-03-31 10:00:00+00';
  obligation_id:=(billing_item->>'id')::uuid;
  due_at:=(billing_item->>'next_due_at')::timestamptz;
  period_start:=((billing_item->>'coverage_start_at')::timestamptz at time zone 'UTC')::date;
  period_end:=((billing_item->>'coverage_end_at')::timestamptz at time zone 'UTC')::date-1;
  result:=public.club_record_verified_membership_cash_payment('40000000-0000-4000-8000-000000000010',obligation_id,'40000000-0000-4000-8000-000000000011',2500,'GBP','cash-late-mar',date '2024-05-15',period_start,period_end,period_end,'Synthetic late cash receipt after a missed month');
  if not exists(select 1 from jsonb_array_elements(public.club_list_customer_billing('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000022')) item(value)
    where item.value->>'membership_id'='40000000-0000-4000-8000-000000000045' and (item.value->>'next_due_at')::timestamptz=timestamptz '2024-04-30 10:00:00+00') then raise exception 'Late payment reset the contractual renewal date instead of advancing one scheduled period'; end if;
  if exists(select 1 from jsonb_array_elements(public.club_list_customer_billing('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000022')) item(value)
    where item.value->>'membership_id'='40000000-0000-4000-8000-000000000045' and (item.value->>'next_due_at')::timestamptz>timestamptz '2024-04-30 10:00:00+00') then raise exception 'A late receipt generated future obligations from its receipt date'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','',true);
do $$
begin
 if (select count(*) from public.club_membership_billing_payments where obligation_id in (
   select id from public.club_membership_billing_obligations where membership_id='40000000-0000-4000-8000-000000000045'
 ))<>3 then raise exception 'Early, on-time and late receipts did not settle exactly three scheduled periods'; end if;
end $$;

-- Distinct payer membership and a holder with no email do not merge people.
insert into public.club_memberships(id,organisation_id,product_id,status,starts_at,source,assignment_idempotency_key) values
 ('40000000-0000-4000-8000-000000000044','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000031','active',now()-interval '10 days','missing_email_fixture','missing-email-member');
insert into public.club_membership_holders(id,membership_id,organisation_id,customer_id)
values('40000000-0000-4000-8000-000000000055','40000000-0000-4000-8000-000000000044','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000026');
insert into public.club_membership_billing_arrangements(id,organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,amount_minor,currency,frequency,next_due_at)
values('40000000-0000-4000-8000-000000000062','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000044','40000000-0000-4000-8000-000000000005','40000000-0000-4000-8000-000000000023','fixture','recurring_card',3000,'GBP','monthly',now()+interval '1 month');

do $$
begin
 if (select count(*) from public.club_membership_holders where membership_id='40000000-0000-4000-8000-000000000040')<>2 then raise exception 'Shared membership did not retain both holders'; end if;
 if (select count(*) from public.club_membership_billing_arrangements where membership_id='40000000-0000-4000-8000-000000000040')<>1
    or (select count(*) from public.club_membership_billing_obligations where arrangement_id='40000000-0000-4000-8000-000000000060')<>1 then raise exception 'Shared membership must have one arrangement and one obligation per period'; end if;
 if (select count(*) from public.club_customers where organisation_id='40000000-0000-4000-8000-000000000010' and email='shared-household@example.test')<>2
    or (select count(distinct user_id) from public.club_customers where organisation_id='40000000-0000-4000-8000-000000000010' and email='shared-household@example.test')<>2 then raise exception 'Shared email merged distinct member identities'; end if;
 if (select user_id from public.club_membership_billing_arrangements where id='40000000-0000-4000-8000-000000000060')='40000000-0000-4000-8000-000000000002'
    or (select user_id from public.club_membership_billing_arrangements where id='40000000-0000-4000-8000-000000000062')='40000000-0000-4000-8000-000000000006' then raise exception 'Distinct payer was conflated with a covered member'; end if;
 if exists(select 1 from public.club_member_notification_intents where organisation_id='40000000-0000-4000-8000-000000000010' and template_key='member_activation') then raise exception 'Fixture unexpectedly queued member activation'; end if;
 if not (select relrowsecurity from pg_class where oid='public.club_membership_billing_obligations'::regclass)
    or has_table_privilege('authenticated','public.club_membership_billing_obligations','select') then raise exception 'Billing RLS/privilege boundary is missing'; end if;
 if not exists(select 1 from pg_constraint where conrelid='public.club_membership_holders'::regclass and conname='club_membership_holders_identity_chk') then raise exception 'Holder identity constraint is missing'; end if;
 begin
  insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,amount_minor,currency,frequency,next_due_at,period_key)
  values('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000060','40000000-0000-4000-8000-000000000040','40000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000022','fixture','recurring_card',5000,'GBP','monthly',now()-interval '10 days','household-period-1');
  raise exception 'Duplicate obligation for the same arrangement period was accepted';
 exception when unique_violation then null; end;
end $$;

-- A missed cash renewal enters grace through the configured billing evaluator;
-- cash is not represented as an asynchronous provider failure event.
select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select public.club_evaluate_membership_billing('40000000-0000-4000-8000-000000000010',now()-interval '5 days');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','',true);

do $$
begin
 if (select state from public.club_membership_billing_obligations where id='40000000-0000-4000-8000-000000000061')<>'grace' then raise exception 'Missed cash renewal did not enter grace'; end if;
 if (select count(*) from public.club_membership_billing_obligations where arrangement_id='40000000-0000-4000-8000-000000000060')<>1 then raise exception 'Payment failure duplicated the billing obligation'; end if;
 if (select count(*) from public.club_member_access_projection where organisation_id='40000000-0000-4000-8000-000000000010' and customer_id in ('40000000-0000-4000-8000-000000000020','40000000-0000-4000-8000-000000000021') and access_state='grace' and access_allowed)<>2 then raise exception 'Household holders did not share access during grace'; end if;
end $$;

select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select public.club_evaluate_membership_billing('40000000-0000-4000-8000-000000000010',now()+interval '30 days');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','',true);

do $$
begin
 if (select count(*) from public.club_membership_payment_access_suspensions where membership_id='40000000-0000-4000-8000-000000000040' and active)<>1 then raise exception 'Grace expiry did not suspend the shared membership'; end if;
 if (select count(*) from public.club_member_access_projection where organisation_id='40000000-0000-4000-8000-000000000010' and customer_id in ('40000000-0000-4000-8000-000000000020','40000000-0000-4000-8000-000000000021') and access_state='action_required' and not access_allowed)<>2 then raise exception 'Payment suspension did not apply to every household holder'; end if;
end $$;

-- A separately valid membership still grants access to one household holder.
insert into public.club_memberships(id,organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key) values
 ('40000000-0000-4000-8000-000000000043','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000031','active',now()-interval '30 days',null,'independent_fixture','independent-member-one');
insert into public.club_membership_holders(id,membership_id,organisation_id,user_id)
values('40000000-0000-4000-8000-000000000054','40000000-0000-4000-8000-000000000043','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000002');
insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,starts_at,source)
values('40000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000043','gym_access','organisation','{}',now()-interval '30 days','independent_fixture');
do $$ begin
 if (select access_allowed from public.club_member_access_projection where organisation_id='40000000-0000-4000-8000-000000000010' and customer_id='40000000-0000-4000-8000-000000000020') is distinct from true then raise exception 'Independent valid membership did not preserve access'; end if;
end $$;

-- A standalone staff override is independent of shared-billing suspension.
insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,starts_at,source)
values('40000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000010',null,'gym_access','organisation','{}',now(),'staff_override_fixture');
do $$
begin
 if (select access_allowed from public.club_member_access_projection where organisation_id='40000000-0000-4000-8000-000000000010' and customer_id='40000000-0000-4000-8000-000000000021') is distinct from true then raise exception 'Independent manual access override was lost to shared payment suspension'; end if;
end $$;

-- Remove the two independent access paths after proving each one works, so the
-- recovery assertion below can prove that the household arrangement itself
-- restores both holders rather than being masked by another entitlement.
update public.club_memberships set status='expired',ends_at=now()-interval '1 second'
where id='40000000-0000-4000-8000-000000000043';
update public.club_entitlement_grants set starts_at=now()-interval '2 seconds',ends_at=now()-interval '1 second'
where membership_id='40000000-0000-4000-8000-000000000043' and user_id='40000000-0000-4000-8000-000000000002';
update public.club_entitlement_grants set starts_at=now()-interval '2 seconds',ends_at=now()-interval '1 second'
where membership_id is null and user_id='40000000-0000-4000-8000-000000000003' and source='staff_override_fixture';
select public.club_refresh_customer_access_projection('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000020');
select public.club_refresh_customer_access_projection('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000021');
do $$
begin
 if (select count(*) from public.club_member_access_projection where organisation_id='40000000-0000-4000-8000-000000000010' and customer_id in ('40000000-0000-4000-8000-000000000020','40000000-0000-4000-8000-000000000021') and access_state='action_required' and not access_allowed)<>2 then
   raise exception 'Expired independent access paths masked household suspension';
 end if;
end $$;

-- Recover the failed household cash period. It records the scheduled coverage
-- period separately from the actual receipt/paid-through dates and restores all
-- holders without creating a second obligation for the same period.
select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$
declare result jsonb; period_start date; period_end date; billing_item jsonb;
begin
 select item.value into billing_item
 from jsonb_array_elements(public.club_list_customer_billing('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000022')) item(value)
 where item.value->>'id'='40000000-0000-4000-8000-000000000061';
 if billing_item is null then raise exception 'Authorised billing projection did not return the household obligation'; end if;
 period_start:=((coalesce(billing_item->>'coverage_start_at',billing_item->>'next_due_at'))::timestamptz at time zone 'UTC')::date;
 if billing_item->>'coverage_end_at' is null then raise exception 'Household billing projection omitted the scheduled coverage boundary'; end if;
 period_end:=((billing_item->>'coverage_end_at')::timestamptz at time zone 'UTC')::date-1;
 result:=public.club_record_verified_membership_cash_payment('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000061','40000000-0000-4000-8000-000000000011',5000,'GBP','household-cash-recovery',current_date,period_start,period_end,greatest(current_date,period_end),'Synthetic verified household cash receipt');
 if result->>'coverageNeedsReview'='true' then raise exception 'Active household cash settlement unexpectedly requires reactivation review'; end if;
 result:=public.club_record_verified_membership_cash_payment('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000061','40000000-0000-4000-8000-000000000011',5000,'GBP','household-cash-recovery',current_date,period_start,period_end,greatest(current_date,period_end),'Synthetic verified household cash receipt');
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','',true);
do $$
begin
 if (select state from public.club_membership_billing_obligations where id='40000000-0000-4000-8000-000000000061')<>'recovered' then raise exception 'Successful collection did not recover the obligation'; end if;
 if exists(select 1 from public.club_membership_payment_access_suspensions where membership_id='40000000-0000-4000-8000-000000000040' and active) then raise exception 'Successful collection did not clear payment suspension'; end if;
 if (select count(*) from public.club_membership_billing_payments where obligation_id='40000000-0000-4000-8000-000000000061')<>1 then raise exception 'Repeated cash settlement duplicated payment evidence'; end if;
 if (select count(*) from public.club_membership_billing_obligations where arrangement_id='40000000-0000-4000-8000-000000000060')<>2 then raise exception 'Recovery did not create exactly one next-period obligation'; end if;
 if (select a.next_due_at from public.club_membership_billing_arrangements a where a.id='40000000-0000-4000-8000-000000000060') is distinct from (
   select public.club_membership_anniversary(o.next_due_at,coalesce(a.billing_anchor_day,extract(day from o.next_due_at at time zone 'UTC')::integer),1)
   from public.club_membership_billing_obligations o join public.club_membership_billing_arrangements a on a.id=o.arrangement_id
   where o.id='40000000-0000-4000-8000-000000000061'
 ) then raise exception 'Cash receipt reset household renewal schedule from the received date'; end if;
 if (select count(*) from public.club_member_access_projection where organisation_id='40000000-0000-4000-8000-000000000010' and customer_id in ('40000000-0000-4000-8000-000000000020','40000000-0000-4000-8000-000000000021') and membership_id='40000000-0000-4000-8000-000000000040' and access_allowed)<>2 then raise exception 'Recovered payment did not restore household coverage for both holders'; end if;
 if not exists(select 1 from public.club_membership_billing_payments where provider_event_key='household-cash-recovery' and billing_period_start is not null and billing_period_end>=billing_period_start and receipt_date=current_date and paid_through_date>=receipt_date) then raise exception 'Household cash receipt did not retain distinct verified dates'; end if;
end $$;

-- Verify home location is only a preference: both members are eligible at
-- both active venues via the same organisation-wide membership grant.
do $$
declare facts jsonb; holder uuid; venue uuid;
begin
 foreach holder in array array['40000000-0000-4000-8000-000000000002'::uuid,'40000000-0000-4000-8000-000000000003'::uuid] loop
  for venue in select id from public.club_locations where organisation_id='40000000-0000-4000-8000-000000000010' order by id loop
   select public.club_access_safety_facts('40000000-0000-4000-8000-000000000010',case when holder='40000000-0000-4000-8000-000000000002' then '40000000-0000-4000-8000-000000000020'::uuid else '40000000-0000-4000-8000-000000000021'::uuid end,venue,now()) into facts;
   if coalesce((facts->>'membershipEligible')::boolean,false) is not true then raise exception 'Home preference incorrectly restricted attendance at venue % for holder %: %',venue,holder,facts; end if;
  end loop;
 end loop;
end $$;

-- Expired and cancelled cash memberships may record auditable receipt evidence,
-- but the paid-through date must not rewrite membership status/dates or access.
insert into public.club_membership_billing_arrangements(id,organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,cash_channel,amount_minor,currency,frequency,next_due_at)
values
 ('40000000-0000-4000-8000-000000000063','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000041','40000000-0000-4000-8000-000000000006','40000000-0000-4000-8000-000000000024','cash','cash','staff_counter',2500,'GBP','monthly',now()-interval '30 days'),
 ('40000000-0000-4000-8000-000000000064','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000042','40000000-0000-4000-8000-000000000007','40000000-0000-4000-8000-000000000025','cash','cash','staff_counter',2500,'GBP','monthly',now()-interval '30 days');
insert into public.club_membership_billing_obligations(id,organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,cash_channel,amount_minor,currency,frequency,next_due_at,period_key,state,coverage_start_at,coverage_end_at)
values
 ('40000000-0000-4000-8000-000000000065','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000063','40000000-0000-4000-8000-000000000041','40000000-0000-4000-8000-000000000006','40000000-0000-4000-8000-000000000024','cash','cash','staff_counter',2500,'GBP','monthly',now()-interval '30 days','cash-expired-period','due',now()-interval '30 days',now()-interval '30 days'+interval '1 month'),
 ('40000000-0000-4000-8000-000000000066','40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000064','40000000-0000-4000-8000-000000000042','40000000-0000-4000-8000-000000000007','40000000-0000-4000-8000-000000000025','cash','cash','staff_counter',2500,'GBP','monthly',now()-interval '30 days','cash-cancelled-period','due',now()-interval '30 days',now()-interval '30 days'+interval '1 month');

select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$ declare result jsonb; period_start date; period_end date; billing_item jsonb; begin
 select item.value into billing_item
 from jsonb_array_elements(public.club_list_customer_billing('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000024')) item(value)
 where item.value->>'id'='40000000-0000-4000-8000-000000000065';
 if billing_item is null then raise exception 'Authorised billing projection did not return expired membership period'; end if;
 period_start:=((coalesce(billing_item->>'coverage_start_at',billing_item->>'next_due_at'))::timestamptz at time zone 'UTC')::date;
 if billing_item->>'coverage_end_at' is null then raise exception 'Expired membership billing projection omitted its scheduled coverage boundary'; end if;
 period_end:=((billing_item->>'coverage_end_at')::timestamptz at time zone 'UTC')::date-1;
 result:=public.club_record_verified_membership_cash_payment('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000065','40000000-0000-4000-8000-000000000011',2500,'GBP','cash-expired-receipt',current_date,period_start,period_end,current_date+31,'Synthetic verified counter receipt');
 if result->>'coverageNeedsReview'<>'true' then raise exception 'Expired membership cash result did not require coverage review'; end if;
 result:=public.club_record_verified_membership_cash_payment('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000065','40000000-0000-4000-8000-000000000011',2500,'GBP','cash-expired-receipt',current_date,period_start,period_end,current_date+31,'Synthetic verified counter receipt');
 if result->>'coverageNeedsReview'<>'true' then raise exception 'Idempotent expired cash result did not require coverage review'; end if;
 select item.value into billing_item
 from jsonb_array_elements(public.club_list_customer_billing('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000025')) item(value)
 where item.value->>'id'='40000000-0000-4000-8000-000000000066';
 if billing_item is null then raise exception 'Authorised billing projection did not return cancelled membership period'; end if;
 period_start:=((coalesce(billing_item->>'coverage_start_at',billing_item->>'next_due_at'))::timestamptz at time zone 'UTC')::date;
 if billing_item->>'coverage_end_at' is null then raise exception 'Cancelled membership billing projection omitted its scheduled coverage boundary'; end if;
 period_end:=((billing_item->>'coverage_end_at')::timestamptz at time zone 'UTC')::date-1;
 result:=public.club_record_verified_membership_cash_payment('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000066','40000000-0000-4000-8000-000000000012',2500,'GBP','cash-cancelled-receipt',current_date,period_start,period_end,current_date+31,'Synthetic verified counter receipt');
 if result->>'coverageNeedsReview'<>'true' then raise exception 'Cancelled membership cash result did not require coverage review'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claims','{}',true);

do $$
begin
 if (select status from public.club_memberships where id='40000000-0000-4000-8000-000000000041')<>'expired'
   or (select status from public.club_memberships where id='40000000-0000-4000-8000-000000000042')<>'cancelled' then raise exception 'Cash receipt resurrected an expired/cancelled membership'; end if;
 if (select ends_at from public.club_memberships where id='40000000-0000-4000-8000-000000000041')>now()
   or (select ends_at from public.club_memberships where id='40000000-0000-4000-8000-000000000042')>now() then raise exception 'Cash receipt changed membership coverage dates'; end if;
 if exists(select 1 from public.club_member_access_projection where customer_id in ('40000000-0000-4000-8000-000000000024','40000000-0000-4000-8000-000000000025') and access_allowed) then raise exception 'Cash receipt restored access for expired/cancelled membership'; end if;
 if (select count(*) from public.club_membership_billing_payments where provider_event_key='cash-expired-receipt')<>1
   or (select count(*) from public.club_membership_billing_obligations where arrangement_id='40000000-0000-4000-8000-000000000063')<>1 then raise exception 'Expired cash settlement created another period obligation'; end if;
 if (select count(*) from public.club_membership_billing_payments where provider_event_key='cash-cancelled-receipt')<>1
   or (select count(*) from public.club_membership_billing_obligations where arrangement_id='40000000-0000-4000-8000-000000000064')<>1 then raise exception 'Cancelled-member cash receipt created another period obligation'; end if;
 if not exists(select 1 from public.club_membership_billing_payments where provider_event_key='cash-expired-receipt' and receipt_date=current_date and billing_period_start is not null and billing_period_end>=billing_period_start and paid_through_date=current_date+31 and recorded_by='40000000-0000-4000-8000-000000000001' and verification_note='Synthetic verified counter receipt') then raise exception 'Cash audit evidence was incomplete'; end if;
end $$;

-- Verify direct authenticated access to restricted cash evidence remains denied.
set local role authenticated;
do $$ begin
 begin perform 1 from public.club_membership_billing_obligations where id='40000000-0000-4000-8000-000000000061';
   raise exception 'Authenticated user directly read protected billing obligations';
 exception when insufficient_privilege then null; end;
 begin perform 1 from public.club_membership_billing_arrangements where id='40000000-0000-4000-8000-000000000060';
   raise exception 'Authenticated user directly read protected billing arrangements';
 exception when insufficient_privilege then null; end;
 begin perform 1 from public.club_membership_billing_payments where provider_event_key='cash-expired-receipt';
   raise exception 'Authenticated user directly read protected cash evidence';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
