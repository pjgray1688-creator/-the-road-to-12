-- Stripe-hosted membership subscriptions for new organic joins. This is an
-- additive state-machine migration: it creates no Stripe resources, changes no
-- imported membership, and leaves existing GoCardless/cash arrangements intact.

alter table public.club_membership_join_requests
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_subscription_status text,
  add column if not exists stripe_subscription_event_at timestamptz,
  add column if not exists stripe_current_period_end timestamptz,
  add column if not exists stripe_latest_invoice_id text,
  add column if not exists stripe_initial_payment_event_at timestamptz,
  add column if not exists stripe_initial_charge_reversed boolean not null default false,
  add column if not exists stripe_charge_refunded boolean not null default false,
  add column if not exists stripe_dispute_open boolean not null default false,
  add column if not exists stripe_refund_event_at timestamptz,
  add column if not exists stripe_dispute_event_at timestamptz;

create unique index if not exists club_join_stripe_subscription_uq
  on public.club_membership_join_requests(stripe_subscription_id) where stripe_subscription_id is not null;

create table if not exists public.club_stripe_membership_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  join_request_id uuid not null,
  provider_event_key text not null,
  event_type text not null,
  provider_occurred_at timestamptz not null,
  checkout_session_id text,
  payment_intent_id text,
  customer_id text,
  subscription_id text,
  invoice_id text,
  charge_id text,
  amount_minor integer,
  currency text,
  provider_status text,
  billing_reason text,
  period_start timestamptz,
  period_end timestamptz,
  received_at timestamptz not null default now(),
  unique(provider_event_key),
  foreign key(join_request_id,organisation_id) references public.club_membership_join_requests(id,organisation_id) on delete cascade
);
create index if not exists club_stripe_membership_event_refs_idx
  on public.club_stripe_membership_events(subscription_id,invoice_id,charge_id);
alter table public.club_stripe_membership_events enable row level security;
revoke all on table public.club_stripe_membership_events from public,anon,authenticated;

-- The public joining RPC predates Stripe subscriptions. Constrain this trigger
-- to unactivated Madhouse monthly joins, so legacy/imported arrangements cannot
-- be rerouted or re-charged.
create or replace function public.club_route_new_madhouse_monthly_join_to_stripe()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.membership_id is null and new.checkout_kind='monthly_recurring' and exists(
    select 1 from public.club_organisations o where o.id=new.organisation_id and o.slug='madhouse-gym'
  ) then
    new.payment_method:='card'; new.payment_provider:='stripe'; new.upfront_provider:='stripe'; new.recurring_provider:='stripe';
    if new.recurring_authority_state='unavailable' then new.recurring_authority_state:='required'; end if;
  end if;
  return new;
end; $$;
drop trigger if exists club_route_new_madhouse_monthly_join_to_stripe on public.club_membership_join_requests;
create trigger club_route_new_madhouse_monthly_join_to_stripe before insert or update on public.club_membership_join_requests
for each row execute function public.club_route_new_madhouse_monthly_join_to_stripe();
revoke all on function public.club_route_new_madhouse_monthly_join_to_stripe() from public,anon,authenticated;

create or replace function public.club_prepare_stripe_membership_attempt(p_request_id uuid,p_replace_reference text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; c public.club_customers%rowtype; p public.club_products%rowtype; o public.club_organisations%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into r from public.club_membership_join_requests where id=p_request_id and user_id=auth.uid() for update;
  if not found or r.membership_id is not null or r.status in ('active','completed','cancelled') then raise exception 'Joining attempt is not available' using errcode='42501'; end if;
  select * into p from public.club_products where id=r.product_id and organisation_id=r.organisation_id and sellable and archived_at is null;
  select * into c from public.club_customers where id=r.customer_id and organisation_id=r.organisation_id;
  select * into o from public.club_organisations where id=r.organisation_id and active and member_joinable;
  if p.id is null or c.id is null or o.id is null or r.upfront_amount_minor<=0 then raise exception 'Joining attempt is no longer available' using errcode='22023'; end if;
  if r.checkout_kind='monthly_recurring' and (o.slug<>'madhouse-gym' or r.recurring_provider<>'stripe') then raise exception 'Stripe subscription is not available for this join' using errcode='22023'; end if;
  if r.upfront_payment_state='confirmed' and (r.checkout_kind<>'monthly_recurring' or r.recurring_authority_state='confirmed') then raise exception 'Stripe checkout is not required' using errcode='22023'; end if;
  if p_replace_reference is not null then
    if r.stripe_checkout_session_id is distinct from p_replace_reference then raise exception 'Stripe checkout changed; resume the current attempt' using errcode='40001'; end if;
    update public.club_membership_join_requests set stripe_checkout_session_id=null,stripe_payment_intent_id=null,
      stripe_customer_id=null,stripe_subscription_id=null,stripe_subscription_status=null,stripe_latest_invoice_id=null,
      stripe_checkout_generation=stripe_checkout_generation+1,upfront_payment_state='pending',
      recurring_authority_state=case when checkout_kind='monthly_recurring' then 'pending' else recurring_authority_state end where id=r.id;
  elsif r.stripe_checkout_generation=0 then
    update public.club_membership_join_requests set stripe_checkout_generation=1 where id=r.id;
  end if;
  update public.club_membership_join_requests set upfront_payment_state=case when upfront_payment_state='confirmed' then 'confirmed' else 'pending' end,
    recurring_authority_state=case when checkout_kind='monthly_recurring' and recurring_authority_state<>'confirmed' then 'pending' else recurring_authority_state end,
    payment_state='pending',status='payment_pending',payment_failure_reason=null,last_activity_at=now(),updated_at=now() where id=r.id returning * into r;
  return jsonb_build_object('id',r.id,'organisation_slug',o.slug,'product_name',p.name,'currency',p.currency,'email',c.email,
    'checkout_kind',r.checkout_kind,'joining_fee_minor',r.joining_fee_minor,'first_period_minor',r.first_period_minor,
    'upfront_amount_minor',r.upfront_amount_minor,'stripe_checkout_session_id',r.stripe_checkout_session_id,
    'stripe_checkout_generation',r.stripe_checkout_generation);
end; $$;
revoke all on function public.club_prepare_stripe_membership_attempt(uuid,text) from public,anon;
grant execute on function public.club_prepare_stripe_membership_attempt(uuid,text) to authenticated;

create or replace function public.club_store_stripe_join_resource(p_request_id uuid,p_checkout_session_id text,p_payment_intent_id text default null,p_customer_id text default null,p_subscription_id text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype;
begin
  if auth.role()<>'service_role' or p_checkout_session_id!~'^cs_' then raise exception 'Stripe resource update is not permitted' using errcode='42501'; end if;
  select * into r from public.club_membership_join_requests where id=p_request_id for update;
  if not found then raise exception 'Join request not found' using errcode='P0002'; end if;
  if r.stripe_checkout_session_id is not null and r.stripe_checkout_session_id<>p_checkout_session_id then return jsonb_build_object('ignored',true,'reason','superseded_provider_session'); end if;
  update public.club_membership_join_requests set stripe_checkout_session_id=p_checkout_session_id,
    stripe_payment_intent_id=coalesce(nullif(btrim(p_payment_intent_id),''),stripe_payment_intent_id),
    stripe_customer_id=coalesce(nullif(btrim(p_customer_id),''),stripe_customer_id),
    stripe_subscription_id=coalesce(nullif(btrim(p_subscription_id),''),stripe_subscription_id),updated_at=now()
    where id=r.id returning * into r;
  return to_jsonb(r);
end; $$;
revoke all on function public.club_store_stripe_join_resource(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.club_store_stripe_join_resource(uuid,text,text,text,text) to service_role;

create or replace function public.club_activate_verified_stripe_join(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; p public.club_products%rowtype; m public.club_memberships%rowtype; a public.club_membership_billing_arrangements%rowtype; v_start timestamptz; v_end timestamptz; v_next timestamptz; v_period text;
begin
  if auth.role()<>'service_role' then raise exception 'Stripe activation is not permitted' using errcode='42501'; end if;
  select * into r from public.club_membership_join_requests where id=p_request_id for update;
  if not found then raise exception 'Join request not found' using errcode='P0002'; end if;
  if r.membership_id is not null then return to_jsonb(r); end if;
  if r.stripe_initial_charge_reversed or r.upfront_payment_state<>'confirmed' or (r.checkout_kind='monthly_recurring' and r.recurring_authority_state<>'confirmed') then return jsonb_build_object('activated',false); end if;
  if r.checkout_kind='monthly_recurring' and (r.stripe_subscription_id is null or r.stripe_customer_id is null or r.stripe_subscription_status not in ('active','trialing')) then return jsonb_build_object('activated',false); end if;
  select * into p from public.club_products where id=r.product_id and organisation_id=r.organisation_id and sellable and archived_at is null;
  if not found then raise exception 'Membership product is unavailable' using errcode='22023'; end if;
  v_start:=coalesce(greatest(r.stripe_initial_payment_event_at,r.stripe_subscription_event_at),r.stripe_initial_payment_event_at,r.stripe_subscription_event_at,now());
  v_end:=case when r.checkout_kind<>'monthly_recurring' and p.duration_days is not null then v_start+make_interval(days=>p.duration_days) end;
  select * into m from public.club_memberships where organisation_id=r.organisation_id and assignment_idempotency_key='join:'||r.id for update;
  if not found then insert into public.club_memberships(organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key)
    values(r.organisation_id,p.id,'active',v_start,v_end,'purchase','join:'||r.id) returning * into m; end if;
  insert into public.club_membership_holders(id,membership_id,organisation_id,user_id) values(gen_random_uuid(),m.id,r.organisation_id,r.user_id) on conflict do nothing;
  insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
    select r.user_id,m.organisation_id,m.id,x.entitlement_key,x.scope,coalesce(x.location_ids,'{}'),x.allowance_quantity,x.allowance_period,x.discount_percent,x.discount_period,x.discount_max_uses,m.starts_at,m.ends_at,m.source
    from public.club_product_entitlements x where x.product_id=p.id and not exists(select 1 from public.club_entitlement_grants g where g.membership_id=m.id and g.user_id=r.user_id and g.entitlement_key=x.entitlement_key);
  if r.checkout_kind='monthly_recurring' then
    v_next:=coalesce(r.stripe_current_period_end,public.club_membership_anniversary(v_start,r.billing_anchor_day,1));
    insert into public.club_membership_billing_arrangements(organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,provider_customer_reference,provider_subscription_reference,amount_minor,currency,frequency,next_due_at,billing_anchor_day,last_successful_payment_at,provider_authority_state,collection_status,coverage_paid_through_at,initial_paid_through_at)
      values(r.organisation_id,m.id,r.user_id,r.customer_id,'stripe','recurring_card',r.stripe_customer_id,r.stripe_subscription_id,r.first_period_minor,p.currency,'monthly',v_next,r.billing_anchor_day,v_start,'active','ready',v_next,v_next)
      on conflict(organisation_id,membership_id) do update set provider_customer_reference=excluded.provider_customer_reference,provider_subscription_reference=excluded.provider_subscription_reference returning * into a;
    if a.id is null then select * into a from public.club_membership_billing_arrangements where organisation_id=r.organisation_id and membership_id=m.id; end if;
    v_period:=to_char(v_next at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,provider_customer_reference,provider_subscription_reference,amount_minor,currency,frequency,next_due_at,period_key,coverage_start_at,coverage_end_at)
      values(r.organisation_id,a.id,m.id,r.user_id,r.customer_id,'stripe','recurring_card',r.stripe_customer_id,r.stripe_subscription_id,r.first_period_minor,p.currency,'monthly',v_next,v_period,v_next,public.club_next_membership_billing_due(v_next,'monthly')) on conflict(arrangement_id,period_key) do nothing;
  end if;
  update public.club_membership_join_requests set membership_id=m.id,status='active',payment_state='confirmed',paid_through_at=coalesce(v_end,v_next),completed_at=now(),last_activity_at=now(),updated_at=now() where id=r.id returning * into r;
  return to_jsonb(r);
end; $$;
revoke all on function public.club_activate_verified_stripe_join(uuid) from public,anon,authenticated;
grant execute on function public.club_activate_verified_stripe_join(uuid) to service_role;

create or replace function public.club_record_stripe_membership_event(
  p_request_id uuid,p_provider_event_key text,p_event_type text,p_occurred_at timestamptz,
  p_session_id text default null,p_payment_intent_id text default null,p_customer_id text default null,p_subscription_id text default null,
  p_invoice_id text default null,p_charge_id text default null,p_amount_minor integer default null,p_currency text default null,
  p_status text default null,p_billing_reason text default null,p_period_start timestamptz default null,p_period_end timestamptz default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; e public.club_stripe_membership_events%rowtype; a public.club_membership_billing_arrangements%rowtype; o public.club_membership_billing_obligations%rowtype; v_next timestamptz; v_period text; v_full_reversal boolean:=false;
begin
  if auth.role()<>'service_role' then raise exception 'Stripe event is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_provider_event_key),'') is null or p_occurred_at is null or p_event_type not in ('checkout_paid','checkout_failed','subscription_active','subscription_incomplete','subscription_past_due','subscription_cancelled','invoice_paid','invoice_failed','charge_refunded','dispute_opened','dispute_closed') then raise exception 'Invalid Stripe membership event' using errcode='22023'; end if;
  select * into e from public.club_stripe_membership_events where provider_event_key=p_provider_event_key;
  if found then return jsonb_build_object('duplicate',true,'join_request_id',e.join_request_id); end if;
  select * into r from public.club_membership_join_requests j where
    (p_request_id is not null and j.id=p_request_id) or (p_session_id is not null and j.stripe_checkout_session_id=p_session_id) or
    (p_subscription_id is not null and j.stripe_subscription_id=p_subscription_id) or (p_payment_intent_id is not null and j.stripe_payment_intent_id=p_payment_intent_id) or
    (p_invoice_id is not null and (j.stripe_latest_invoice_id=p_invoice_id or exists(select 1 from public.club_stripe_membership_events se where se.join_request_id=j.id and se.invoice_id=p_invoice_id)))
    order by (j.id=p_request_id) desc limit 1 for update;
  if not found then raise exception 'Stripe event cannot be matched to a join request' using errcode='P0002'; end if;
  if p_request_id is not null and r.id<>p_request_id then raise exception 'Stripe metadata does not match the billing resource' using errcode='22023'; end if;
  if p_session_id is not null and r.stripe_checkout_session_id is not null and r.stripe_checkout_session_id<>p_session_id then raise exception 'Stripe session does not match this join' using errcode='22023'; end if;
  if p_subscription_id is not null and r.stripe_subscription_id is not null and r.stripe_subscription_id<>p_subscription_id then raise exception 'Stripe subscription does not match this join' using errcode='22023'; end if;
  insert into public.club_stripe_membership_events(organisation_id,join_request_id,provider_event_key,event_type,provider_occurred_at,checkout_session_id,payment_intent_id,customer_id,subscription_id,invoice_id,charge_id,amount_minor,currency,provider_status,billing_reason,period_start,period_end)
    values(r.organisation_id,r.id,p_provider_event_key,p_event_type,p_occurred_at,p_session_id,p_payment_intent_id,p_customer_id,p_subscription_id,p_invoice_id,p_charge_id,p_amount_minor,upper(p_currency),p_status,p_billing_reason,p_period_start,p_period_end) returning * into e;
  update public.club_membership_join_requests set stripe_checkout_session_id=coalesce(stripe_checkout_session_id,p_session_id),stripe_payment_intent_id=coalesce(stripe_payment_intent_id,p_payment_intent_id),
    stripe_customer_id=coalesce(stripe_customer_id,p_customer_id),stripe_subscription_id=coalesce(stripe_subscription_id,p_subscription_id),stripe_latest_invoice_id=coalesce(p_invoice_id,stripe_latest_invoice_id),updated_at=now() where id=r.id returning * into r;
  if p_event_type in ('checkout_paid','invoice_paid') and r.membership_id is null and p_amount_minor=r.upfront_amount_minor and (p_currency is null or upper(p_currency)=(select currency from public.club_products where id=r.product_id)) and (p_event_type='checkout_paid' or p_billing_reason='subscription_create' or r.checkout_kind<>'monthly_recurring') then
    if r.stripe_initial_payment_event_at is null or p_occurred_at>=r.stripe_initial_payment_event_at then update public.club_membership_join_requests set upfront_payment_state='confirmed',stripe_initial_payment_event_at=p_occurred_at,stripe_current_period_end=case when checkout_kind='monthly_recurring' then coalesce(p_period_end,stripe_current_period_end) else stripe_current_period_end end,payment_failure_reason=null where id=r.id; end if;
  elsif p_event_type='checkout_failed' and r.upfront_payment_state<>'confirmed' and (r.stripe_event_occurred_at is null or p_occurred_at>=r.stripe_event_occurred_at) then
    update public.club_membership_join_requests set upfront_payment_state='failed',payment_state='failed',status='payment_failed',stripe_event_occurred_at=p_occurred_at,payment_failure_reason='Stripe payment failed or expired' where id=r.id;
  end if;
  if p_event_type like 'subscription_%' and (r.stripe_subscription_event_at is null or p_occurred_at>=r.stripe_subscription_event_at) then
    update public.club_membership_join_requests set stripe_subscription_status=p_status,stripe_subscription_event_at=p_occurred_at,stripe_current_period_end=coalesce(p_period_end,stripe_current_period_end),
      recurring_authority_state=case when p_event_type='subscription_active' then 'confirmed' else 'failed' end,
      payment_failure_reason=case when p_event_type='subscription_active' then null else 'Stripe subscription requires attention' end where id=r.id;
  end if;
  select * into r from public.club_membership_join_requests where id=r.id;
  if r.membership_id is null then perform public.club_activate_verified_stripe_join(r.id); end if;
  select * into r from public.club_membership_join_requests where id=r.id;
  if r.membership_id is not null and r.checkout_kind='monthly_recurring' then
    select * into a from public.club_membership_billing_arrangements where organisation_id=r.organisation_id and membership_id=r.membership_id and provider_type='stripe' for update;
    if p_event_type='subscription_active' and (a.mandate_event_occurred_at is null or p_occurred_at>=a.mandate_event_occurred_at) then
      update public.club_membership_billing_arrangements set provider_authority_state='active',collection_status='ready',mandate_event_occurred_at=p_occurred_at,action_required_reason=null,updated_at=now() where id=a.id;
    elsif p_event_type='subscription_cancelled' and (a.mandate_event_occurred_at is null or p_occurred_at>=a.mandate_event_occurred_at) then
      update public.club_membership_billing_arrangements set state='cancelled',provider_authority_state='cancelled',collection_status='blocked',mandate_event_occurred_at=p_occurred_at,action_required_reason='subscription_cancelled',updated_at=now() where id=a.id;
      update public.club_memberships set ends_at=least(coalesce(ends_at,p_period_end,now()),coalesce(p_period_end,now())) where id=r.membership_id and organisation_id=r.organisation_id;
    elsif p_event_type in ('invoice_paid','invoice_failed','subscription_past_due') and p_billing_reason is distinct from 'subscription_create' then
      select * into o from public.club_membership_billing_obligations where arrangement_id=a.id and state not in ('paid','recovered','cancelled','waived') order by next_due_at limit 1 for update;
      if found and (o.last_provider_event_at is null or p_occurred_at>=o.last_provider_event_at) then
        if p_event_type='invoice_paid' and p_amount_minor=o.amount_minor and upper(p_currency)=o.currency then
          insert into public.club_membership_billing_provider_events(organisation_id,provider_type,provider_event_key,event_type,obligation_id,payload,provider_occurred_at,provider_reference)
            values(r.organisation_id,'stripe',p_provider_event_key,'payment_confirmed',o.id,jsonb_build_object('invoice_id',p_invoice_id),p_occurred_at,p_invoice_id) on conflict do nothing;
          insert into public.club_membership_billing_payments(organisation_id,obligation_id,amount_minor,currency,provider_reference,provider_event_key,occurred_at)
            values(r.organisation_id,o.id,p_amount_minor,upper(p_currency),p_invoice_id,p_provider_event_key,p_occurred_at) on conflict do nothing;
          update public.club_membership_billing_obligations set state=case when state in ('failed','grace','overdue') then 'recovered' else 'paid' end,last_paid_at=p_occurred_at,last_payment_reference=p_invoice_id,last_provider_event_at=p_occurred_at,failure_reason=null,grace_started_at=null,updated_at=now() where id=o.id;
          v_next:=coalesce(p_period_end,public.club_next_membership_billing_due(o.next_due_at,'monthly')); v_period:=to_char(v_next at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
          update public.club_membership_billing_arrangements set next_due_at=v_next,last_successful_payment_at=p_occurred_at,coverage_paid_through_at=v_next,collection_status='ready',action_required_reason=null,updated_at=now() where id=a.id;
          insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,provider_customer_reference,provider_subscription_reference,amount_minor,currency,frequency,next_due_at,period_key,coverage_start_at,coverage_end_at)
            values(a.organisation_id,a.id,a.membership_id,a.user_id,a.customer_id,'stripe','recurring_card',a.provider_customer_reference,a.provider_subscription_reference,a.amount_minor,a.currency,'monthly',v_next,v_period,v_next,public.club_next_membership_billing_due(v_next,'monthly')) on conflict(arrangement_id,period_key) do nothing;
          update public.club_membership_payment_access_suspensions set active=false,cleared_at=now() where obligation_id=o.id and active;
        elsif p_event_type<>'invoice_paid' then update public.club_membership_billing_obligations set state='grace',failure_reason='Stripe recurring payment failed',grace_started_at=coalesce(grace_started_at,p_occurred_at),last_provider_event_at=p_occurred_at,updated_at=now() where id=o.id;
        end if;
      end if;
    end if;
  end if;
  v_full_reversal:=(p_event_type in ('dispute_opened','dispute_closed') and p_status is distinct from 'won' and (r.stripe_dispute_event_at is null or p_occurred_at>=r.stripe_dispute_event_at)) or
    (p_event_type='charge_refunded' and p_amount_minor>=case when r.membership_id is null then r.upfront_amount_minor else r.first_period_minor end and (r.stripe_refund_event_at is null or p_occurred_at>=r.stripe_refund_event_at));
  if v_full_reversal then
    update public.club_membership_join_requests set stripe_initial_charge_reversed=true,
      stripe_charge_refunded=case when p_event_type='charge_refunded' then true else stripe_charge_refunded end,
      stripe_dispute_open=case when p_event_type in ('dispute_opened','dispute_closed') then true else stripe_dispute_open end,
      stripe_refund_event_at=case when p_event_type='charge_refunded' then p_occurred_at else stripe_refund_event_at end,
      stripe_dispute_event_at=case when p_event_type in ('dispute_opened','dispute_closed') then p_occurred_at else stripe_dispute_event_at end,
      payment_state='failed',payment_failure_reason=case when p_event_type='charge_refunded' then 'Stripe payment refunded' else 'Stripe payment disputed' end,updated_at=now() where id=r.id;
    if r.membership_id is not null then
      if a.id is null then insert into public.club_membership_billing_arrangements(organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,amount_minor,currency,frequency,next_due_at,state)
        values(r.organisation_id,r.membership_id,r.user_id,r.customer_id,'stripe','other',greatest(r.first_period_minor,1),(select currency from public.club_products where id=r.product_id),'other',p_occurred_at,'cancelled') returning * into a; end if;
      insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,amount_minor,currency,frequency,next_due_at,period_key,state,failure_reason)
        values(r.organisation_id,a.id,r.membership_id,r.user_id,r.customer_id,'stripe',a.payment_method_family,greatest(r.first_period_minor,1),a.currency,a.frequency,p_occurred_at,'reversal:'||r.id,'overdue',case when p_event_type='charge_refunded' then 'Payment refunded' else 'Payment disputed' end)
        on conflict(arrangement_id,period_key) do update set state='overdue',failure_reason=excluded.failure_reason returning * into o;
      insert into public.club_membership_payment_access_suspensions(organisation_id,membership_id,user_id,obligation_id,reason) values(r.organisation_id,r.membership_id,r.user_id,o.id,'payment_reversed') on conflict(obligation_id) do update set active=true,cleared_at=null,reason='payment_reversed';
    end if;
  elsif p_event_type='dispute_closed' and p_status='won' and (r.stripe_dispute_event_at is null or p_occurred_at>=r.stripe_dispute_event_at) then
    update public.club_membership_join_requests set stripe_dispute_open=false,stripe_dispute_event_at=p_occurred_at,
      stripe_initial_charge_reversed=stripe_charge_refunded,payment_state=case when stripe_charge_refunded then 'failed' else 'confirmed' end,
      payment_failure_reason=case when stripe_charge_refunded then 'Stripe payment refunded' else null end,updated_at=now() where id=r.id returning * into r;
    if not r.stripe_charge_refunded then update public.club_membership_payment_access_suspensions s set active=false,cleared_at=now() from public.club_membership_billing_obligations ob where s.obligation_id=ob.id and ob.period_key='reversal:'||r.id and s.active; end if;
  end if;
  return jsonb_build_object('recorded',true,'join_request_id',r.id,'event_type',p_event_type);
end; $$;
revoke all on function public.club_record_stripe_membership_event(uuid,text,text,timestamptz,text,text,text,text,text,text,integer,text,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.club_record_stripe_membership_event(uuid,text,text,timestamptz,text,text,text,text,text,text,integer,text,text,text,timestamptz,timestamptz) to service_role;
