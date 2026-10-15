-- Disposable PostgreSQL test for the notification claim gate and retry path.
begin;
insert into public.club_organisations(id,name,slug) values
 ('30000000-0000-4000-8000-000000000001','Notification launch test','notification-launch-test');
insert into public.club_member_notification_intents(
  id,organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload
) values
 ('30000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000001',null,'staff@example.test','staff','staff_invitation','pending','test-staff-invite',now()-interval '1 minute','staff','{}'),
 ('30000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000001',null,'member@example.test','member_service','member_activation','pending','test-member-activation',now(),'members','{}');

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare claimed integer;
begin
  select count(*) into claimed from public.club_claim_notification_intents_for_worker(100,'ci-notification-worker',false);
  if claimed<>1 then raise exception 'Default claim should process staff mail but hold member activation'; end if;
  if (select state from public.club_member_notification_intents where id='30000000-0000-4000-8000-000000000012')<>'pending' then
    raise exception 'Member activation was claimed before its explicit release';
  end if;
  if (select count(*) from public.club_claim_notification_intents_for_worker(100,'ci-notification-worker-repeat',false))<>0 then
    raise exception 'Repeat worker run claimed a message that already had an active lease';
  end if;

  perform public.club_fail_notification_intent('30000000-0000-4000-8000-000000000011','smtp_451','Temporary relay rejection',now(),'failed');
  if (select state from public.club_member_notification_intents where id='30000000-0000-4000-8000-000000000011')<>'scheduled' then
    raise exception 'Retryable SMTP failure was not returned to the scheduled path';
  end if;
  if (select count(*) from public.club_claim_notification_intents_for_worker(100,'ci-notification-worker-retry',false))<>1 then
    raise exception 'Retryable staff notification was not claimable again';
  end if;
  if (select count(*) from public.club_claim_notification_intents_for_worker(100,'ci-notification-worker-release',true))<>1 then
    raise exception 'Explicit release did not make the member activation claimable';
  end if;
  perform public.club_complete_notification_intent('30000000-0000-4000-8000-000000000011','ci-staff-sent');
  perform public.club_complete_notification_intent('30000000-0000-4000-8000-000000000012','ci-member-sent');
  if exists(select 1 from public.club_member_notification_intents where id in ('30000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000012') and state<>'sent') then
    raise exception 'Notification completion did not persist the terminal sent state';
  end if;
end $$;
reset role;
rollback;
