-- Keep PL/pgSQL loop records distinct from SQL table aliases. In particular,
-- the final cancellation query runs even when the monthly billing loop returns
-- zero rows; reusing `o` as both its loop record and a subquery alias could
-- resolve `o.id` as a read from an unassigned PL/pgSQL record.
create or replace function public.club_generate_notification_intents()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  billing_row record;
  booking_row record;
  event_row record;
  issue_row record;
  manager_row record;
  v_email text;
  created integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'Notification generation requires service role' using errcode='42501'; end if;

  update public.club_member_notification_intents intent set state='pending',updated_at=now()
  from public.club_membership_join_requests join_request
  where intent.join_request_id=join_request.id and intent.template_key='join_incomplete' and intent.state='unavailable'
    and intent.not_before<=now() and join_request.status not in ('completed','cancelled');

  insert into public.club_member_notification_intents(
    organisation_id,user_id,target_email,join_request_id,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,reminder_number
  )
  select join_request.organisation_id,join_request.user_id,account.email,join_request.id,
    case when join_request.payment_state in ('payment_required','payment_pending','payment_failed','retry_required') then 'billing' else 'member_service' end,
    'join_incomplete','pending','join-reminder:'||join_request.id||':2',now(),
    case when join_request.payment_state in ('payment_required','payment_pending','payment_failed','retry_required') then 'billing' else 'members' end,
    jsonb_build_object('name','there','organisationId',join_request.organisation_id),2
  from public.club_membership_join_requests join_request
  join auth.users account on account.id=join_request.user_id
  where join_request.status not in ('completed','cancelled')
    and join_request.last_activity_at<=now()-interval '72 hours'
    and not exists(select 1 from public.club_member_notification_intents existing_intent
      where existing_intent.organisation_id=join_request.organisation_id
        and existing_intent.idempotency_key='join-reminder:'||join_request.id||':2')
    and exists(select 1 from public.club_member_notification_intents sent_intent
      where sent_intent.join_request_id=join_request.id and sent_intent.template_key='join_incomplete' and sent_intent.state='sent');

  update public.club_member_notification_intents intent set state='pending',sender_purpose='billing',updated_at=now()
  where intent.category='billing'
    and intent.template_key in ('annual_renewal_1_month','annual_renewal_1_week','annual_renewal_final_days')
    and intent.state='unavailable' and intent.not_before<=now();

  for billing_row in
    select billing_source.*,billing_arrangement.frequency
    from public.club_membership_billing_obligations billing_source
    join public.club_membership_billing_arrangements billing_arrangement
      on billing_arrangement.id=billing_source.arrangement_id
      and billing_arrangement.organisation_id=billing_source.organisation_id
    where billing_source.state in ('failed','grace','retry_scheduled')
      and billing_arrangement.frequency='monthly'
  loop
    v_email:=null;
    select account.email into v_email from auth.users account where account.id=billing_row.user_id;
    if v_email is not null then
      insert into public.club_member_notification_intents(
        organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id
      ) values(
        billing_row.organisation_id,billing_row.user_id,v_email,'billing','monthly_payment_failed','pending',
        'monthly-payment-failed:'||billing_row.id,now(),'billing',
        jsonb_build_object('name','there','organisationId',billing_row.organisation_id,'obligationId',billing_row.id),
        'billing_obligation',billing_row.id
      ) on conflict(organisation_id,idempotency_key) do nothing;
      created:=created+1;
    end if;
  end loop;

  for booking_row in
    select booking_source.*,account.email
    from public.club_induction_bookings booking_source
    join auth.users account on account.id=booking_source.user_id
    where booking_source.status='booked' and booking_source.starts_at between now() and now()+interval '24 hours'
  loop
    insert into public.club_member_notification_intents(
      organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id
    ) values(
      booking_row.organisation_id,booking_row.user_id,booking_row.email,'member_service','induction_reminder','pending',
      'induction-reminder:'||booking_row.id,booking_row.starts_at,'members',jsonb_build_object('bookingId',booking_row.id),
      'induction_booking',booking_row.id
    ) on conflict(organisation_id,idempotency_key) do nothing;
  end loop;

  for event_row in
    select source_event.*,account.email
    from public.club_notification_events source_event
    join auth.users account on account.id=source_event.user_id
    where source_event.event_type='order_ready_for_collection' and source_event.state='queued'
  loop
    insert into public.club_member_notification_intents(
      organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id
    ) values(
      event_row.organisation_id,event_row.user_id,event_row.email,'member_service','order_ready_for_collection','pending',
      'order-ready:'||event_row.id,coalesce(event_row.scheduled_at,now()),'members',event_row.payload,
      'notification_event',event_row.id
    ) on conflict(organisation_id,idempotency_key) do nothing;
  end loop;

  for issue_row in
    select maintenance_issue.*,location.name location_name,asset.name asset_name
    from public.club_maintenance_issues maintenance_issue
    left join public.club_locations location
      on location.id=maintenance_issue.location_id and location.organisation_id=maintenance_issue.organisation_id
    left join public.club_equipment_assets asset
      on asset.id=maintenance_issue.asset_id and asset.organisation_id=maintenance_issue.organisation_id
    where maintenance_issue.status not in ('resolved','closed')
      and (maintenance_issue.out_of_service or maintenance_issue.priority in ('high','urgent'))
  loop
    for manager_row in
      select member.user_id,account.email
      from public.club_members member
      join auth.users account on account.id=member.user_id
      where member.organisation_id=issue_row.organisation_id and member.active and member.role in ('owner','gym_admin')
    loop
      insert into public.club_member_notification_intents(
        organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id
      ) values(
        issue_row.organisation_id,manager_row.user_id,manager_row.email,'maintenance','maintenance_escalation','pending',
        'maintenance:'||issue_row.id||':'||manager_row.user_id,now(),'staff',
        jsonb_build_object('organisationId',issue_row.organisation_id,
          'organisationName',(select organisation.name from public.club_organisations organisation where organisation.id=issue_row.organisation_id),
          'locationName',issue_row.location_name,'assetName',issue_row.asset_name,'priority',issue_row.priority),
        'maintenance_issue',issue_row.id
      ) on conflict(organisation_id,idempotency_key) do nothing;
    end loop;
  end loop;

  update public.club_member_notification_intents intent set state='cancelled',updated_at=now()
  where intent.template_key in ('monthly_payment_failed','maintenance_escalation','annual_renewal_1_month','annual_renewal_1_week','annual_renewal_final_days')
    and intent.state in ('pending','scheduled','failed','unavailable')
    and ((intent.template_key='monthly_payment_failed' and not exists(
        select 1 from public.club_membership_billing_obligations current_obligation
        where current_obligation.id=intent.related_id and current_obligation.state in ('failed','grace','retry_scheduled')))
      or (intent.template_key='maintenance_escalation' and not exists(
        select 1 from public.club_maintenance_issues current_issue
        where current_issue.id=intent.related_id and current_issue.status not in ('resolved','closed')
          and (current_issue.out_of_service or current_issue.priority in ('high','urgent'))))
      or (intent.template_key like 'annual_renewal%' and exists(
        select 1
        from public.club_membership_join_requests join_request
        join public.club_memberships original_membership
          on original_membership.id=join_request.membership_id
          and original_membership.organisation_id=join_request.organisation_id
        join public.club_membership_holders original_holder
          on original_holder.membership_id=original_membership.id and original_holder.user_id=join_request.user_id
        join public.club_memberships newer_membership
          on newer_membership.organisation_id=join_request.organisation_id
          and newer_membership.starts_at>original_membership.starts_at
        join public.club_membership_holders newer_holder
          on newer_holder.membership_id=newer_membership.id and newer_holder.user_id=original_holder.user_id
        where join_request.id=intent.join_request_id)));

  return jsonb_build_object('created',created);
end; $$;
revoke all on function public.club_generate_notification_intents() from public,anon,authenticated;
grant execute on function public.club_generate_notification_intents() to service_role;
