-- Enforce the two Stripe legal-entity boundaries on membership checkout and
-- reconciliation. This forward-only migration changes no customer/payment rows.
begin;

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
  if p.id is null or p.kind<>'membership' or c.id is null or o.id is null or r.upfront_amount_minor<=0 then
    raise exception 'Only a valid gym membership can use Franchise Stripe checkout' using errcode='22023';
  end if;
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
  return jsonb_build_object('id',r.id,'membership_product_id',p.id,'organisation_slug',o.slug,'product_name',p.name,'currency',p.currency,'email',c.email,
    'checkout_kind',r.checkout_kind,'joining_fee_minor',r.joining_fee_minor,'first_period_minor',r.first_period_minor,
    'upfront_amount_minor',r.upfront_amount_minor,'stripe_checkout_session_id',r.stripe_checkout_session_id,
    'stripe_checkout_generation',r.stripe_checkout_generation,'upfront_payment_state',r.upfront_payment_state,
    'recurring_authority_state',r.recurring_authority_state);
end; $$;
revoke all on function public.club_prepare_stripe_membership_attempt(uuid,text) from public,anon;
grant execute on function public.club_prepare_stripe_membership_attempt(uuid,text) to authenticated;

create or replace function public.club_bind_stripe_join_account(p_request_id uuid,p_account_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype;
begin
  if auth.role()<>'service_role' or p_account_id !~ '^acct_[A-Za-z0-9]+$' then raise exception 'Stripe membership account binding is not permitted' using errcode='42501'; end if;
  update public.club_membership_join_requests as request set stripe_merchant_entity='madhouse_franchise',stripe_account_id=coalesce(request.stripe_account_id,p_account_id),updated_at=now()
    where request.id=p_request_id and request.membership_id is null and request.status not in ('active','cancelled')
      and (request.stripe_merchant_entity is null or request.stripe_merchant_entity='madhouse_franchise')
      and (request.stripe_account_id is null or request.stripe_account_id=p_account_id)
      and exists(select 1 from public.club_products as product where product.id=request.product_id and product.organisation_id=request.organisation_id and product.kind='membership')
    returning request.* into r;
  if not found then raise exception 'Only an available gym membership can be bound to Franchise Stripe' using errcode='22023'; end if;
  return to_jsonb(r);
end; $$;
revoke all on function public.club_bind_stripe_join_account(uuid,text) from public,anon,authenticated;
grant execute on function public.club_bind_stripe_join_account(uuid,text) to service_role;

create or replace function public.club_record_stripe_membership_event_for_account(
  p_request_id uuid,p_attempt_generation integer,p_provider_event_key text,p_event_type text,p_occurred_at timestamptz,
  p_session_id text,p_payment_intent_id text,p_customer_id text,p_subscription_id text,p_invoice_id text,p_charge_id text,
  p_amount_minor integer,p_currency text,p_status text,p_billing_reason text,p_period_start timestamptz,p_period_end timestamptz,
  p_merchant_entity text,p_account_id text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; result jsonb;
begin
  if auth.role()<>'service_role' or p_merchant_entity<>'madhouse_franchise' or p_account_id !~ '^acct_[A-Za-z0-9]+$' then
    raise exception 'Stripe membership merchant is not permitted' using errcode='42501';
  end if;
  select * into r from public.club_membership_join_requests as request where request.id=p_request_id for update;
  if not found or r.stripe_merchant_entity is distinct from p_merchant_entity or r.stripe_account_id is distinct from p_account_id then
    raise exception 'Stripe event account does not match the joining account' using errcode='42501';
  end if;
  if not exists(select 1 from public.club_products as product where product.id=r.product_id and product.organisation_id=r.organisation_id and product.kind='membership') then
    raise exception 'Franchise Stripe events cannot fulfil transformation or service products' using errcode='22023';
  end if;
  if (p_session_id is not null and r.stripe_checkout_session_id is distinct from p_session_id)
    or (p_customer_id is not null and r.stripe_customer_id is not null and r.stripe_customer_id<>p_customer_id)
    or (p_subscription_id is not null and r.stripe_subscription_id is not null and r.stripe_subscription_id<>p_subscription_id)
    or (p_attempt_generation is not null and p_attempt_generation<>r.stripe_checkout_generation) then
    raise exception 'Stripe resource does not match the current joining attempt' using errcode='22023';
  end if;
  result:=public.club_record_stripe_membership_event(p_request_id,p_attempt_generation,p_provider_event_key,p_event_type,p_occurred_at,
    p_session_id,p_payment_intent_id,p_customer_id,p_subscription_id,p_invoice_id,p_charge_id,p_amount_minor,p_currency,p_status,p_billing_reason,p_period_start,p_period_end);
  update public.club_stripe_membership_events as event set stripe_merchant_entity=p_merchant_entity,stripe_account_id=p_account_id
    where event.provider_event_key=p_provider_event_key;
  return result;
end; $$;
revoke all on function public.club_record_stripe_membership_event_for_account(uuid,integer,text,text,timestamptz,text,text,text,text,text,text,integer,text,text,text,timestamptz,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.club_record_stripe_membership_event_for_account(uuid,integer,text,text,timestamptz,text,text,text,text,text,text,integer,text,text,text,timestamptz,timestamptz,text,text) to service_role;

-- Expose the authoritative membership payment route in existing billing
-- reads so finance/member records do not label Franchise card billing as DD.
create or replace function public.club_get_member_billing(p_organisation_id uuid,p_user_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'id',obligation.id,'membership_id',obligation.membership_id,'arrangement_id',obligation.arrangement_id,
  'amount_minor',obligation.amount_minor,'currency',obligation.currency,'next_due_at',obligation.next_due_at,
  'arrangement_next_due_at',arrangement.next_due_at,'frequency',arrangement.frequency,'state',obligation.state,
  'payment_method_family',arrangement.payment_method_family,'provider_type',arrangement.provider_type,
  'stripe_merchant_entity',case when arrangement.provider_type='stripe' then join_request.stripe_merchant_entity end,
  'grace_started_at',obligation.grace_started_at,'failure_reason',obligation.failure_reason,
  'provider_status',obligation.provider_status,'provider_charge_date',obligation.provider_charge_date,
  'mandate_status',arrangement.provider_authority_state,'collection_status',arrangement.collection_status,
  'action_required_reason',arrangement.action_required_reason,'paid_through_at',arrangement.coverage_paid_through_at
) order by obligation.next_due_at),'[]'::jsonb)
from public.club_membership_billing_obligations as obligation
join public.club_membership_billing_arrangements as arrangement
  on arrangement.id=obligation.arrangement_id and arrangement.organisation_id=obligation.organisation_id
left join lateral (
  select request.stripe_merchant_entity
  from public.club_membership_join_requests as request
  where request.organisation_id=arrangement.organisation_id and request.membership_id=arrangement.membership_id
  order by request.updated_at desc limit 1
) as join_request on true
where obligation.organisation_id=p_organisation_id and obligation.user_id=p_user_id and auth.uid()=p_user_id;
$$;

create or replace function public.club_list_customer_billing(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'id',obligation.id,'membership_id',obligation.membership_id,'amount_minor',obligation.amount_minor,
  'currency',obligation.currency,'next_due_at',obligation.next_due_at,'state',obligation.state,
  'payment_method_family',obligation.payment_method_family,'provider_type',arrangement.provider_type,
  'stripe_merchant_entity',case when arrangement.provider_type='stripe' then join_request.stripe_merchant_entity end,'failure_reason',obligation.failure_reason,
  'provider_status',obligation.provider_status,'provider_charge_date',obligation.provider_charge_date,
  'provider_payment_reference',obligation.provider_payment_reference,
  'mandate_status',arrangement.provider_authority_state,'collection_status',arrangement.collection_status,
  'action_required_reason',arrangement.action_required_reason,'paid_through_at',arrangement.coverage_paid_through_at
) order by obligation.next_due_at),'[]'::jsonb)
from public.club_membership_billing_obligations as obligation
join public.club_membership_billing_arrangements as arrangement
  on arrangement.id=obligation.arrangement_id and arrangement.organisation_id=obligation.organisation_id
left join lateral (
  select request.stripe_merchant_entity
  from public.club_membership_join_requests as request
  where request.organisation_id=arrangement.organisation_id and request.membership_id=arrangement.membership_id
  order by request.updated_at desc limit 1
) as join_request on true
where obligation.organisation_id=p_organisation_id
  and (obligation.customer_id=p_customer_id or exists(select 1 from public.club_customers as customer where customer.id=p_customer_id and customer.organisation_id=obligation.organisation_id and customer.user_id=obligation.user_id))
  and public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take');
$$;
revoke all on function public.club_get_member_billing(uuid,uuid),public.club_list_customer_billing(uuid,uuid) from public,anon;
grant execute on function public.club_get_member_billing(uuid,uuid),public.club_list_customer_billing(uuid,uuid) to authenticated;

commit;
