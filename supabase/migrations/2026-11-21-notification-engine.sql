-- Durable, provider-neutral transactional notification outbox.
-- Delivery is deliberately separate from membership/access authority.

alter table public.club_member_notification_intents
  alter column user_id drop not null,
  add column if not exists target_email text,
  add column if not exists sender_purpose text not null default 'members',
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists related_type text,
  add column if not exists related_id uuid,
  add column if not exists attempts integer not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists failure_code text,
  add column if not exists failure_message text,
  add column if not exists claimed_by text,
  add column if not exists claimed_until timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists reminder_number integer not null default 1;

alter table public.club_member_notification_intents drop constraint if exists club_member_notification_intents_category_check;
alter table public.club_member_notification_intents add constraint club_member_notification_intents_category_check check (category in ('member_service','billing','staff','maintenance'));
alter table public.club_member_notification_intents drop constraint if exists club_member_notification_intents_state_check;
alter table public.club_member_notification_intents add constraint club_member_notification_intents_state_check check (state in ('pending','scheduled','processing','unavailable','sent','failed','cancelled'));
alter table public.club_member_notification_intents drop constraint if exists club_member_notification_intents_sender_purpose_check;
alter table public.club_member_notification_intents add constraint club_member_notification_intents_sender_purpose_check check (sender_purpose in ('members','billing','staff'));
update public.club_member_notification_intents n set target_email=u.email, updated_at=now()
from auth.users u where u.id=n.user_id and n.target_email is null;
update public.club_member_notification_intents set idempotency_key=idempotency_key||':1', reminder_number=1
where template_key='join_incomplete' and idempotency_key not like '%:1' and idempotency_key not like '%:2';
update public.club_member_notification_intents set sender_purpose=case when category='billing' then 'billing' else 'members' end;
create index if not exists club_member_notification_intents_due_idx on public.club_member_notification_intents(state,not_before,claimed_until);
create index if not exists club_member_notification_intents_related_idx on public.club_member_notification_intents(organisation_id,related_type,related_id);
revoke all on table public.club_member_notification_intents from public,anon,authenticated;

create or replace function public.club_queue_staff_invitation_notification()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  insert into public.club_member_notification_intents(
    organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,
    sender_purpose,payload,related_type,related_id
  ) values(
    new.organisation_id,null,new.email_normalized,'staff','staff_invitation','pending',
    'staff-invitation:'||new.id,now(),'staff',jsonb_build_object(
      'grantId',new.id,'email',new.email_normalized,'name',new.display_name,
      'role',new.intended_role,'organisationName',(select name from public.club_organisations where id=new.organisation_id)
    ),'staff_access_grant',new.id
  ) on conflict (organisation_id,idempotency_key) do update set
    target_email=excluded.target_email,payload=excluded.payload,updated_at=now()
    where public.club_member_notification_intents.state not in ('sent','processing');
  return new;
end; $$;
drop trigger if exists club_staff_grant_notification on public.club_staff_access_grants;
create trigger club_staff_grant_notification after insert on public.club_staff_access_grants
for each row execute function public.club_queue_staff_invitation_notification();

create or replace function public.club_cancel_staff_invitation_notification()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status in ('revoked','expired') then
    update public.club_member_notification_intents set state='cancelled',updated_at=now()
    where organisation_id=new.organisation_id and related_type='staff_access_grant' and related_id=new.id
      and state in ('pending','scheduled','failed','unavailable');
  end if;
  return new;
end; $$;
drop trigger if exists club_staff_grant_notification_cancel on public.club_staff_access_grants;
create trigger club_staff_grant_notification_cancel after update of status on public.club_staff_access_grants
for each row execute function public.club_cancel_staff_invitation_notification();

create or replace function public.club_resend_staff_invitation(p_organisation_id uuid,p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare g public.club_staff_access_grants%rowtype; n public.club_member_notification_intents%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then raise exception 'Staff invitation management is not permitted' using errcode='42501'; end if;
  select * into g from public.club_staff_access_grants where id=p_grant_id and organisation_id=p_organisation_id and status='pending' and expires_at>now() for share;
  if not found then raise exception 'Pending staff invitation not found' using errcode='P0002'; end if;
  update public.club_member_notification_intents set state='pending',not_before=now(),failure_code=null,failure_message=null,claimed_by=null,claimed_until=null,updated_at=now()
    where organisation_id=p_organisation_id and related_type='staff_access_grant' and related_id=g.id and state not in ('processing','cancelled') returning * into n;
  if n.id is null then raise exception 'Staff invitation notification not found' using errcode='P0002'; end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    select p_organisation_id,auth.uid(),m.role,'staff.invitation_resent','staff_access_grant',g.id,jsonb_build_object('notification_id',n.id)
    from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active;
  return jsonb_build_object('id',n.id,'state',n.state);
end; $$;
revoke all on function public.club_resend_staff_invitation(uuid,uuid) from public,anon;
grant execute on function public.club_resend_staff_invitation(uuid,uuid) to authenticated;

create or replace function public.club_list_staff_invitation_notifications(p_organisation_id uuid)
returns table(grant_id uuid,state text,attempts integer,last_attempt_at timestamptz,sent_at timestamptz,failure_code text)
language sql stable security definer set search_path=pg_catalog,public as $$
  select n.related_id,n.state,n.attempts,n.last_attempt_at,n.sent_at,n.failure_code
  from public.club_member_notification_intents n
  where n.organisation_id=p_organisation_id and n.related_type='staff_access_grant'
    and public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage');
$$;
revoke all on function public.club_list_staff_invitation_notifications(uuid) from public,anon;
grant execute on function public.club_list_staff_invitation_notifications(uuid) to authenticated;

create or replace function public.club_queue_member_activation_notification(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; n public.club_member_notification_intents%rowtype; actor_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.link_account') then raise exception 'Member activation notification is not permitted' using errcode='42501'; end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id for share;
  if not found or nullif(btrim(c.email),'') is null or c.user_id is not null then raise exception 'Member activation is not eligible' using errcode='22023'; end if;
  insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
    values(p_organisation_id,null,lower(btrim(c.email)),'member_service','member_activation','pending','member-activation:'||c.id,now(),'members',jsonb_build_object('name',c.display_name,'customerId',c.id),'customer',c.id)
    on conflict(organisation_id,idempotency_key) do update set target_email=excluded.target_email,payload=excluded.payload,updated_at=now() returning * into n;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    values(p_organisation_id,auth.uid(),actor_role,'member.activation_notification_queued','customer',c.id,jsonb_build_object('notification_id',n.id));
  return jsonb_build_object('id',n.id,'state',n.state);
end; $$;
revoke all on function public.club_queue_member_activation_notification(uuid,uuid) from public,anon;
grant execute on function public.club_queue_member_activation_notification(uuid,uuid) to authenticated;

create or replace function public.club_claim_notification_intents(p_limit integer,p_worker_id text)
returns setof public.club_member_notification_intents language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.role()<>'service_role' then raise exception 'Notification worker requires service role' using errcode='42501'; end if;
  return query
    with candidates as (
      select id from public.club_member_notification_intents
      where target_email is not null and state in ('pending','scheduled','failed')
        and not_before<=now() and (claimed_until is null or claimed_until<now())
      order by not_before,created_at limit greatest(1,least(coalesce(p_limit,25),100)) for update skip locked
    )
    update public.club_member_notification_intents n set state='processing',attempts=n.attempts+1,
      last_attempt_at=now(),claimed_by=p_worker_id,claimed_until=now()+interval '10 minutes',updated_at=now()
    from candidates c where n.id=c.id returning n.*;
end; $$;
revoke all on function public.club_claim_notification_intents(integer,text) from public,anon,authenticated;
grant execute on function public.club_claim_notification_intents(integer,text) to service_role;

create or replace function public.club_complete_notification_intent(p_id uuid,p_provider_reference text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.role()<>'service_role' then raise exception 'Notification worker requires service role' using errcode='42501'; end if;
  update public.club_member_notification_intents set state='sent',provider_reference=p_provider_reference,sent_at=now(),claimed_until=null,updated_at=now() where id=p_id and state='processing';
end; $$;
revoke all on function public.club_complete_notification_intent(uuid,text) from public,anon,authenticated;
grant execute on function public.club_complete_notification_intent(uuid,text) to service_role;

create or replace function public.club_fail_notification_intent(p_id uuid,p_code text,p_message text,p_retry_at timestamptz,p_terminal_state text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.role()<>'service_role' or p_terminal_state not in ('failed','unavailable') then raise exception 'Invalid notification failure' using errcode='42501'; end if;
  update public.club_member_notification_intents set state=case when p_retry_at is null then p_terminal_state else 'scheduled' end,
    not_before=coalesce(p_retry_at,not_before),failure_code=left(p_code,120),failure_message=left(p_message,500),claimed_until=null,updated_at=now() where id=p_id and state='processing';
end; $$;
revoke all on function public.club_fail_notification_intent(uuid,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.club_fail_notification_intent(uuid,text,text,timestamptz,text) to service_role;

-- Materialise provider-neutral intents from durable domain state. This function is
-- service-role only so browser input cannot choose recipients, templates, or senders.
create or replace function public.club_generate_notification_intents()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o record; b record; d record; i record; u record; created integer:=0;
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
  -- Monthly dunning only; non-recurring products never enter this branch.
  for o in select o.*,a.frequency from public.club_membership_billing_obligations o join public.club_membership_billing_arrangements a on a.id=o.arrangement_id and a.organisation_id=o.organisation_id where o.state in ('failed','grace','retry_scheduled') and a.frequency='monthly' loop
    select email into u from auth.users where id=o.user_id;
    if u.email is not null then
      insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
      values(o.organisation_id,o.user_id,u.email,'billing','monthly_payment_failed','pending','monthly-payment-failed:'||o.id,now(),'billing',jsonb_build_object('name','there','organisationId',o.organisation_id,'obligationId',o.id),'billing_obligation',o.id) on conflict(organisation_id,idempotency_key) do nothing;
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
    for u in select m.user_id,au.email from public.club_members m join auth.users au on au.id=m.user_id where m.organisation_id=i.organisation_id and m.active and m.role in ('owner','gym_admin') loop
      insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
      values(i.organisation_id,u.user_id,u.email,'maintenance','maintenance_escalation','pending','maintenance:'||i.id||':'||u.user_id,now(),'staff',jsonb_build_object('organisationId',i.organisation_id,'organisationName',(select name from public.club_organisations where id=i.organisation_id),'locationName',i.location_name,'assetName',i.asset_name,'priority',i.priority),'maintenance_issue',i.id) on conflict(organisation_id,idempotency_key) do nothing;
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
