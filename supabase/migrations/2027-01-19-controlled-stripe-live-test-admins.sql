-- Extend the existing isolated £1 test path to Madhouse management admins.
-- This grants no table access and does not change any operational permissions.
begin;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.club_stripe_live_test_runs'::regclass
      and conname='club_stripe_live_test_runs_keenan_account_holder'
  ) then
    alter table public.club_stripe_live_test_runs
      add constraint club_stripe_live_test_runs_keenan_account_holder
      check (observed_account_holder='Keenan Freer');
  end if;
end $$;

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
    or p_observed_account_holder is distinct from 'Keenan Freer' or jsonb_typeof(p_signed_approval)<>'object'
    or p_approval_signature !~ '^[A-Za-z0-9+/]+={0,2}$'
    or not exists(select 1 from public.club_members as member where member.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid and member.user_id=p_actor_id and member.active and member.role in ('owner','gym_admin')) then
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
    or not public.club_has_active_role('fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid,array['owner','gym_admin']) then
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

commit;
