-- Disposable PostgreSQL regression for notification generation after a queued
-- staff invitation and member activation. No mail is sent by this SQL test.
begin;
insert into public.club_organisations(id,name,slug) values
 ('30000000-0000-4000-8000-000000000002','Notification generation test','notification-generation-test');
insert into auth.users(id,email) values
 ('30000000-0000-4000-8000-000000000021','existing-staff@example.test');

-- A staff invitation is email-addressed whether or not the recipient already
-- has an R12 Auth account. Member activation is also intentionally unlinked.
insert into public.club_member_notification_intents(
  id,organisation_id,user_id,target_email,category,template_key,state,idempotency_key,
  not_before,sender_purpose,payload,related_type,related_id
) values
 ('30000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000002',null,'new-staff@example.test','staff','staff_invitation','pending','generation-staff-unlinked',now(),'staff','{}','staff_access_grant','30000000-0000-4000-8000-000000000041'),
 ('30000000-0000-4000-8000-000000000032','30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000021','existing-staff@example.test','staff','staff_invitation','pending','generation-staff-linked',now(),'staff','{}','staff_access_grant','30000000-0000-4000-8000-000000000042'),
 ('30000000-0000-4000-8000-000000000033','30000000-0000-4000-8000-000000000002',null,'member@example.test','member_service','member_activation','pending','generation-member-activation',now(),'members','{}','customer','30000000-0000-4000-8000-000000000043');
insert into public.club_member_notification_intents(
  id,organisation_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,related_type,related_id
) values (
 '30000000-0000-4000-8000-000000000034','30000000-0000-4000-8000-000000000002','former-member@example.test',
 'billing','monthly_payment_failed','pending','generation-stale-billing-intent',now(),'billing',
 'billing_obligation','30000000-0000-4000-8000-000000000099'
);

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare
  missing_auth_email text;
  before_count integer;
  after_count integer;
begin
  -- This models the optional Auth lookup in monthly dunning: no row is a null
  -- scalar value, never an unassigned RECORD access.
  select au.email into missing_auth_email from auth.users au
    where au.id='30000000-0000-4000-8000-000000000099';
  if missing_auth_email is not null then
    raise exception 'Missing optional Auth lookup unexpectedly returned an email';
  end if;

  -- The production failure occurred after a zero-row billing FOR loop, when
  -- the final stale-intent cleanup referenced SQL alias `o` shadowed by that
  -- unassigned PL/pgSQL record. Keep this first call obligation-free.
  if (select count(*) from public.club_membership_billing_obligations
      where organisation_id='30000000-0000-4000-8000-000000000002')<>0 then
    raise exception 'Zero-obligation generation fixture unexpectedly has billing rows';
  end if;
  perform public.club_generate_notification_intents();
  if (select state from public.club_member_notification_intents where id='30000000-0000-4000-8000-000000000034')<>'cancelled' then
    raise exception 'Generator did not safely cancel a billing intent whose source obligation is missing';
  end if;

  select count(*) into before_count from public.club_member_notification_intents
    where id in ('30000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000032','30000000-0000-4000-8000-000000000033');
  if before_count<>3 then raise exception 'Staff/member notification fixtures were not present'; end if;

  perform public.club_generate_notification_intents();

  select count(*) into after_count from public.club_member_notification_intents
    where id in ('30000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000032','30000000-0000-4000-8000-000000000033');
  if after_count<>before_count then raise exception 'Repeated generation changed existing staff/member intents'; end if;
  if (select count(*) from public.club_member_notification_intents where organisation_id='30000000-0000-4000-8000-000000000002' and idempotency_key in ('generation-staff-unlinked','generation-staff-linked','generation-member-activation'))<>3 then
    raise exception 'Repeated generation created duplicate intents';
  end if;
  if not exists(select 1 from public.club_member_notification_intents where id='30000000-0000-4000-8000-000000000031' and target_email='new-staff@example.test' and user_id is null)
     or not exists(select 1 from public.club_member_notification_intents where id='30000000-0000-4000-8000-000000000032' and target_email='existing-staff@example.test' and user_id='30000000-0000-4000-8000-000000000021')
     or not exists(select 1 from public.club_member_notification_intents where id='30000000-0000-4000-8000-000000000033' and target_email='member@example.test' and template_key='member_activation' and user_id is null) then
    raise exception 'Staff invite or member activation recipient was changed by generation';
  end if;
end $$;
reset role;

-- A real monthly obligation remains eligible for generated dunning mail and
-- the same stable key prevents duplicate billing intents on repeated runs.
insert into public.club_products(id,organisation_id,name,kind,price_minor,currency,billing)
values('30000000-0000-4000-8000-000000000051','30000000-0000-4000-8000-000000000002','CI Monthly Membership','membership',5000,'GBP','recurring');
insert into public.club_memberships(id,organisation_id,product_id,status,starts_at,source)
values('30000000-0000-4000-8000-000000000052','30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000051','active',now(),'test');
insert into public.club_membership_holders(membership_id,user_id)
values('30000000-0000-4000-8000-000000000052','30000000-0000-4000-8000-000000000021');
insert into public.club_membership_billing_arrangements(
  id,organisation_id,membership_id,user_id,amount_minor,currency,frequency,next_due_at
) values (
 '30000000-0000-4000-8000-000000000053','30000000-0000-4000-8000-000000000002',
 '30000000-0000-4000-8000-000000000052','30000000-0000-4000-8000-000000000021',5000,'GBP','monthly',now()
);
insert into public.club_membership_billing_obligations(
  id,organisation_id,arrangement_id,membership_id,user_id,amount_minor,currency,frequency,next_due_at,period_key,state
) values (
 '30000000-0000-4000-8000-000000000054','30000000-0000-4000-8000-000000000002',
 '30000000-0000-4000-8000-000000000053','30000000-0000-4000-8000-000000000052',
 '30000000-0000-4000-8000-000000000021',5000,'GBP','monthly',now(),'ci-monthly-dunning-period','failed'
);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare generated_count integer;
begin
  perform public.club_generate_notification_intents();
  perform public.club_generate_notification_intents();
  select count(*) into generated_count from public.club_member_notification_intents
    where organisation_id='30000000-0000-4000-8000-000000000002'
      and idempotency_key='monthly-payment-failed:30000000-0000-4000-8000-000000000054'
      and target_email='existing-staff@example.test' and related_id='30000000-0000-4000-8000-000000000054';
  if generated_count<>1 then raise exception 'Monthly dunning generation was not idempotent with an eligible obligation'; end if;
end $$;
reset role;
rollback;
