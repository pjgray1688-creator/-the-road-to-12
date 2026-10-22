-- Durable, one-attempt-per-merchant ledger for explicitly owner-initiated
-- £1 controlled live Stripe tests. It never fulfils a customer purchase.
begin;

create table if not exists public.club_stripe_live_test_runs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id),
  merchant_entity text not null check (merchant_entity in ('madhouse_franchise','madhouse_products_services')),
  stripe_account_id text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  api_key_fingerprint text not null check (api_key_fingerprint ~ '^[a-f0-9]{64}$'),
  approval_reference text not null check (length(approval_reference) between 3 and 160),
  approval_actor text not null check (length(approval_actor) between 3 and 160),
  observed_dashboard_name text not null check (observed_dashboard_name in ('Madhouse Gym Rotherham','Madhouse Gym Carlton')),
  observed_account_holder text not null check (length(observed_account_holder) between 3 and 160),
  legal_entity_transition text not null default 'pending' check (legal_entity_transition='pending'),
  legal_entity_verified boolean not null default false check (legal_entity_verified=false),
  signed_approval jsonb not null check (jsonb_typeof(signed_approval)='object'),
  approval_signature text not null check (approval_signature ~ '^[A-Za-z0-9+/]+={0,2}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  checkout_session_id text unique,
  payment_intent_id text unique,
  checkout_state text not null default 'creating' check (checkout_state in ('creating','created','complete','expired','failed')),
  payment_state text not null default 'unpaid' check (payment_state in ('unpaid','pending','paid','failed')),
  amount_minor integer not null default 100 check (amount_minor=100),
  currency text not null default 'GBP' check (currency='GBP'),
  webhook_received_at timestamptz,
  last_provider_event_id text,
  failure_class text check (failure_class is null or failure_class ~ '^[a-z0-9_]{3,96}$'),
  constraint club_stripe_live_test_runs_one_per_entity unique (merchant_entity),
  constraint club_stripe_live_test_runs_madhouse_only check (organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid),
  constraint club_stripe_live_test_runs_approval_matches check (
    signed_approval->>'entity'=merchant_entity
    and signed_approval->>'accountId'=stripe_account_id
    and signed_approval->>'apiKeyFingerprint'=api_key_fingerprint
    and signed_approval->>'evidenceReference'=approval_reference
    and signed_approval->>'approvedBy'=approval_actor
    and signed_approval->>'observedDashboardName'=observed_dashboard_name
    and signed_approval->>'observedAccountHolder'=observed_account_holder
    and signed_approval->>'legalEntityTransition'='pending'
    and signed_approval->>'legalEntityVerified'='false'
    and signed_approval->>'amountMinor'='100'
    and signed_approval->>'currency'='GBP'
  ),
  constraint club_stripe_live_test_runs_expected_dashboard_name check (
    (merchant_entity='madhouse_franchise' and observed_dashboard_name='Madhouse Gym Rotherham')
    or (merchant_entity='madhouse_products_services' and observed_dashboard_name='Madhouse Gym Carlton')
  )
);

create table if not exists public.club_stripe_live_test_webhook_events (
  provider_event_id text primary key check (provider_event_id ~ '^evt_[A-Za-z0-9]+$'),
  run_id uuid not null references public.club_stripe_live_test_runs(id),
  merchant_entity text not null check (merchant_entity in ('madhouse_franchise','madhouse_products_services')),
  stripe_account_id text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  event_type text not null check (event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired','payment_intent.payment_failed')),
  checkout_session_id text not null check (checkout_session_id ~ '^cs_live_[A-Za-z0-9]+$'),
  payment_intent_id text,
  amount_minor integer not null check (amount_minor=100),
  currency text not null check (currency='GBP'),
  provider_created_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index if not exists club_stripe_live_test_events_run_idx on public.club_stripe_live_test_webhook_events(run_id,received_at);
alter table public.club_stripe_live_test_runs enable row level security;
alter table public.club_stripe_live_test_webhook_events enable row level security;
revoke all on public.club_stripe_live_test_runs, public.club_stripe_live_test_webhook_events from public, anon, authenticated, service_role;

create or replace function public.club_begin_stripe_live_test(
  p_merchant_entity text,p_account_id text,p_key_fingerprint text,p_approval_reference text,p_approval_actor text,
  p_observed_dashboard_name text,p_observed_account_holder text,p_signed_approval jsonb,p_approval_signature text,p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare v_run public.club_stripe_live_test_runs%rowtype;
begin
  if auth.role()<>'service_role' or p_actor_id is null or p_merchant_entity not in ('madhouse_franchise','madhouse_products_services')
    or p_account_id !~ '^acct_[A-Za-z0-9]+$' or p_key_fingerprint !~ '^[a-f0-9]{64}$'
    or length(coalesce(p_approval_reference,'')) not between 3 and 160 or length(coalesce(p_approval_actor,'')) not between 3 and 160
    or p_observed_dashboard_name not in ('Madhouse Gym Rotherham','Madhouse Gym Carlton')
    or length(coalesce(p_observed_account_holder,'')) not between 3 and 160 or jsonb_typeof(p_signed_approval)<>'object'
    or p_approval_signature !~ '^[A-Za-z0-9+/]+={0,2}$'
    or not exists(select 1 from public.club_members as member where member.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid and member.user_id=p_actor_id and member.active and member.role='owner') then
    raise exception 'Controlled Stripe live test is not permitted' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('r12-controlled-stripe-live-test',0));
  if exists(select 1 from public.club_stripe_live_test_runs as run where run.merchant_entity=p_merchant_entity) then
    raise exception 'This merchant test attempt is already reserved; no additional Checkout is allowed' using errcode='23505';
  end if;
  insert into public.club_stripe_live_test_runs(organisation_id,merchant_entity,stripe_account_id,api_key_fingerprint,approval_reference,approval_actor,observed_dashboard_name,observed_account_holder,signed_approval,approval_signature,created_by)
  values ('fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid,p_merchant_entity,p_account_id,p_key_fingerprint,p_approval_reference,p_approval_actor,p_observed_dashboard_name,p_observed_account_holder,p_signed_approval,p_approval_signature,p_actor_id)
  returning * into v_run;
  return jsonb_build_object('id',v_run.id,'state',v_run.checkout_state);
end; $$;
revoke all on function public.club_begin_stripe_live_test(text,text,text,text,text,text,text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.club_begin_stripe_live_test(text,text,text,text,text,text,text,jsonb,text,uuid) to service_role;

create or replace function public.club_get_my_stripe_live_test_run(p_merchant_entity text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare v_run public.club_stripe_live_test_runs%rowtype;
begin
  if auth.uid() is null or p_merchant_entity not in ('madhouse_franchise','madhouse_products_services')
    or not public.club_has_active_role('fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid,array['owner']) then
    raise exception 'Controlled Stripe live test results are not permitted' using errcode='42501';
  end if;
  select run.* into v_run from public.club_stripe_live_test_runs as run where run.merchant_entity=p_merchant_entity;
  if not found then return null; end if;
  return jsonb_build_object('id',v_run.id,'merchant_entity',v_run.merchant_entity,'stripe_account_id',v_run.stripe_account_id,'checkout_state',v_run.checkout_state,
    'payment_state',v_run.payment_state,'amount_minor',v_run.amount_minor,'currency',v_run.currency,
    'session_created',v_run.checkout_session_id is not null,'checkout_session_id',v_run.checkout_session_id,
    'payment_intent_id',v_run.payment_intent_id,'webhook_received_at',v_run.webhook_received_at,
    'last_provider_event_id',v_run.last_provider_event_id,'failure_class',v_run.failure_class,'created_at',v_run.created_at);
end; $$;
revoke all on function public.club_get_my_stripe_live_test_run(text) from public,anon;
grant execute on function public.club_get_my_stripe_live_test_run(text) to authenticated;

create or replace function public.club_set_stripe_live_test_session(p_run_id uuid,p_account_id text,p_session_id text)
returns void language plpgsql security definer set search_path=pg_catalog,public,auth as $$
begin
  if auth.role()<>'service_role' or p_account_id !~ '^acct_[A-Za-z0-9]+$' or p_session_id !~ '^cs_live_[A-Za-z0-9]+$' then
    raise exception 'Stripe test session binding is not permitted' using errcode='42501';
  end if;
  update public.club_stripe_live_test_runs as run set checkout_session_id=p_session_id,checkout_state='created'
   where run.id=p_run_id and run.stripe_account_id=p_account_id and run.checkout_state='creating' and run.checkout_session_id is null;
  if not found then raise exception 'Stripe test session does not match its reserved attempt' using errcode='22023'; end if;
end; $$;
revoke all on function public.club_set_stripe_live_test_session(uuid,text,text) from public,anon,authenticated;
grant execute on function public.club_set_stripe_live_test_session(uuid,text,text) to service_role;

create or replace function public.club_fail_stripe_live_test(p_run_id uuid,p_failure_class text)
returns void language plpgsql security definer set search_path=pg_catalog,public,auth as $$
begin
  if auth.role()<>'service_role' or p_failure_class !~ '^[a-z0-9_]{3,96}$' then raise exception 'Stripe test failure update is not permitted' using errcode='42501'; end if;
  update public.club_stripe_live_test_runs as run set failure_class=p_failure_class,
    checkout_state=case when run.checkout_session_id is null then 'failed' else run.checkout_state end
  where run.id=p_run_id and run.payment_state<>'paid';
end; $$;
revoke all on function public.club_fail_stripe_live_test(uuid,text) from public,anon,authenticated;
grant execute on function public.club_fail_stripe_live_test(uuid,text) to service_role;

create or replace function public.club_reconcile_stripe_live_test_event(
  p_event_id text,p_run_id uuid,p_merchant_entity text,p_account_id text,p_event_type text,p_event_created_at timestamptz,
  p_session_id text,p_payment_intent_id text,p_amount_minor integer,p_currency text,p_mode text,p_livemode boolean,p_payment_status text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare v_run public.club_stripe_live_test_runs%rowtype; v_new_payment text; v_new_checkout text;
begin
  if auth.role()<>'service_role' then raise exception 'Stripe webhook reconciliation is not permitted' using errcode='42501'; end if;
  if p_event_id is null or p_merchant_entity is null or p_account_id is null or p_run_id is null
    or p_event_type is null or p_event_created_at is null or p_amount_minor is null or p_currency is null or p_mode is null or p_livemode is null then
    raise exception 'Stripe test event is incomplete' using errcode='22023';
  end if;
  if p_merchant_entity not in ('madhouse_franchise','madhouse_products_services') or p_event_id !~ '^evt_[A-Za-z0-9]+$'
    or p_account_id !~ '^acct_[A-Za-z0-9]+$'
    or p_amount_minor<>100 or upper(p_currency)<>'GBP' or p_mode<>'payment' or p_livemode is distinct from true
    or p_event_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired','payment_intent.payment_failed')
    or (p_event_type='payment_intent.payment_failed' and (p_session_id is not null or p_payment_intent_id is null or p_payment_intent_id !~ '^pi_[A-Za-z0-9]+$' or p_payment_status is null or p_payment_status not in ('requires_payment_method','canceled')))
    or (p_event_type<>'payment_intent.payment_failed' and (p_session_id is null or p_session_id !~ '^cs_live_[A-Za-z0-9]+$')) then
    raise exception 'Stripe test event does not match the approved payment' using errcode='22023';
  end if;
  select run.* into v_run from public.club_stripe_live_test_runs as run where run.id=p_run_id for update;
  if not found or v_run.merchant_entity<>p_merchant_entity or v_run.stripe_account_id<>p_account_id or v_run.amount_minor<>p_amount_minor or v_run.currency<>upper(p_currency)
    or (p_session_id is not null and v_run.checkout_session_id is not null and v_run.checkout_session_id<>p_session_id)
    or (p_event_type='payment_intent.payment_failed' and v_run.checkout_session_id is null)
    or (v_run.payment_intent_id is not null and p_payment_intent_id is not null and v_run.payment_intent_id<>p_payment_intent_id)
    or v_run.checkout_state in ('failed','expired') then
    raise exception 'Stripe test event is from the wrong account or attempt' using errcode='22023';
  end if;
  insert into public.club_stripe_live_test_webhook_events(provider_event_id,run_id,merchant_entity,stripe_account_id,event_type,checkout_session_id,payment_intent_id,amount_minor,currency,provider_created_at)
  values (p_event_id,p_run_id,p_merchant_entity,p_account_id,p_event_type,coalesce(p_session_id,v_run.checkout_session_id),p_payment_intent_id,p_amount_minor,upper(p_currency),p_event_created_at)
  on conflict (provider_event_id) do nothing;
  if not found then return jsonb_build_object('duplicate',true); end if;

  v_new_checkout:=case when p_event_type='checkout.session.expired' then 'expired'
    when p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') then 'complete'
    else coalesce(v_run.checkout_state,'created') end;
  v_new_payment:=case when p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') and p_payment_status='paid' then 'paid'
    when p_event_type in ('checkout.session.async_payment_failed','payment_intent.payment_failed') then 'failed'
    when p_event_type='checkout.session.completed' then 'pending'
    else v_run.payment_state end;
  if v_new_payment='paid' and (p_payment_intent_id is null or p_payment_intent_id !~ '^pi_[A-Za-z0-9]+$' or p_payment_status<>'paid') then
    raise exception 'Paid Stripe test event has no verified PaymentIntent' using errcode='22023';
  end if;
  if v_run.payment_state='paid' then v_new_payment:='paid'; v_new_checkout:='complete'; end if;
  update public.club_stripe_live_test_runs as run set checkout_session_id=coalesce(run.checkout_session_id,p_session_id),
    checkout_state=v_new_checkout,payment_state=v_new_payment,payment_intent_id=coalesce(run.payment_intent_id,p_payment_intent_id),
    webhook_received_at=coalesce(run.webhook_received_at,now()),last_provider_event_id=p_event_id,
    failure_class=case when v_new_payment='paid' then null when v_new_payment='failed' then 'stripe_payment_failed' else run.failure_class end
  where run.id=p_run_id;
  return jsonb_build_object('duplicate',false,'payment_state',v_new_payment,'checkout_state',v_new_checkout);
end; $$;
revoke all on function public.club_reconcile_stripe_live_test_event(text,uuid,text,text,text,timestamptz,text,text,integer,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.club_reconcile_stripe_live_test_event(text,uuid,text,text,text,timestamptz,text,text,integer,text,text,boolean,text) to service_role;

commit;
