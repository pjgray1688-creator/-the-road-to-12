-- Launch support: member-import activation outbox hook, explicit member resend,
-- and auditable owner transfer. No mail is sent by these database functions.

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
      'role',new.intended_role,'organisationName',(select name from public.club_organisations where id=new.organisation_id),
      'inviterName',(select nullif(btrim(concat_ws(' ',u.raw_user_meta_data->>'first_name',u.raw_user_meta_data->>'last_name')),'') from auth.users u where u.id=new.created_by),
      'venueNames',coalesce((select jsonb_agg(l.name order by l.name) from public.club_locations l
        where l.organisation_id=new.organisation_id and l.id=any(new.location_ids)), '[]'::jsonb),
      'expiresAt',new.expires_at
    ),'staff_access_grant',new.id
  ) on conflict (organisation_id,idempotency_key) do update set
    target_email=excluded.target_email,payload=excluded.payload,updated_at=now()
    where public.club_member_notification_intents.state not in ('sent','processing');
  return new;
end; $$;

create or replace function public.club_queue_member_import_activations(
  p_organisation_id uuid,
  p_batch_id uuid
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  b public.club_member_import_batches%rowtype;
  r record;
  status text;
  queued integer:=0;
  already_linked integer:=0;
  missing_email integer:=0;
  already_invited integer:=0;
  queue_failed integer:=0;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then
    raise exception 'Member import notification access is not permitted' using errcode='42501';
  end if;
  select * into b from public.club_member_import_batches
    where id=p_batch_id and organisation_id=p_organisation_id for share;
  if not found or b.status<>'completed' then
    raise exception 'Only a successfully completed import can queue account activation' using errcode='22023';
  end if;

  for r in
    select distinct c.id customer_id,c.user_id,c.email,c.display_name
    from public.club_member_import_rows ir
    join public.club_customers c on c.id=ir.imported_customer_id and c.organisation_id=ir.organisation_id
    where ir.batch_id=b.id and ir.organisation_id=p_organisation_id
      and ir.outcome in ('imported','linked')
  loop
    if r.user_id is not null then
      already_linked:=already_linked+1;
      continue;
    end if;
    if nullif(btrim(r.email),'') is null then
      missing_email:=missing_email+1;
      continue;
    end if;
    begin
      insert into public.club_member_notification_intents(
        organisation_id,user_id,target_email,category,template_key,state,idempotency_key,
        not_before,sender_purpose,payload,related_type,related_id
      ) values(
        p_organisation_id,null,lower(btrim(r.email)),'member_service','member_activation','pending',
        'member-activation:'||r.customer_id,now(),'members',
        jsonb_build_object('name',r.display_name,'customerId',r.customer_id,
          'organisationName',(select o.name from public.club_organisations o where o.id=p_organisation_id)),
        'customer',r.customer_id
      ) on conflict(organisation_id,idempotency_key) do nothing;
      if found then queued:=queued+1; else already_invited:=already_invited+1; end if;
    exception when others then
      -- Notification queue errors must not make a completed membership import fail.
      queue_failed:=queue_failed+1;
    end;
  end loop;

  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  select p_organisation_id,auth.uid(),m.role,'member_import.activation_notifications_queued',
    'member_import_batch',b.id,jsonb_build_object('queued',queued,'already_linked',already_linked,
      'missing_email',missing_email,'already_invited',already_invited,'queue_failed',queue_failed)
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active;

  return jsonb_build_object('queued',queued,'alreadyLinked',already_linked,
    'missingEmail',missing_email,'alreadyInvited',already_invited,'failed',queue_failed);
end; $$;
revoke all on function public.club_queue_member_import_activations(uuid,uuid) from public,anon;
grant execute on function public.club_queue_member_import_activations(uuid,uuid) to authenticated;

create or replace function public.club_resend_member_activation_notification(
  p_organisation_id uuid,
  p_customer_id uuid
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; n public.club_member_notification_intents%rowtype; actor_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.link_account') then
    raise exception 'Member activation notification is not permitted' using errcode='42501';
  end if;
  select * into c from public.club_customers
    where id=p_customer_id and organisation_id=p_organisation_id for update;
  if not found or c.user_id is not null or nullif(btrim(c.email),'') is null then
    raise exception 'Member is not eligible for account activation' using errcode='22023';
  end if;
  insert into public.club_member_notification_intents(
    organisation_id,user_id,target_email,category,template_key,state,idempotency_key,
    not_before,sender_purpose,payload,related_type,related_id
  ) values(
    p_organisation_id,null,lower(btrim(c.email)),'member_service','member_activation','pending',
    'member-activation:'||c.id,now(),'members',
    jsonb_build_object('name',c.display_name,'customerId',c.id,
      'organisationName',(select o.name from public.club_organisations o where o.id=p_organisation_id)),
    'customer',c.id
  ) on conflict(organisation_id,idempotency_key) do update set
    target_email=excluded.target_email,payload=excluded.payload,state='pending',not_before=now(),
    failure_code=null,failure_message=null,claimed_by=null,claimed_until=null,updated_at=now()
  where public.club_member_notification_intents.state not in ('processing','cancelled')
  returning * into n;
  if n.id is null then raise exception 'Activation email is already being processed or was cancelled' using errcode='55000'; end if;
  select role into actor_role from public.club_members
    where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  values(p_organisation_id,auth.uid(),actor_role,'member.activation_notification_resent',
    'customer',c.id,jsonb_build_object('notification_id',n.id));
  return jsonb_build_object('id',n.id,'state',n.state);
end; $$;
revoke all on function public.club_resend_member_activation_notification(uuid,uuid) from public,anon;
grant execute on function public.club_resend_member_activation_notification(uuid,uuid) to authenticated;

-- Keep large membership-base activation sends behind an explicit server-only
-- release switch while staff invites and other transactional mail can proceed.
create or replace function public.club_claim_notification_intents_for_worker(
  p_limit integer,
  p_worker_id text,
  p_include_member_activation boolean default false
) returns setof public.club_member_notification_intents
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.role()<>'service_role' then raise exception 'Notification worker requires service role' using errcode='42501'; end if;
  update public.club_member_notification_intents
  set state=case when attempts>=3 then 'failed' else 'scheduled' end,
      not_before=case when attempts>=3 then not_before else now() end,
      failure_code=case when attempts>=3 then 'claim_lease_expired_max_attempts' else 'claim_lease_expired' end,
      failure_message=case when attempts>=3 then 'Delivery claim expired after the maximum attempts; manual review is required.' else 'Delivery claim expired before completion; the notification was safely rescheduled.' end,
      claimed_by=null,claimed_until=null,updated_at=now()
  where state='processing' and (claimed_until is null or claimed_until<=now());
  return query
    with candidates as (
      select id from public.club_member_notification_intents
      where target_email is not null and state in ('pending','scheduled') and attempts<3 and not_before<=now()
        and (p_include_member_activation or template_key<>'member_activation')
      order by not_before,created_at limit greatest(1,least(coalesce(p_limit,25),100)) for update skip locked
    )
    update public.club_member_notification_intents n set state='processing',attempts=n.attempts+1,
      last_attempt_at=now(),claimed_by=p_worker_id,claimed_until=now()+interval '10 minutes',updated_at=now()
    from candidates c where n.id=c.id returning n.*;
end; $$;
revoke all on function public.club_claim_notification_intents_for_worker(integer,text,boolean) from public,anon,authenticated;
grant execute on function public.club_claim_notification_intents_for_worker(integer,text,boolean) to service_role;

create or replace function public.club_transfer_organisation_owner(
  p_organisation_id uuid,
  p_new_owner_user_id uuid
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  current_owner public.club_members%rowtype;
  new_owner public.club_members%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to transfer organisation ownership' using errcode='42501'; end if;
  if p_new_owner_user_id is null or p_new_owner_user_id=auth.uid() then
    raise exception 'Choose another active staff member; self-transfer is not allowed' using errcode='22023';
  end if;
  perform 1 from public.club_organisations where id=p_organisation_id and active for update;
  if not found then raise exception 'Organisation not found or inactive' using errcode='P0002'; end if;
  select * into current_owner from public.club_members
    where organisation_id=p_organisation_id and user_id=auth.uid() and active and role='owner' for update;
  if not found then raise exception 'Only the current active Owner can transfer ownership' using errcode='42501'; end if;
  select * into new_owner from public.club_members
    where organisation_id=p_organisation_id and user_id=p_new_owner_user_id and active
      and role in ('gym_admin','gym_staff','trainer','member') for update;
  if not found then raise exception 'The new Owner must already be an active member of this organisation' using errcode='22023'; end if;

  update public.club_members set role='owner'
    where organisation_id=p_organisation_id and user_id=p_new_owner_user_id and active;
  update public.club_members set role='gym_admin'
    where organisation_id=p_organisation_id and user_id=auth.uid() and active and role='owner';

  if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and active and role='owner') then
    raise exception 'Ownership transfer did not leave an active Owner' using errcode='23514';
  end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  values(p_organisation_id,auth.uid(),'owner','organisation.owner_transferred','club_organisation',p_organisation_id,
    jsonb_build_object('previous_owner_user_id',auth.uid(),'previous_owner_role','owner',
      'previous_owner_new_role','gym_admin','new_owner_user_id',p_new_owner_user_id,
      'new_owner_previous_role',new_owner.role,'new_owner_new_role','owner',
      'coach_permissions_unchanged',true,'venue_access_unchanged',true));
  return jsonb_build_object('organisation_id',p_organisation_id,
    'previous_owner_user_id',auth.uid(),'new_owner_user_id',p_new_owner_user_id,
    'previous_owner_role','gym_admin','new_owner_role','owner');
end; $$;
revoke all on function public.club_transfer_organisation_owner(uuid,uuid) from public,anon;
grant execute on function public.club_transfer_organisation_owner(uuid,uuid) to authenticated;
