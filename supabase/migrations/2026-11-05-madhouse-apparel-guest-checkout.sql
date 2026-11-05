-- Allow one-off Madhouse Apparel Checkout Sessions to complete without a
-- Stripe Customer. All existing merchant, attempt, session, amount, currency,
-- payment-intent, event-idempotency and paid-status checks remain in force.

create or replace function public.club_record_stripe_commerce_event(
  p_event_id text,p_attempt_id uuid,p_merchant_entity text,p_account_id text,p_event_type text,p_occurred_at timestamptz,
  p_session_id text default null,p_payment_intent_id text default null,p_customer_id text default null,
  p_amount_minor integer default null,p_refunded_minor integer default null,p_currency text default null,p_status text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_payment_attempts%rowtype; o public.club_orders%rowtype; prior public.club_stripe_commerce_events%rowtype; payment public.club_payments%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Stripe commerce event is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_event_id),'') is null or p_occurred_at is null
    or p_merchant_entity<>'madhouse_products_services' or p_account_id !~ '^acct_[A-Za-z0-9]+$'
    or p_event_type not in ('checkout_pending','checkout_paid','checkout_failed','checkout_expired','charge_refunded','dispute_opened','dispute_closed') then
    raise exception 'Stripe commerce event is invalid' using errcode='22023';
  end if;
  select * into prior from public.club_stripe_commerce_events where provider_event_key=p_event_id;
  if found then return jsonb_build_object('duplicate',true); end if;
  select * into a from public.club_payment_attempts where id=p_attempt_id for update;
  if not found or a.stripe_merchant_entity<>p_merchant_entity or a.stripe_account_id is distinct from p_account_id then
    raise exception 'Stripe event merchant does not match its payment attempt' using errcode='42501';
  end if;
  select * into o from public.club_orders where id=a.order_id and organisation_id=a.organisation_id for update;
  if not found then raise exception 'Stripe order is missing' using errcode='P0002'; end if;
  if p_session_id is not null and a.stripe_checkout_session_id is distinct from p_session_id then
    raise exception 'Stripe Checkout session does not match its payment attempt' using errcode='22023';
  end if;
  if p_payment_intent_id is not null and a.stripe_payment_intent_id is not null and a.stripe_payment_intent_id<>p_payment_intent_id then
    raise exception 'Stripe PaymentIntent does not match its payment attempt' using errcode='22023';
  end if;
  if p_event_type in ('checkout_pending','checkout_paid','checkout_failed','checkout_expired') then
    if (p_session_id is null and not (p_event_type='checkout_failed' and p_payment_intent_id is not null))
      or p_session_id is not null and a.stripe_checkout_session_id is distinct from p_session_id
      or p_amount_minor is distinct from a.external_amount_minor or p_currency is null or upper(p_currency)<>o.currency then
      raise exception 'Stripe checkout amount, currency or session does not match' using errcode='22023';
    end if;
  elsif p_payment_intent_id is null then
    raise exception 'Stripe reversal has no PaymentIntent reference' using errcode='22023';
  end if;
  insert into public.club_stripe_commerce_events(provider_event_key,merchant_entity,stripe_account_id,organisation_id,payment_attempt_id,order_id,event_type,provider_occurred_at,checkout_session_id,payment_intent_id,customer_id,amount_minor,refunded_minor,currency,provider_status)
    values(p_event_id,p_merchant_entity,p_account_id,a.organisation_id,a.id,o.id,p_event_type,p_occurred_at,p_session_id,p_payment_intent_id,p_customer_id,p_amount_minor,p_refunded_minor,upper(p_currency),p_status);
  update public.club_payment_attempts set stripe_payment_intent_id=coalesce(stripe_payment_intent_id,p_payment_intent_id),
    stripe_customer_id=coalesce(stripe_customer_id,p_customer_id),updated_at=now() where id=a.id returning * into a;
  if p_event_type='checkout_paid' then
    -- A guest card payment is valid without a Stripe Customer. The signed
    -- event, Products & Services account, attempt, session, PaymentIntent,
    -- amount, currency and paid status still have to match.
    if p_status is distinct from 'paid' or p_payment_intent_id is null or p_amount_minor<>a.external_amount_minor then
      return jsonb_build_object('ignored',true,'reason','checkout_not_fully_paid');
    end if;
    perform public.club_capture_payment_attempt(a.id,p_payment_intent_id);
    update public.club_payments set stripe_merchant_entity=p_merchant_entity,stripe_account_id=p_account_id
      where organisation_id=a.organisation_id and external_reference=p_payment_intent_id returning * into payment;
  elsif p_event_type in ('checkout_failed','checkout_expired') and a.status='pending' then
    update public.club_payment_attempts set status=case when p_event_type='checkout_expired' then 'cancelled' else 'failed' end,
      failure_reason=case when p_event_type='checkout_expired' then 'Stripe Checkout expired' else 'Stripe payment failed' end,updated_at=now()
      where id=a.id returning * into a;
    update public.club_balance_holds set status='released',updated_at=now() where payment_attempt_id=a.id and status='held';
    update public.club_orders set status='cancelled',updated_at=now() where id=o.id and status='pending_payment';
  elsif p_event_type in ('charge_refunded','dispute_opened','dispute_closed') then
    select * into payment from public.club_payments where organisation_id=a.organisation_id and external_reference=p_payment_intent_id for update;
    if not found or payment.stripe_merchant_entity<>p_merchant_entity or payment.stripe_account_id<>p_account_id then
      raise exception 'Stripe reversal is not linked to a Products and Services payment' using errcode='42501';
    end if;
    if p_amount_minor is distinct from payment.amount_minor or p_currency is null or upper(p_currency)<>payment.currency then
      raise exception 'Stripe reversal amount or currency does not match the payment' using errcode='22023';
    end if;
    if p_event_type='charge_refunded' then
      if p_refunded_minor is null or p_refunded_minor<0 or p_refunded_minor>payment.amount_minor then raise exception 'Stripe refund amount is invalid' using errcode='22023'; end if;
      if payment.stripe_last_refund_at is null or p_occurred_at>=payment.stripe_last_refund_at then
        update public.club_payments set stripe_refunded_minor=p_refunded_minor,stripe_last_refund_at=p_occurred_at,
          status=case when p_refunded_minor=amount_minor then 'refunded' when p_refunded_minor>0 then 'partially_refunded' else status end,updated_at=now()
          where id=payment.id;
        if p_refunded_minor=payment.amount_minor then update public.club_orders set status='refunded',updated_at=now() where id=o.id and status in ('paid','fulfilled'); end if;
      end if;
    elsif p_event_type='dispute_opened' and (payment.stripe_last_dispute_at is null or p_occurred_at>=payment.stripe_last_dispute_at) then
      update public.club_payments set stripe_dispute_state='open',stripe_last_dispute_at=p_occurred_at,updated_at=now() where id=payment.id;
    elsif p_event_type='dispute_closed' and (payment.stripe_last_dispute_at is null or p_occurred_at>=payment.stripe_last_dispute_at) then
      update public.club_payments set stripe_dispute_state=case when p_status='won' then 'won' when p_status='warning_closed' then 'warning_closed' else 'lost' end,stripe_last_dispute_at=p_occurred_at,updated_at=now() where id=payment.id;
    end if;
  end if;
  return jsonb_build_object('duplicate',false,'status',a.status,'order_id',o.id);
end; $$;

revoke all on function public.club_record_stripe_commerce_event(text,uuid,text,text,text,timestamptz,text,text,text,integer,integer,text,text) from public,anon,authenticated;
grant execute on function public.club_record_stripe_commerce_event(text,uuid,text,text,text,timestamptz,text,text,text,integer,integer,text,text) to service_role;
