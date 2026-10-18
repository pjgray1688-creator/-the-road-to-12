-- Require staff-confirmed individual email ownership before member activation
-- mail can leave the outbox. Add explicit evidence to verified cash settlement.

create table if not exists public.club_member_activation_email_verifications (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  customer_id uuid not null,
  email_normalized text not null,
  verification_method text not null check (verification_method in ('in_person','member_confirmed')),
  verification_note text not null check (char_length(verification_note) between 8 and 500),
  verified_by uuid not null references auth.users(id),
  verified_at timestamptz not null default now(),
  unique (organisation_id,customer_id),
  foreign key (customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete cascade
);
alter table public.club_member_activation_email_verifications enable row level security;
revoke all on public.club_member_activation_email_verifications from public,anon,authenticated;
create unique index if not exists club_member_activation_email_verifications_unique_email
  on public.club_member_activation_email_verifications(organisation_id,email_normalized);

create or replace function public.club_verify_member_personal_email(
  p_organisation_id uuid,p_customer_id uuid,p_email text,p_method text,p_note text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; email_value text:=lower(btrim(coalesce(p_email,''))); actor_role text; v public.club_member_activation_email_verifications%rowtype; email_changed boolean:=false;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.link_account') then
    raise exception 'Member email verification is not permitted' using errcode='42501';
  end if;
  if p_method not in ('in_person','member_confirmed') or char_length(btrim(coalesce(p_note,''))) not between 8 and 500 then
    raise exception 'Record how the member confirmed control of this personal email' using errcode='22023';
  end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id for update;
  if not found or c.user_id is not null or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'The unlinked member and a valid personal email are required' using errcode='22023';
  end if;
  if exists(select 1 from public.club_customers other where other.organisation_id=p_organisation_id and other.id<>c.id and lower(btrim(other.email))=email_value) then
    raise exception 'This email is shared by another member record; record a separate personal email for this member' using errcode='23505';
  end if;
  if lower(btrim(coalesce(c.email,''))) is distinct from email_value then
    email_changed:=true;
    update public.club_customers set email=email_value,updated_at=now() where id=c.id and organisation_id=p_organisation_id returning * into c;
  end if;
  insert into public.club_member_activation_email_verifications(organisation_id,customer_id,email_normalized,verification_method,verification_note,verified_by)
  values(p_organisation_id,c.id,email_value,p_method,btrim(p_note),auth.uid())
  on conflict(organisation_id,customer_id) do update set email_normalized=excluded.email_normalized,
    verification_method=excluded.verification_method,verification_note=excluded.verification_note,
    verified_by=excluded.verified_by,verified_at=now()
  returning * into v;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,reason,metadata)
  values(p_organisation_id,auth.uid(),actor_role,'member.activation_email_personally_verified','customer',c.id,
    btrim(p_note),jsonb_build_object('method',p_method,'email_changed',email_changed,'verification_id',v.id));
  return jsonb_build_object('customerId',c.id,'verifiedAt',v.verified_at,'status','verified_personal_email');
end; $$;
revoke all on function public.club_verify_member_personal_email(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.club_verify_member_personal_email(uuid,uuid,text,text,text) to authenticated;

-- A database trigger is the final guard, including existing queue and resend
-- call sites. Unverified rows stay visible as unavailable, never deliverable.
create or replace function public.club_guard_member_activation_email_intent()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.template_key='member_activation' then
    if new.related_type<>'customer' or not exists (
      select 1 from public.club_customers c
      join public.club_member_activation_email_verifications v
        on v.organisation_id=c.organisation_id and v.customer_id=c.id
       and v.email_normalized=lower(btrim(coalesce(c.email,'')))
      where c.id=new.related_id and c.organisation_id=new.organisation_id
      and c.user_id is null and lower(btrim(coalesce(new.target_email,'')))=v.email_normalized
    ) then
      -- A unique imported address may receive an activation link: the recipient
      -- must verify control through Supabase Auth, then self-claim rechecks that
      -- exactly one source profile matches that verified address. Shared or
      -- ambiguous addresses still require a separately verified personal email.
      if not exists(
        select 1 from public.club_customers c
        where c.id=new.related_id and c.organisation_id=new.organisation_id
          and c.user_id is null and lower(btrim(coalesce(c.email,'')))=lower(btrim(coalesce(new.target_email,'')))
          and (select count(*) from public.club_customers same_email
            where same_email.organisation_id=c.organisation_id
              and lower(btrim(same_email.email))=lower(btrim(c.email)))=1
      ) then
        new.target_email:=null;
        new.state:='unavailable';
        new.failure_code:='member_email_not_individually_verified';
        new.failure_message:='A staff member must verify a unique personal email before activation can be sent.';
        new.claimed_by:=null;
        new.claimed_until:=null;
      end if;
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.club_guard_member_activation_email_intent() from public,anon,authenticated;
drop trigger if exists club_guard_member_activation_email_intent on public.club_member_notification_intents;
create trigger club_guard_member_activation_email_intent
before insert or update of target_email,template_key,related_type,related_id,state
on public.club_member_notification_intents
for each row execute function public.club_guard_member_activation_email_intent();

-- Suppress not-yet-sent legacy intents. Already-sent rows are immutable history.
update public.club_member_notification_intents n
set target_email=null,state='unavailable',failure_code='member_email_not_individually_verified',
    failure_message='A staff member must verify that this is the member’s own email before activation can be sent.',
    claimed_by=null,claimed_until=null,updated_at=now()
where n.template_key='member_activation' and n.state<>'sent'
  and not exists(select 1 from public.club_customers c join public.club_member_activation_email_verifications v
    on v.organisation_id=c.organisation_id and v.customer_id=c.id
      and v.email_normalized=lower(btrim(coalesce(c.email,'')))
    where c.id=n.related_id and c.organisation_id=n.organisation_id and c.user_id is null
      and lower(btrim(coalesce(n.target_email,'')))=v.email_normalized)
  and not exists(select 1 from public.club_customers c
    where c.id=n.related_id and c.organisation_id=n.organisation_id and c.user_id is null
      and lower(btrim(coalesce(n.target_email,'')))=lower(btrim(coalesce(c.email,'')))
      and (select count(*) from public.club_customers same_email where same_email.organisation_id=c.organisation_id
        and lower(btrim(same_email.email))=lower(btrim(c.email)))=1);

-- Explicit resend is available only after a current, exact personal-email
-- verification. The notification worker still owns actual delivery.
create or replace function public.club_resend_member_activation_notification(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; n public.club_member_notification_intents%rowtype; actor_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.link_account') then
    raise exception 'Member activation notification is not permitted' using errcode='42501';
  end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id for update;
  if not found or c.user_id is not null or nullif(btrim(c.email),'') is null or not (
    exists(select 1 from public.club_member_activation_email_verifications v where v.organisation_id=p_organisation_id
      and v.customer_id=c.id and v.email_normalized=lower(btrim(c.email)))
    or (select count(*) from public.club_customers same_email where same_email.organisation_id=c.organisation_id
      and lower(btrim(same_email.email))=lower(btrim(c.email)))=1
  ) then raise exception 'A unique personal email or staff-verified personal email is required before activation' using errcode='22023'; end if;
  insert into public.club_member_notification_intents(
    organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,
    sender_purpose,payload,related_type,related_id
  ) values(p_organisation_id,null,lower(btrim(c.email)),'member_service','member_activation','pending',
    'member-activation:'||c.id,now(),'members',jsonb_build_object('name',c.display_name,'customerId',c.id,
    'organisationName',(select o.name from public.club_organisations o where o.id=p_organisation_id)),'customer',c.id)
  on conflict(organisation_id,idempotency_key) do update set target_email=excluded.target_email,payload=excluded.payload,
    state='pending',not_before=now(),failure_code=null,failure_message=null,claimed_by=null,claimed_until=null,updated_at=now()
  where public.club_member_notification_intents.state not in ('processing','cancelled') returning * into n;
  if n.id is null then raise exception 'Activation email is already being processed or was cancelled' using errcode='55000'; end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  values(p_organisation_id,auth.uid(),actor_role,'member.activation_notification_resent','customer',c.id,jsonb_build_object('notification_id',n.id));
  return jsonb_build_object('id',n.id,'state',n.state);
end; $$;
revoke all on function public.club_resend_member_activation_notification(uuid,uuid) from public,anon;
grant execute on function public.club_resend_member_activation_notification(uuid,uuid) to authenticated;

create or replace function public.club_get_member_activation_readiness(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not (public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') or public.club_capability_allowed(p_organisation_id,auth.uid(),'members.view')) then
    raise exception 'Member activation readiness is not permitted' using errcode='42501';
  end if;
  return jsonb_build_object('people',coalesce((
    select jsonb_agg(jsonb_build_object(
      'customerId',c.id,'displayName',c.display_name,
      'accountState',case when c.user_id is not null then 'linked'
        when nullif(btrim(c.email),'') is null then 'staff_assisted_activation_required'
        when exists(select 1 from public.club_member_activation_email_verifications v where v.organisation_id=c.organisation_id and v.customer_id=c.id and v.email_normalized=lower(btrim(c.email))) then 'ready_for_activation'
        when (select count(*) from public.club_customers same_email where same_email.organisation_id=c.organisation_id and lower(btrim(same_email.email))=lower(btrim(c.email)))=1 then 'ready_for_activation'
        when (select count(*) from public.club_customers duplicate where duplicate.organisation_id=c.organisation_id and lower(btrim(duplicate.email))=lower(btrim(c.email)))>1 then 'shared_email_requires_individual_confirmation'
        else 'personal_email_requires_confirmation' end,
      'sharedMembershipReviewRequired',exists(
        select 1 from public.club_membership_holders h where h.organisation_id=c.organisation_id
          and (h.customer_id=c.id or (c.user_id is not null and h.user_id=c.user_id))
          and (select count(*) from public.club_membership_holders all_holders where all_holders.organisation_id=h.organisation_id and all_holders.membership_id=h.membership_id)>1
      ),
      'payerConfirmationRequired',exists(
        select 1 from public.club_membership_holders h
        join public.club_membership_billing_arrangements a on a.organisation_id=h.organisation_id and a.membership_id=h.membership_id
        where h.organisation_id=c.organisation_id and (h.customer_id=c.id or (c.user_id is not null and h.user_id=c.user_id))
          and (select count(*) from public.club_membership_holders all_holders where all_holders.organisation_id=h.organisation_id and all_holders.membership_id=h.membership_id)>1
          and not (exists(select 1 from public.club_membership_holders payer_holder where payer_holder.organisation_id=a.organisation_id and payer_holder.membership_id=a.membership_id and payer_holder.user_id=a.user_id)
            or exists(select 1 from public.club_customers payer_customer where payer_customer.organisation_id=a.organisation_id and payer_customer.id=a.customer_id and payer_customer.user_id=a.user_id))
      ),
      'payerRecordMissing',exists(
        select 1 from public.club_membership_holders h where h.organisation_id=c.organisation_id
          and (h.customer_id=c.id or (c.user_id is not null and h.user_id=c.user_id))
          and (select count(*) from public.club_membership_holders all_holders where all_holders.organisation_id=h.organisation_id and all_holders.membership_id=h.membership_id)>1
          and not exists(select 1 from public.club_membership_billing_arrangements a where a.organisation_id=h.organisation_id and a.membership_id=h.membership_id)
      )
    ) order by c.display_name,c.id)
    from public.club_customers c where c.organisation_id=p_organisation_id
  ),'[]'::jsonb));
end; $$;
revoke all on function public.club_get_member_activation_readiness(uuid) from public,anon;
grant execute on function public.club_get_member_activation_readiness(uuid) to authenticated;

-- Billing identity may differ from every covered holder. Keep one arrangement
-- for the shared membership, and require a verified linked payer profile when
-- that payer is not one of the holders. The payer can then be reused across
-- separate memberships without sharing member identities or entitlements.
create or replace function public.club_enrol_membership_billing(
  p_organisation_id uuid,p_membership_id uuid,p_user_id uuid,p_customer_id uuid,p_provider_type text,
  p_payment_method_family text,p_amount_minor integer,p_currency text,p_frequency text,p_next_due_at timestamptz,
  p_provider_customer_reference text,p_provider_subscription_reference text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.club_memberships%rowtype; payer public.club_customers%rowtype; a public.club_membership_billing_arrangements%rowtype;
  o public.club_membership_billing_obligations%rowtype; period text; channel text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then
    raise exception 'Billing administration is not permitted' using errcode='42501';
  end if;
  select * into m from public.club_memberships where id=p_membership_id and organisation_id=p_organisation_id for share;
  if not found or not exists(select 1 from public.club_membership_holders where membership_id=m.id and organisation_id=p_organisation_id) then
    raise exception 'Membership must have at least one covered holder' using errcode='22023';
  end if;
  if p_customer_id is null then
    if not exists(select 1 from public.club_membership_holders where membership_id=m.id and organisation_id=p_organisation_id and user_id=p_user_id) then
      raise exception 'A separate payer must have a linked organisation customer profile' using errcode='22023';
    end if;
  else
    select * into payer from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id and user_id=p_user_id for share;
    if not found or not exists(select 1 from public.club_members cm where cm.organisation_id=p_organisation_id and cm.user_id=p_user_id and cm.active) then
      raise exception 'Payer must be a verified, linked account in this organisation' using errcode='22023';
    end if;
  end if;
  if p_amount_minor<=0 or p_currency !~ '^[A-Z]{3}$' or p_payment_method_family not in ('direct_debit','recurring_card','cash','other') or p_frequency not in ('weekly','monthly','quarterly','annual','other') or p_next_due_at is null then
    raise exception 'Invalid billing obligation' using errcode='22023';
  end if;
  channel:=case when p_payment_method_family='cash' then 'staff_counter' else null end;
  insert into public.club_membership_billing_arrangements(organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,cash_channel,amount_minor,currency,frequency,next_due_at,provider_customer_reference,provider_subscription_reference)
  values(p_organisation_id,p_membership_id,p_user_id,p_customer_id,p_provider_type,p_payment_method_family,channel,p_amount_minor,p_currency,p_frequency,p_next_due_at,p_provider_customer_reference,p_provider_subscription_reference)
  on conflict(organisation_id,membership_id) do update set user_id=excluded.user_id,customer_id=excluded.customer_id,provider_type=excluded.provider_type,
    payment_method_family=excluded.payment_method_family,cash_channel=excluded.cash_channel,amount_minor=excluded.amount_minor,currency=excluded.currency,
    frequency=excluded.frequency,next_due_at=excluded.next_due_at,provider_customer_reference=excluded.provider_customer_reference,
    provider_subscription_reference=excluded.provider_subscription_reference,state='active',updated_at=now() returning * into a;
  period:=to_char(p_next_due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,cash_channel,amount_minor,currency,frequency,next_due_at,period_key)
  values(p_organisation_id,a.id,p_membership_id,p_user_id,p_customer_id,p_provider_type,p_payment_method_family,a.cash_channel,p_amount_minor,p_currency,p_frequency,p_next_due_at,period)
  on conflict(arrangement_id,period_key) do nothing returning * into o;
  if o.id is null then select * into o from public.club_membership_billing_obligations where arrangement_id=a.id and period_key=period; end if;
  return jsonb_build_object('arrangement',to_jsonb(a),'obligation',to_jsonb(o));
end; $$;
revoke all on function public.club_enrol_membership_billing(uuid,uuid,uuid,uuid,text,text,integer,text,text,timestamptz,text,text) from public,anon;
grant execute on function public.club_enrol_membership_billing(uuid,uuid,uuid,uuid,text,text,integer,text,text,timestamptz,text,text) to authenticated;

-- Keep household billing as one arrangement/obligation per membership, while
-- recording the human verification evidence for counter cash settlements.
alter table public.club_membership_billing_payments
  add column if not exists receipt_date date,
  add column if not exists paid_through_date date,
  add column if not exists recorded_by uuid references auth.users(id) on delete restrict,
  add column if not exists verification_note text;

create or replace function public.club_record_verified_membership_cash_payment(
  p_organisation_id uuid,p_obligation_id uuid,p_location_id uuid,p_amount_minor integer,p_currency text,
  p_idempotency_key text,p_receipt_date date,p_paid_through_date date,p_verification_note text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb; pay public.club_membership_billing_payments%rowtype; member_status text; member_ends_at timestamptz; actor_role text; note_value text:=nullif(btrim(p_verification_note),''); first_record boolean;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.record_cash') then
    raise exception 'Membership cash payment is not permitted' using errcode='42501';
  end if;
  if p_receipt_date is null or p_receipt_date>current_date or p_paid_through_date is null or p_paid_through_date<p_receipt_date
    or note_value is null or char_length(note_value)>500 then
    raise exception 'Enter a valid receipt date, paid-through date and verification note' using errcode='22023';
  end if;
  result:=public.club_record_membership_cash_payment(p_organisation_id,p_obligation_id,p_location_id,p_amount_minor,p_currency,p_idempotency_key);
  select * into pay from public.club_membership_billing_payments
  where organisation_id=p_organisation_id and provider_event_key=p_idempotency_key for update;
  if not found then raise exception 'Verified cash settlement was not recorded' using errcode='55000'; end if;
  if pay.receipt_date is not null and (pay.receipt_date<>p_receipt_date or pay.paid_through_date<>p_paid_through_date or pay.verification_note<>note_value) then
    raise exception 'This cash receipt was already recorded with different evidence' using errcode='23505';
  end if;
  first_record:=pay.receipt_date is null;
  update public.club_membership_billing_payments set receipt_date=p_receipt_date,paid_through_date=p_paid_through_date,
    recorded_by=coalesce(recorded_by,auth.uid()),verification_note=coalesce(verification_note,note_value)
  where id=pay.id returning * into pay;
  -- The same confirmed cash receipt also clears the matching payment-only
  -- suspension. Other memberships and explicit entitlement grants are intact.
  update public.club_membership_payment_access_suspensions set active=false,cleared_at=coalesce(cleared_at,now())
  where organisation_id=p_organisation_id and obligation_id=pay.obligation_id and active;
  select m.status,m.ends_at into member_status,member_ends_at
  from public.club_membership_billing_obligations o
  join public.club_memberships m on m.id=o.membership_id and m.organisation_id=o.organisation_id
  where o.organisation_id=p_organisation_id and o.id=pay.obligation_id;
  if first_record then
    select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
    insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,reason,metadata)
    values(p_organisation_id,auth.uid(),actor_role,'membership.cash_payment_verified','membership_billing_payment',pay.id,note_value,
      jsonb_build_object('obligationId',pay.obligation_id,'amountMinor',pay.amount_minor,'currency',pay.currency,
        'receiptDate',p_receipt_date,'paidThroughDate',p_paid_through_date,'locationId',p_location_id,'idempotencyKey',p_idempotency_key));
  end if;
  return jsonb_build_object('payment',to_jsonb(pay),'settlement',result,
    'membershipStatus',member_status,'membershipEndsAt',member_ends_at,
    'coverageNeedsReview',member_status<>'active' or (member_ends_at is not null and member_ends_at<=now()));
end; $$;
revoke all on function public.club_record_verified_membership_cash_payment(uuid,uuid,uuid,integer,text,text,date,date,text) from public,anon;
grant execute on function public.club_record_verified_membership_cash_payment(uuid,uuid,uuid,integer,text,text,date,date,text) to authenticated;
revoke all on function public.club_record_membership_cash_payment(uuid,uuid,uuid,integer,text,text) from public,anon,authenticated;

comment on table public.club_member_activation_email_verifications is
  'Staff attestation that an unlinked member controls this individual email when self-service unique-email verification is not suitable.';
comment on column public.club_membership_billing_payments.paid_through_date is
  'Staff-recorded coverage date for verified cash settlement; it does not independently alter membership dates or entitlements.';

-- A payment suspension applies only to that shared membership. When another
-- independent valid membership/grant exists, keep it as the access basis.
create or replace function public.club_refresh_customer_access_projection(p_organisation_id uuid,p_customer_id uuid)
returns public.club_member_access_projection language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; selected record; suspended boolean:=false; grace text; state text:='no_access'; why text:='no_membership'; allowed boolean:=false; result public.club_member_access_projection%rowtype;
begin
 select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id;
 if not found then delete from public.club_member_access_projection where organisation_id=p_organisation_id and customer_id=p_customer_id; return null; end if;
 select candidate.* into selected from (
  select m.id,m.status,m.starts_at,m.ends_at,m.source,e.scope,e.location_ids
  from public.club_memberships m
  join public.club_membership_holders h on h.membership_id=m.id and h.organisation_id=m.organisation_id
  join lateral (
   select g.scope,g.location_ids from public.club_entitlement_grants g where c.user_id is not null and g.organisation_id=m.organisation_id and g.membership_id=m.id and g.user_id=c.user_id and g.entitlement_key='gym_access'
   union all
   select pe.scope,pe.location_ids from public.club_product_entitlements pe where c.user_id is null and pe.product_id=m.product_id and pe.entitlement_key='gym_access'
  ) e on true
  where m.organisation_id=p_organisation_id and (h.customer_id=c.id or (c.user_id is not null and h.user_id=c.user_id))
  union all
  select null::uuid,'active'::text,g.starts_at,g.ends_at,g.source,g.scope,g.location_ids
  from public.club_entitlement_grants g where c.user_id is not null and g.organisation_id=p_organisation_id and g.user_id=c.user_id and g.membership_id is null and g.entitlement_key='gym_access'
 ) candidate
 order by (
   candidate.status='active' and candidate.starts_at<=now() and (candidate.ends_at is null or candidate.ends_at>now())
   and (candidate.id is null or not exists(select 1 from public.club_membership_payment_access_suspensions s where s.organisation_id=p_organisation_id and s.membership_id=candidate.id and s.active))
 ) desc,
 (candidate.status='active' and candidate.starts_at<=now() and (candidate.ends_at is null or candidate.ends_at>now())) desc,
 (candidate.status='active') desc,candidate.starts_at desc,candidate.id nulls last limit 1;
 if found then
  select exists(select 1 from public.club_membership_payment_access_suspensions s join public.club_membership_billing_policies bp on bp.organisation_id=s.organisation_id and bp.access_suspension_enabled where s.organisation_id=p_organisation_id and s.membership_id=selected.id and s.active) into suspended;
  select o.state into grace from public.club_membership_billing_obligations o where o.organisation_id=p_organisation_id and o.membership_id=selected.id order by o.next_due_at desc limit 1;
  if selected.status='cancelled' then state:='cancelled'; why:='membership_cancelled';
  elsif selected.status<>'active' then state:=case when selected.status='expired' then 'expired' else 'inactive' end; why:=case when selected.status='expired' then 'membership_expired' else 'membership_inactive' end;
  elsif selected.starts_at>now() then state:='not_started'; why:='membership_not_started';
  elsif selected.ends_at is not null and selected.ends_at<=now() then state:='expired'; why:='membership_expired';
  elsif suspended then state:='action_required'; why:='payment_action_required';
  else allowed:=true; state:=case when grace in ('failed','grace','retry_scheduled','payment_pending','due') then 'grace' else 'active' end; why:=case when state='grace' then 'billing_grace' else 'active_entitlement' end; end if;
 end if;
 insert into public.club_member_access_projection(organisation_id,customer_id,membership_id,access_allowed,access_state,reason,valid_from,valid_until,grace_state,access_scope,location_ids,membership_source,recalculated_at)
 values(p_organisation_id,p_customer_id,selected.id,allowed,state,why,selected.starts_at,selected.ends_at,grace,selected.scope,coalesce(selected.location_ids,'{}'),selected.source,now())
 on conflict(organisation_id,customer_id) do update set membership_id=excluded.membership_id,access_allowed=excluded.access_allowed,access_state=excluded.access_state,reason=excluded.reason,valid_from=excluded.valid_from,valid_until=excluded.valid_until,grace_state=excluded.grace_state,access_scope=excluded.access_scope,location_ids=excluded.location_ids,membership_source=excluded.membership_source,recalculated_at=excluded.recalculated_at returning * into result;
 return result;
end; $$;
