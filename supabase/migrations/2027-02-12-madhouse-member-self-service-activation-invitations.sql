-- Secure, explicit account activation invitations for existing Madhouse members.
-- No membership, payment, mandate, subscription, customer or access record is created.
begin;

create table if not exists public.club_madhouse_member_activation_invitations (
  id uuid primary key,
  organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  customer_id uuid not null,
  invited_email text not null,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'queued' check(status in ('queued','sent','redeemed','expired','failed','exception','revoked')),
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,
  failure_code text,
  foreign key(customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete restrict,
  unique(id,organisation_id),
  check (status<>'redeemed' or redeemed_at is not null)
);
alter table public.club_madhouse_member_activation_invitations enable row level security;
revoke all on public.club_madhouse_member_activation_invitations from public,anon,authenticated;
create unique index if not exists club_madhouse_member_activation_one_open_invite
  on public.club_madhouse_member_activation_invitations(organisation_id,customer_id)
  where status in ('queued','sent');
create index if not exists club_madhouse_member_activation_status_idx
  on public.club_madhouse_member_activation_invitations(organisation_id,status,created_at desc);

-- This internal classifier intentionally returns no email or other customer data.
create or replace function public.club_madhouse_member_activation_candidate_state(p_customer_id uuid)
returns text language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; v_email text; v_local text; v_domain text; v_auth_user uuid;
begin
  select * into c from public.club_customers
    where id=p_customer_id and organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb';
  if not found then return 'not_found'; end if;
  if not exists(
    select 1 from public.club_membership_holders h
    join public.club_memberships m on m.id=h.membership_id and m.organisation_id=h.organisation_id
    join public.club_product_entitlements pe on pe.organisation_id=m.organisation_id and pe.product_id=m.product_id
      and pe.entitlement_key='gym_access'
    where h.organisation_id=c.organisation_id and (h.customer_id=c.id or (c.user_id is not null and h.user_id=c.user_id))
      and m.status='active' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())
  ) then return 'not_active'; end if;
  if c.user_id is not null then return 'already_linked'; end if;
  v_email:=lower(btrim(coalesce(c.email,'')));
  if v_email='' then return 'missing_email'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return 'invalid_email'; end if;
  v_local:=split_part(v_email,'@',1); v_domain:=split_part(v_email,'@',2);
  if v_domain in ('example.com','example.net','example.org','invalid','localhost')
    or v_local in ('admin','family','info','membership','noreply','no-reply','shared','test','unknown','placeholder')
    or v_local like '%placeholder%' then return 'shared_or_placeholder'; end if;
  if (select count(*) from public.club_customers other
      where other.organisation_id=c.organisation_id and lower(btrim(coalesce(other.email,'')))=v_email)>1
    or public.club_imported_member_email_is_ambiguous(c.organisation_id,c.id,v_email) then
    return 'shared_or_ambiguous_email';
  end if;
  select u.id into v_auth_user from auth.users u where lower(btrim(coalesce(u.email,'')))=v_email limit 1;
  if v_auth_user is not null and exists(select 1 from public.club_customers other
      where other.organisation_id=c.organisation_id and other.user_id=v_auth_user and other.id<>c.id) then
    return 'account_link_conflict';
  end if;
  return 'eligible';
end; $$;
revoke all on function public.club_madhouse_member_activation_candidate_state(uuid) from public,anon,authenticated;

create or replace function public.club_preview_madhouse_member_activation_invitations(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_rows jsonb; v_counts jsonb;
begin
  if auth.uid() is null or p_organisation_id<>'fa44592a-1593-4ad3-a621-63a4a4bcbceb'
    or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.link_account')
    or not exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id
      and m.user_id=auth.uid() and m.active and m.role in ('owner','gym_admin')) then
    raise exception 'Member invitation management is not permitted' using errcode='42501';
  end if;

  with active_customers as (
    select distinct c.id,c.display_name,c.email,c.user_id
    from public.club_customers c
    join public.club_membership_holders h on h.organisation_id=c.organisation_id
      and (h.customer_id=c.id or (c.user_id is not null and h.user_id=c.user_id))
    join public.club_memberships m on m.id=h.membership_id and m.organisation_id=h.organisation_id
    join public.club_product_entitlements pe on pe.product_id=m.product_id and pe.organisation_id=m.organisation_id and pe.entitlement_key='gym_access'
    where c.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=now()
      and (m.ends_at is null or m.ends_at>now())
  ), classified as (
    select c.*,public.club_madhouse_member_activation_candidate_state(c.id) eligibility,
      i.id invite_id,i.status invite_status,i.expires_at invite_expires_at
    from active_customers c
    left join lateral (select x.id,x.status,x.expires_at from public.club_madhouse_member_activation_invitations x
      where x.organisation_id=p_organisation_id and x.customer_id=c.id order by x.created_at desc limit 1) i on true
  ), presented as (
    select id,id customer_id,display_name,
      case when nullif(split_part(coalesce(email,''),'@',1),'') is null then 'Email unavailable'
        when split_part(email,'@',2)='' then 'Invalid email address'
        else left(split_part(email,'@',1),1)||'••••@'||split_part(email,'@',2) end masked_email,
      eligibility,
      case when invite_status='redeemed' then 'completed'
        when user_id is not null then 'already_linked'
        when invite_status in ('queued','sent') and invite_expires_at<=now() then 'expired'
        when invite_status in ('queued','sent') then invite_status
        when invite_status='failed' then 'failed'
        when invite_status='exception' then 'exception'
        when invite_status='revoked' then 'revoked'
        else eligibility end state,
      invite_id,invite_expires_at,
      (eligibility='eligible' and (invite_status is null or invite_status in ('failed','expired','revoked')
        or (invite_status in ('queued','sent') and invite_expires_at<=now()))) sendable
    from classified
  )
  select coalesce(jsonb_agg(to_jsonb(p) order by lower(p.display_name)),'[]'::jsonb),
    coalesce((select jsonb_object_agg(state,count) from (select state,count(*)::integer count from presented group by state) q),'{}'::jsonb)
  into v_rows,v_counts from presented p;
  return jsonb_build_object('members',v_rows,'counts',v_counts,
    'eligible_count',coalesce((select count(*) from jsonb_to_recordset(v_rows) as x(sendable boolean) where sendable),0));
end; $$;
revoke all on function public.club_preview_madhouse_member_activation_invitations(uuid) from public,anon;
grant execute on function public.club_preview_madhouse_member_activation_invitations(uuid) to authenticated;

create or replace function public.club_queue_madhouse_member_activation_invitations(p_organisation_id uuid,p_entries jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare item jsonb; v_customer public.club_customers%rowtype; v_state text; v_id uuid; v_hash text;
  v_queued integer:=0; v_skipped integer:=0; v_role text; v_intent uuid; v_email text; v_name text; v_org_name text;
  v_recent integer;
begin
  if auth.uid() is null or p_organisation_id<>'fa44592a-1593-4ad3-a621-63a4a4bcbceb'
    or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.link_account')
    or not exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id
      and m.user_id=auth.uid() and m.active and m.role in ('owner','gym_admin')) then
    raise exception 'Member invitation management is not permitted' using errcode='42501';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) is distinct from 'array' then
    raise exception 'Invitation entries must be an array' using errcode='22023';
  end if;
  if jsonb_array_length(p_entries) not between 1 and 250 then
    raise exception 'Invitation batch must contain 1–250 members' using errcode='22023';
  end if;
  select count(*) into v_recent from public.club_member_notification_intents n
    where n.organisation_id=p_organisation_id and n.template_key='madhouse_member_invitation'
      and n.created_at>now()-interval '24 hours' and n.state<>'cancelled';
  if v_recent+jsonb_array_length(p_entries)>250 then
    raise exception 'The daily Madhouse invitation limit has been reached; try again later' using errcode='54000';
  end if;
  select role into v_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  select name into v_org_name from public.club_organisations where id=p_organisation_id and active;
  if v_org_name is null then raise exception 'Madhouse organisation is unavailable' using errcode='P0002'; end if;

  for item in select value from jsonb_array_elements(p_entries) loop
    v_id:=nullif(item->>'invitationId','')::uuid;
    v_hash:=lower(coalesce(item->>'tokenHash',''));
    if v_id is null or v_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid invitation request' using errcode='22023'; end if;
    select * into v_customer from public.club_customers
      where id=(item->>'customerId')::uuid and organisation_id=p_organisation_id for update;
    if not found then v_skipped:=v_skipped+1; continue; end if;
    v_state:=public.club_madhouse_member_activation_candidate_state(v_customer.id);
    if v_state<>'eligible' then v_skipped:=v_skipped+1; continue; end if;
    update public.club_madhouse_member_activation_invitations set status='expired',updated_at=now()
      where organisation_id=p_organisation_id and customer_id=v_customer.id and status in ('queued','sent') and expires_at<=now();
    if exists(select 1 from public.club_madhouse_member_activation_invitations
      where organisation_id=p_organisation_id and customer_id=v_customer.id and status in ('queued','sent') and expires_at>now()) then
      v_skipped:=v_skipped+1; continue;
    end if;
    v_email:=lower(btrim(v_customer.email)); v_name:=v_customer.display_name;
    insert into public.club_madhouse_member_activation_invitations(id,organisation_id,customer_id,invited_email,token_hash,status,expires_at,created_by)
      values(v_id,p_organisation_id,v_customer.id,v_email,v_hash,'queued',now()+interval '7 days',auth.uid());
    insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
      values(p_organisation_id,null,v_email,'member_service','madhouse_member_invitation','pending',
        'madhouse-member-activation:'||v_id,now(),'members',
        jsonb_build_object('invitationId',v_id,'name',v_name,'organisationName',v_org_name),
        'madhouse_member_activation_invitation',v_id) returning id into v_intent;
    insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
      values(p_organisation_id,auth.uid(),v_role,'member.activation_invitation_queued','customer',v_customer.id,
        jsonb_build_object('invitation_id',v_id,'expires_at',now()+interval '7 days'));
    v_queued:=v_queued+1;
  end loop;
  return jsonb_build_object('queued',v_queued,'skipped',v_skipped,'daily_limit',250);
end; $$;
revoke all on function public.club_queue_madhouse_member_activation_invitations(uuid,jsonb) from public,anon;
grant execute on function public.club_queue_madhouse_member_activation_invitations(uuid,jsonb) to authenticated;

-- Only the server-role email worker can resolve a recipient and token hash.
create or replace function public.club_get_madhouse_member_activation_delivery_context(p_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare i public.club_madhouse_member_activation_invitations%rowtype; c public.club_customers%rowtype; o public.club_organisations%rowtype; v_state text;
begin
  if auth.role()<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  select * into i from public.club_madhouse_member_activation_invitations where id=p_invitation_id
    and organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb' for update;
  if not found or i.status<>'queued' then return null; end if;
  if i.expires_at<=now() then
    update public.club_madhouse_member_activation_invitations set status='expired',updated_at=now() where id=i.id;
    return null;
  end if;
  select * into c from public.club_customers where id=i.customer_id and organisation_id=i.organisation_id;
  if not found then
    update public.club_madhouse_member_activation_invitations set status='exception',failure_code='customer_unavailable',updated_at=now() where id=i.id;
    return null;
  end if;
  if lower(btrim(coalesce(c.email,'')))<>i.invited_email then
    update public.club_madhouse_member_activation_invitations set status='exception',failure_code='identity_changed',updated_at=now() where id=i.id;
    return null;
  end if;
  v_state:=public.club_madhouse_member_activation_candidate_state(c.id);
  if v_state<>'eligible' then
    update public.club_madhouse_member_activation_invitations set status='exception',failure_code='eligibility_changed',updated_at=now() where id=i.id;
    return null;
  end if;
  select * into o from public.club_organisations where id=i.organisation_id and active;
  if not found then return null; end if;
  return jsonb_build_object('invitation_id',i.id,'token_hash',i.token_hash,'expires_at',i.expires_at,
    'recipient_email',i.invited_email,'name',c.display_name,'organisation_name',o.name);
end; $$;
revoke all on function public.club_get_madhouse_member_activation_delivery_context(uuid) from public,anon,authenticated;
grant execute on function public.club_get_madhouse_member_activation_delivery_context(uuid) to service_role;

create or replace function public.club_redeem_madhouse_member_activation_invitation(p_invitation_id uuid,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare i public.club_madhouse_member_activation_invitations%rowtype; c public.club_customers%rowtype;
  v_email text; v_verified timestamptz; v_state text; v_role text;
begin
  if auth.uid() is null then raise exception 'Sign in to activate your membership' using errcode='42501'; end if;
  select lower(btrim(email)),email_confirmed_at into v_email,v_verified from auth.users where id=auth.uid();
  if v_verified is null or v_email is null then raise exception 'Confirm your R12 email before activation' using errcode='42501'; end if;
  select * into i from public.club_madhouse_member_activation_invitations where id=p_invitation_id
    and organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb' for update;
  if not found then return jsonb_build_object('state','not_accepted'); end if;
  if i.status='redeemed' and i.redeemed_by=auth.uid() then return jsonb_build_object('state','already_linked'); end if;
  if i.status not in ('queued','sent') or i.expires_at<=now() or coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$'
    or i.token_hash is distinct from lower(p_token_hash) or i.invited_email is distinct from v_email then
    return jsonb_build_object('state','not_accepted');
  end if;
  select * into c from public.club_customers where id=i.customer_id and organisation_id=i.organisation_id for update;
  if not found or lower(btrim(coalesce(c.email,'')))<>i.invited_email then
    update public.club_madhouse_member_activation_invitations set status='exception',failure_code='identity_changed',updated_at=now() where id=i.id;
    return jsonb_build_object('state','staff_verification_required');
  end if;
  if c.user_id=auth.uid() then
    update public.club_madhouse_member_activation_invitations set status='redeemed',redeemed_by=auth.uid(),redeemed_at=now(),updated_at=now(),failure_code=null where id=i.id;
    return jsonb_build_object('state','already_linked','customer_id',c.id);
  elsif c.user_id is not null then
    update public.club_madhouse_member_activation_invitations set status='exception',failure_code='identity_changed',updated_at=now() where id=i.id;
    return jsonb_build_object('state','staff_verification_required');
  end if;
  v_state:=public.club_madhouse_member_activation_candidate_state(c.id);
  if v_state<>'eligible' then
    update public.club_madhouse_member_activation_invitations set status='exception',failure_code=left(v_state,80),updated_at=now() where id=i.id;
    return jsonb_build_object('state','staff_verification_required');
  end if;
  begin
    perform public.club_claim_existing_member(i.organisation_id,c.id);
  exception when unique_violation or insufficient_privilege then
    update public.club_madhouse_member_activation_invitations set status='exception',failure_code='claim_requires_review',updated_at=now() where id=i.id;
    insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata)
      values(i.organisation_id,auth.uid(),'member.activation_invitation_exception','customer',c.id,
        jsonb_build_object('invitation_id',i.id,'reason','claim_requires_review'));
    return jsonb_build_object('state','staff_verification_required');
  end;
  select role into v_role from public.club_members where organisation_id=i.organisation_id and user_id=auth.uid() and active;
  update public.club_madhouse_member_activation_invitations set status='redeemed',redeemed_by=auth.uid(),redeemed_at=now(),updated_at=now(),failure_code=null where id=i.id;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    values(i.organisation_id,auth.uid(),v_role,'member.activation_invitation_redeemed','customer',c.id,jsonb_build_object('invitation_id',i.id));
  return jsonb_build_object('state','linked','customer_id',c.id);
end; $$;
revoke all on function public.club_redeem_madhouse_member_activation_invitation(uuid,text) from public,anon;
grant execute on function public.club_redeem_madhouse_member_activation_invitation(uuid,text) to authenticated;

-- Keep the old worker signature safe and add an explicit, independent opt-in
-- for this invitation template. No delivery can happen until the server flag is set.
create or replace function public.club_claim_notification_intents_for_worker(
  p_limit integer,p_worker_id text,p_include_member_activation boolean default false
) returns setof public.club_member_notification_intents
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.role()<>'service_role' then raise exception 'Notification worker requires service role' using errcode='42501'; end if;
  update public.club_member_notification_intents set state=case when attempts>=3 then 'failed' else 'scheduled' end,
    not_before=case when attempts>=3 then not_before else now() end,
    failure_code=case when attempts>=3 then 'claim_lease_expired_max_attempts' else 'claim_lease_expired' end,
    failure_message=case when attempts>=3 then 'Delivery claim expired after the maximum attempts; manual review is required.' else 'Delivery claim expired before completion; the notification was safely rescheduled.' end,
    claimed_by=null,claimed_until=null,updated_at=now()
  where state='processing' and (claimed_until is null or claimed_until<=now());
  return query with candidates as (
    select id from public.club_member_notification_intents where target_email is not null and state in ('pending','scheduled')
      and attempts<3 and not_before<=now() and (p_include_member_activation or template_key<>'member_activation')
      and template_key<>'madhouse_member_invitation'
    order by case when p_include_madhouse_member_invitations and template_key='madhouse_member_invitation' then 0 else 1 end,
      not_before,created_at limit greatest(1,least(coalesce(p_limit,25),100)) for update skip locked
  ) update public.club_member_notification_intents n set state='processing',attempts=n.attempts+1,last_attempt_at=now(),
    claimed_by=p_worker_id,claimed_until=now()+interval '10 minutes',updated_at=now()
    from candidates c where n.id=c.id returning n.*;
end; $$;
revoke all on function public.club_claim_notification_intents_for_worker(integer,text,boolean) from public,anon,authenticated;
grant execute on function public.club_claim_notification_intents_for_worker(integer,text,boolean) to service_role;

create or replace function public.club_claim_notification_intents_for_worker(
  p_limit integer,p_worker_id text,p_include_member_activation boolean,p_include_madhouse_member_invitations boolean
) returns setof public.club_member_notification_intents
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.role()<>'service_role' then raise exception 'Notification worker requires service role' using errcode='42501'; end if;
  update public.club_member_notification_intents set state=case when attempts>=3 then 'failed' else 'scheduled' end,
    not_before=case when attempts>=3 then not_before else now() end,
    failure_code=case when attempts>=3 then 'claim_lease_expired_max_attempts' else 'claim_lease_expired' end,
    failure_message=case when attempts>=3 then 'Delivery claim expired after the maximum attempts; manual review is required.' else 'Delivery claim expired before completion; the notification was safely rescheduled.' end,
    claimed_by=null,claimed_until=null,updated_at=now()
  where state='processing' and (claimed_until is null or claimed_until<=now());
  return query with candidates as (
    select id from public.club_member_notification_intents where target_email is not null and state in ('pending','scheduled')
      and attempts<3 and not_before<=now()
      and (p_include_member_activation or template_key<>'member_activation')
      and (p_include_madhouse_member_invitations or template_key<>'madhouse_member_invitation')
    order by not_before,created_at limit greatest(1,least(coalesce(p_limit,25),100)) for update skip locked
  ) update public.club_member_notification_intents n set state='processing',attempts=n.attempts+1,last_attempt_at=now(),
    claimed_by=p_worker_id,claimed_until=now()+interval '10 minutes',updated_at=now()
    from candidates c where n.id=c.id returning n.*;
end; $$;
revoke all on function public.club_claim_notification_intents_for_worker(integer,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.club_claim_notification_intents_for_worker(integer,text,boolean,boolean) to service_role;

create or replace function public.club_sync_madhouse_member_invitation_delivery_state()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.template_key='madhouse_member_invitation' and new.related_type='madhouse_member_activation_invitation' then
    if new.state='sent' then
      update public.club_madhouse_member_activation_invitations set status='sent',updated_at=now()
        where id=new.related_id and status='queued' and expires_at>now();
    elsif new.state in ('failed','unavailable') then
      update public.club_madhouse_member_activation_invitations set status='failed',failure_code=left(coalesce(new.failure_code,'delivery_failed'),80),updated_at=now()
        where id=new.related_id and status='queued';
    elsif new.state='cancelled' then
      update public.club_madhouse_member_activation_invitations set status='revoked',updated_at=now()
        where id=new.related_id and status='queued';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.club_sync_madhouse_member_invitation_delivery_state() from public,anon,authenticated;
drop trigger if exists club_sync_madhouse_member_invitation_delivery_state on public.club_member_notification_intents;
create trigger club_sync_madhouse_member_invitation_delivery_state
after update of state on public.club_member_notification_intents
for each row execute function public.club_sync_madhouse_member_invitation_delivery_state();

commit;
