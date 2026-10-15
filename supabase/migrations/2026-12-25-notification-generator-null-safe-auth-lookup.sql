-- A missing optional Auth row must not leave a PL/pgSQL RECORD without a
-- descriptor. Keep monthly billing generation null-safe while preserving the
-- existing idempotent outbox and worker security boundary.
create or replace function public.club_generate_notification_intents()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o record; b record; d record; i record; manager record; v_email text; created integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'Notification generation requires service role' using errcode='42501'; end if;
  -- Existing join intent becomes the first bounded reminder only when due.
  update public.club_member_notification_intents n set state='pending',updated_at=now()
  from public.club_membership_join_requests r
  where n.join_request_id=r.id and n.template_key='join_incomplete' and n.state='unavailable'
    and n.not_before<=now() and r.status not in ('completed','cancelled');
  insert into public.club_member_notification_intents(
    organisation_id,user_id,target_email,join_request_id,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,reminder_number
  )
  select r.organisation_id,r.user_id,u.email,r.id,case when r.payment_state in ('payment_required','payment_pending','payment_failed','retry_required') then 'billing' else 'member_service' end,
    'join_incomplete','pending','join-reminder:'||r.id||':2',now(),case when r.payment_state in ('payment_required','payment_pending','payment_failed','retry_required') then 'billing' else 'members' end,jsonb_build_object('name','there','organisationId',r.organisation_id),2
  from public.club_membership_join_requests r join auth.users u on u.id=r.user_id
  where r.status not in ('completed','cancelled') and r.last_activity_at<=now()-interval '72 hours'
    and not exists(select 1 from public.club_member_notification_intents n where n.organisation_id=r.organisation_id and n.idempotency_key='join-reminder:'||r.id||':2')
    and exists(select 1 from public.club_member_notification_intents n where n.join_request_id=r.id and n.template_key='join_incomplete' and n.state='sent');
  -- Existing annual reminder intents become deliverable only when due.
  update public.club_member_notification_intents set state='pending',sender_purpose='billing',updated_at=now()
  where category='billing' and template_key in ('annual_renewal_1_month','annual_renewal_1_week','annual_renewal_final_days')
    and state='unavailable' and not_before<=now();
  -- Monthly dunning only; a missing optional Auth email is a normal null result,
  -- not an unassigned RECORD. The obligation is still authoritative and no send
  -- intent is created until an email address exists.
  for o in select o.*,a.frequency from public.club_membership_billing_obligations o join public.club_membership_billing_arrangements a on a.id=o.arrangement_id and a.organisation_id=o.organisation_id where o.state in ('failed','grace','retry_scheduled') and a.frequency='monthly' loop
    v_email:=null;
    select au.email into v_email from auth.users au where au.id=o.user_id;
    if v_email is not null then
      insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
      values(o.organisation_id,o.user_id,v_email,'billing','monthly_payment_failed','pending','monthly-payment-failed:'||o.id,now(),'billing',jsonb_build_object('name','there','organisationId',o.organisation_id,'obligationId',o.id),'billing_obligation',o.id) on conflict(organisation_id,idempotency_key) do nothing;
      created:=created+1;
    end if;
  end loop;
  -- Upcoming booked inductions receive one reminder, never a reminder for a cancelled booking.
  for b in select b.*,u.email from public.club_induction_bookings b join auth.users u on u.id=b.user_id where b.status='booked' and b.starts_at between now() and now()+interval '24 hours' loop
    insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
    values(b.organisation_id,b.user_id,b.email,'member_service','induction_reminder','pending','induction-reminder:'||b.id,b.starts_at,'members',jsonb_build_object('bookingId',b.id),'induction_booking',b.id) on conflict(organisation_id,idempotency_key) do nothing;
  end loop;
  -- Supplier collection events already have their own idempotent source event.
  for d in select e.*,u.email from public.club_notification_events e join auth.users u on u.id=e.user_id where e.event_type='order_ready_for_collection' and e.state='queued' loop
    insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
    values(d.organisation_id,d.user_id,d.email,'member_service','order_ready_for_collection','pending','order-ready:'||d.id,coalesce(d.scheduled_at,now()),'members',d.payload,'notification_event',d.id) on conflict(organisation_id,idempotency_key) do nothing;
  end loop;
  -- One alert per manager and unresolved issue; normal OK checks never enter here.
  for i in select i.*,l.name location_name,a.name asset_name from public.club_maintenance_issues i left join public.club_locations l on l.id=i.location_id and l.organisation_id=i.organisation_id left join public.club_equipment_assets a on a.id=i.asset_id and a.organisation_id=i.organisation_id where i.status not in ('resolved','closed') and (i.out_of_service or i.priority in ('high','urgent')) loop
    for manager in select m.user_id,au.email from public.club_members m join auth.users au on au.id=m.user_id where m.organisation_id=i.organisation_id and m.active and m.role in ('owner','gym_admin') loop
      insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
      values(i.organisation_id,manager.user_id,manager.email,'maintenance','maintenance_escalation','pending','maintenance:'||i.id||':'||manager.user_id,now(),'staff',jsonb_build_object('organisationId',i.organisation_id,'organisationName',(select name from public.club_organisations where id=i.organisation_id),'locationName',i.location_name,'assetName',i.asset_name,'priority',i.priority),'maintenance_issue',i.id) on conflict(organisation_id,idempotency_key) do nothing;
    end loop;
  end loop;
  update public.club_member_notification_intents n set state='cancelled',updated_at=now()
  where n.template_key in ('monthly_payment_failed','maintenance_escalation','annual_renewal_1_month','annual_renewal_1_week','annual_renewal_final_days') and n.state in ('pending','scheduled','failed','unavailable')
    and ((n.template_key='monthly_payment_failed' and not exists(select 1 from public.club_membership_billing_obligations o where o.id=n.related_id and o.state in ('failed','grace','retry_scheduled')))
      or (n.template_key='maintenance_escalation' and not exists(select 1 from public.club_maintenance_issues i where i.id=n.related_id and i.status not in ('resolved','closed') and (i.out_of_service or i.priority in ('high','urgent'))))
      or (n.template_key like 'annual_renewal%' and exists(select 1 from public.club_membership_join_requests r join public.club_memberships original on original.id=r.membership_id and original.organisation_id=r.organisation_id join public.club_membership_holders h on h.membership_id=original.id and h.user_id=r.user_id join public.club_memberships newer on newer.organisation_id=r.organisation_id and newer.starts_at>original.starts_at join public.club_membership_holders hn on hn.membership_id=newer.id and hn.user_id=h.user_id where r.id=n.join_request_id)));
  return jsonb_build_object('created',created);
end; $$;
revoke all on function public.club_generate_notification_intents() from public,anon,authenticated;
grant execute on function public.club_generate_notification_intents() to service_role;
