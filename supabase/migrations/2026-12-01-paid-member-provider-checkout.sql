-- Real hosted-provider handoff for paid member joining. This migration creates
-- no provider objects and performs no data or role backfill.

alter table public.club_membership_join_requests
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_checkout_generation integer not null default 0 check(stripe_checkout_generation>=0),
  add column if not exists stripe_event_occurred_at timestamptz,
  add column if not exists gocardless_redirect_flow_id text,
  add column if not exists gocardless_customer_id text,
  add column if not exists gocardless_bank_account_id text,
  add column if not exists gocardless_mandate_id text,
  add column if not exists gocardless_flow_generation integer not null default 0 check(gocardless_flow_generation>=0),
  add column if not exists gocardless_event_occurred_at timestamptz;

create unique index if not exists club_join_stripe_session_uq on public.club_membership_join_requests(stripe_checkout_session_id) where stripe_checkout_session_id is not null;
create unique index if not exists club_join_stripe_payment_uq on public.club_membership_join_requests(stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create unique index if not exists club_join_gc_redirect_uq on public.club_membership_join_requests(gocardless_redirect_flow_id) where gocardless_redirect_flow_id is not null;
create unique index if not exists club_join_gc_mandate_uq on public.club_membership_join_requests(gocardless_mandate_id) where gocardless_mandate_id is not null;

create or replace function public.club_guard_activated_join_commercial_identity()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if old.membership_id is not null and (
    new.organisation_id is distinct from old.organisation_id or new.user_id is distinct from old.user_id or
    new.customer_id is distinct from old.customer_id or new.product_id is distinct from old.product_id or
    new.location_id is distinct from old.location_id or new.membership_id is distinct from old.membership_id or
    new.checkout_kind is distinct from old.checkout_kind or new.joining_fee_minor is distinct from old.joining_fee_minor or
    new.first_period_minor is distinct from old.first_period_minor or new.upfront_amount_minor is distinct from old.upfront_amount_minor or
    new.status is distinct from old.status
  ) then raise exception 'Activated joining records cannot be reused' using errcode='22023'; end if;
  return new;
end;
$$;
drop trigger if exists club_guard_activated_join_commercial_identity on public.club_membership_join_requests;
create trigger club_guard_activated_join_commercial_identity before update on public.club_membership_join_requests
for each row execute function public.club_guard_activated_join_commercial_identity();
revoke all on function public.club_guard_activated_join_commercial_identity() from public,anon,authenticated;

create or replace function public.club_prepare_join_provider_attempt(p_request_id uuid,p_provider_type text,p_replace_reference text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; c public.club_customers%rowtype; p public.club_products%rowtype; o public.club_organisations%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into r from public.club_membership_join_requests where id=p_request_id and user_id=auth.uid() for update;
  if not found or r.membership_id is not null or r.status in ('active','completed','cancelled') then raise exception 'Joining attempt is not available' using errcode='42501'; end if;
  select * into p from public.club_products where id=r.product_id and organisation_id=r.organisation_id and sellable and archived_at is null;
  select * into c from public.club_customers where id=r.customer_id and organisation_id=r.organisation_id;
  select * into o from public.club_organisations where id=r.organisation_id and active and member_joinable;
  if p.id is null or c.id is null or o.id is null then raise exception 'Joining attempt is no longer available' using errcode='22023'; end if;
  if p_provider_type='stripe' then
    if r.upfront_amount_minor<=0 or r.upfront_payment_state='confirmed' then raise exception 'Card payment is not required' using errcode='22023'; end if;
    if p_replace_reference is not null then
      if r.stripe_checkout_session_id is distinct from p_replace_reference then raise exception 'Card checkout changed; resume the current attempt' using errcode='40001'; end if;
      update public.club_membership_join_requests set stripe_checkout_session_id=null,stripe_payment_intent_id=null,
        stripe_checkout_generation=stripe_checkout_generation+1 where id=r.id;
    elsif r.stripe_checkout_generation=0 then
      update public.club_membership_join_requests set stripe_checkout_generation=1 where id=r.id;
    end if;
    update public.club_membership_join_requests set upfront_payment_state='pending',payment_state='pending',status='payment_pending',
      payment_failure_reason=null,last_activity_at=now(),updated_at=now() where id=r.id returning * into r;
  elsif p_provider_type='gocardless' then
    if r.checkout_kind<>'monthly_recurring' or r.upfront_payment_state<>'confirmed' or r.recurring_authority_state='confirmed' then raise exception 'Direct Debit setup is not available' using errcode='22023'; end if;
    if r.recurring_authority_state='failed' and p_replace_reference is null and r.gocardless_redirect_flow_id is not null then
      update public.club_membership_join_requests set gocardless_redirect_flow_id=null,gocardless_customer_id=null,
        gocardless_bank_account_id=null,gocardless_mandate_id=null,gocardless_flow_generation=gocardless_flow_generation+1 where id=r.id;
    elsif p_replace_reference is not null then
      if r.gocardless_redirect_flow_id is distinct from p_replace_reference then raise exception 'Direct Debit setup changed; resume the current attempt' using errcode='40001'; end if;
      update public.club_membership_join_requests set gocardless_redirect_flow_id=null,gocardless_customer_id=null,
        gocardless_bank_account_id=null,gocardless_mandate_id=null,gocardless_flow_generation=gocardless_flow_generation+1 where id=r.id;
    elsif r.gocardless_flow_generation=0 then
      update public.club_membership_join_requests set gocardless_flow_generation=1 where id=r.id;
    end if;
    update public.club_membership_join_requests set recurring_authority_state='pending',payment_state='pending',status='payment_pending',
      payment_failure_reason=null,last_activity_at=now(),updated_at=now() where id=r.id returning * into r;
  else raise exception 'Unsupported joining provider' using errcode='22023'; end if;
  return jsonb_build_object(
    'id',r.id,'organisation_id',r.organisation_id,'organisation_slug',o.slug,'user_id',r.user_id,'customer_id',r.customer_id,
    'product_id',r.product_id,'product_name',p.name,'currency',p.currency,'checkout_kind',r.checkout_kind,
    'upfront_amount_minor',r.upfront_amount_minor,'upfront_payment_state',r.upfront_payment_state,
    'recurring_authority_state',r.recurring_authority_state,'email',c.email,'display_name',c.display_name,
    'stripe_checkout_session_id',r.stripe_checkout_session_id,'stripe_checkout_generation',r.stripe_checkout_generation,
    'gocardless_redirect_flow_id',r.gocardless_redirect_flow_id,'gocardless_mandate_id',r.gocardless_mandate_id,
    'gocardless_flow_generation',r.gocardless_flow_generation
  );
end;
$$;
revoke all on function public.club_prepare_join_provider_attempt(uuid,text,text) from public,anon;
grant execute on function public.club_prepare_join_provider_attempt(uuid,text,text) to authenticated;

create or replace function public.club_store_join_provider_resource(
  p_request_id uuid,p_provider_type text,p_primary_reference text,p_payment_reference text default null,
  p_customer_reference text default null,p_bank_account_reference text default null,p_mandate_reference text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype;
begin
  if auth.role()<>'service_role' or nullif(btrim(p_primary_reference),'') is null then raise exception 'Provider resource update is not permitted' using errcode='42501'; end if;
  select * into r from public.club_membership_join_requests where id=p_request_id for update;
  if not found then raise exception 'Join request not found' using errcode='P0002'; end if;
  if p_provider_type='stripe' then
    if p_primary_reference !~ '^cs_' then raise exception 'Stripe session is invalid' using errcode='22023'; end if;
    if r.stripe_checkout_session_id is not null and r.stripe_checkout_session_id<>p_primary_reference then
      return jsonb_build_object('ignored',true,'reason','superseded_provider_session');
    end if;
    update public.club_membership_join_requests set stripe_checkout_session_id=p_primary_reference,
      stripe_payment_intent_id=coalesce(nullif(btrim(p_payment_reference),''),stripe_payment_intent_id),upfront_payment_state=case when upfront_payment_state='confirmed' then 'confirmed' else 'pending' end,
      payment_state=case when payment_state='confirmed' then 'confirmed' else 'pending' end,updated_at=now() where id=r.id returning * into r;
  elsif p_provider_type='gocardless' then
    if p_primary_reference !~ '^RE' or (r.gocardless_redirect_flow_id is not null and r.gocardless_redirect_flow_id<>p_primary_reference) then raise exception 'GoCardless flow does not match this attempt' using errcode='22023'; end if;
    update public.club_membership_join_requests set gocardless_redirect_flow_id=p_primary_reference,
      gocardless_customer_id=coalesce(nullif(btrim(p_customer_reference),''),gocardless_customer_id),
      gocardless_bank_account_id=coalesce(nullif(btrim(p_bank_account_reference),''),gocardless_bank_account_id),
      gocardless_mandate_id=coalesce(nullif(btrim(p_mandate_reference),''),gocardless_mandate_id),
      recurring_authority_reference=coalesce(nullif(btrim(p_mandate_reference),''),recurring_authority_reference),
      recurring_authority_state=case when recurring_authority_state='confirmed' then 'confirmed' else 'pending' end,
      payment_state=case when payment_state='confirmed' then 'confirmed' else 'pending' end,updated_at=now() where id=r.id returning * into r;
  else raise exception 'Unsupported joining provider' using errcode='22023'; end if;
  return to_jsonb(r);
end;
$$;
revoke all on function public.club_store_join_provider_resource(uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.club_store_join_provider_resource(uuid,text,text,text,text,text,text) to service_role;

create or replace function public.club_find_join_request_by_provider_reference(p_provider_type text,p_provider_reference text)
returns uuid language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'Provider lookup is not permitted' using errcode='42501'; end if;
  if p_provider_type='stripe' then select id into v_id from public.club_membership_join_requests where stripe_checkout_session_id=p_provider_reference or stripe_payment_intent_id=p_provider_reference;
  elsif p_provider_type='gocardless' then select id into v_id from public.club_membership_join_requests where gocardless_redirect_flow_id=p_provider_reference or gocardless_mandate_id=p_provider_reference;
  else raise exception 'Unsupported joining provider' using errcode='22023'; end if;
  return v_id;
end;
$$;
revoke all on function public.club_find_join_request_by_provider_reference(text,text) from public,anon,authenticated;
grant execute on function public.club_find_join_request_by_provider_reference(text,text) to service_role;

create or replace function public.club_record_join_provider_event(p_request_id uuid,p_provider_type text,p_provider_event_key text,p_event_type text,p_amount_minor integer,p_provider_reference text,p_occurred_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; p public.club_products%rowtype; m public.club_memberships%rowtype; e public.club_membership_join_provider_events%rowtype; v_start timestamptz; v_end timestamptz; v_next timestamptz;
begin
  if auth.role()<>'service_role' then raise exception 'Provider event is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_provider_event_key),'') is null or p_event_type not in ('upfront_confirmed','upfront_failed','mandate_confirmed','mandate_failed') then raise exception 'Invalid join provider event' using errcode='22023'; end if;
  select * into r from public.club_membership_join_requests where id=p_request_id for update;
  if not found then raise exception 'Join request not found' using errcode='P0002'; end if;
  if p_event_type like 'upfront_%' and (p_provider_type<>'stripe' or p_amount_minor is distinct from r.upfront_amount_minor) then raise exception 'Upfront payment does not match the join request' using errcode='22023'; end if;
  if p_event_type like 'mandate_%' and (r.checkout_kind<>'monthly_recurring' or p_provider_type<>'gocardless' or p_provider_reference is distinct from r.gocardless_mandate_id) then raise exception 'Recurring authority does not match this join' using errcode='22023'; end if;
  if p_event_type in ('upfront_confirmed','mandate_confirmed') and nullif(btrim(p_provider_reference),'') is null then raise exception 'Provider confirmation reference is required' using errcode='22023'; end if;
  insert into public.club_membership_join_provider_events(organisation_id,join_request_id,provider_type,provider_event_key,event_type,amount_minor,provider_reference,occurred_at)
    values(r.organisation_id,r.id,p_provider_type,p_provider_event_key,p_event_type,p_amount_minor,nullif(btrim(p_provider_reference),''),coalesce(p_occurred_at,now()))
    on conflict(organisation_id,provider_type,provider_event_key) do nothing;
  select * into e from public.club_membership_join_provider_events where organisation_id=r.organisation_id and provider_type=p_provider_type and provider_event_key=p_provider_event_key;
  if e.join_request_id<>r.id then raise exception 'Provider event belongs to another join request' using errcode='22023'; end if;
  if e.event_type='upfront_confirmed' and (e.provider_reference=r.stripe_checkout_session_id or e.provider_reference=r.stripe_payment_intent_id)
    and (r.stripe_event_occurred_at is null or e.occurred_at>=r.stripe_event_occurred_at) then
    update public.club_membership_join_requests set upfront_payment_state='confirmed',payment_provider_reference=e.provider_reference,
      stripe_event_occurred_at=e.occurred_at,payment_failure_reason=null,updated_at=now() where id=r.id;
  elsif e.event_type='upfront_failed' and (e.provider_reference=r.stripe_checkout_session_id or e.provider_reference=r.stripe_payment_intent_id or (e.provider_reference like 'pi_%' and r.stripe_payment_intent_id is null))
    and r.upfront_payment_state<>'confirmed' and (r.stripe_event_occurred_at is null or e.occurred_at>=r.stripe_event_occurred_at) then
    update public.club_membership_join_requests set upfront_payment_state='failed',payment_state='failed',status='payment_failed',
      stripe_payment_intent_id=case when e.provider_reference like 'pi_%' then e.provider_reference else stripe_payment_intent_id end,
      stripe_event_occurred_at=e.occurred_at,payment_failure_reason='Upfront card payment failed',updated_at=now() where id=r.id;
  elsif e.event_type='mandate_confirmed' and (r.gocardless_event_occurred_at is null or e.occurred_at>=r.gocardless_event_occurred_at) then
    update public.club_membership_join_requests set recurring_authority_state='confirmed',recurring_authority_reference=e.provider_reference,
      gocardless_mandate_id=e.provider_reference,gocardless_event_occurred_at=e.occurred_at,payment_failure_reason=null,updated_at=now() where id=r.id;
  elsif e.event_type='mandate_failed' and (r.gocardless_event_occurred_at is null or e.occurred_at>=r.gocardless_event_occurred_at) then
    update public.club_membership_join_requests set recurring_authority_state='failed',payment_state='failed',status=case when membership_id is null then 'payment_failed' else status end,
      gocardless_event_occurred_at=e.occurred_at,payment_failure_reason='Direct Debit mandate setup failed or was cancelled',updated_at=now() where id=r.id;
  end if;
  select * into r from public.club_membership_join_requests where id=r.id;
  if r.upfront_payment_state='confirmed' and (r.checkout_kind<>'monthly_recurring' or r.recurring_authority_state='confirmed') and r.membership_id is null then
    select * into p from public.club_products where id=r.product_id and organisation_id=r.organisation_id and sellable and archived_at is null;
    if not found then raise exception 'Membership product is unavailable' using errcode='22023'; end if;
    v_start:=coalesce(greatest(r.stripe_event_occurred_at,r.gocardless_event_occurred_at),r.stripe_event_occurred_at,r.gocardless_event_occurred_at,now());
    v_end:=case when r.checkout_kind='monthly_recurring' then null when p.duration_days is not null then v_start+make_interval(days=>p.duration_days) end;
    select * into m from public.club_memberships where organisation_id=r.organisation_id and assignment_idempotency_key='join:'||r.id for update;
    if not found then
      insert into public.club_memberships(organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key)
        values(r.organisation_id,p.id,'active',v_start,v_end,'purchase','join:'||r.id) returning * into m;
    end if;
    if not exists(select 1 from public.club_membership_holders where membership_id=m.id and user_id=r.user_id) then
      insert into public.club_membership_holders(id,membership_id,organisation_id,user_id) values(gen_random_uuid(),m.id,r.organisation_id,r.user_id);
    end if;
    insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
      select r.user_id,m.organisation_id,m.id,x.entitlement_key,x.scope,coalesce(x.location_ids,'{}'),x.allowance_quantity,x.allowance_period,x.discount_percent,x.discount_period,x.discount_max_uses,m.starts_at,m.ends_at,m.source
      from public.club_product_entitlements x where x.product_id=p.id and not exists(select 1 from public.club_entitlement_grants g where g.membership_id=m.id and g.user_id=r.user_id and g.entitlement_key=x.entitlement_key);
    if r.checkout_kind='monthly_recurring' then
      v_next:=public.club_membership_anniversary(v_start,r.billing_anchor_day,1);
      insert into public.club_membership_billing_arrangements(organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,provider_customer_reference,provider_subscription_reference,amount_minor,currency,frequency,next_due_at,billing_anchor_day,last_successful_payment_at)
        values(r.organisation_id,m.id,r.user_id,r.customer_id,'gocardless','direct_debit',r.gocardless_customer_id,r.gocardless_mandate_id,r.first_period_minor,p.currency,'monthly',v_next,r.billing_anchor_day,v_start)
      on conflict(organisation_id,membership_id) do update set provider_customer_reference=excluded.provider_customer_reference,provider_subscription_reference=excluded.provider_subscription_reference;
    end if;
    update public.club_membership_join_requests set membership_id=m.id,status='active',payment_state='confirmed',paid_through_at=coalesce(v_end,v_next),
      completed_at=coalesce(completed_at,now()),last_activity_at=now(),updated_at=now() where id=r.id returning * into r;
    update public.club_member_notification_intents set state='cancelled' where join_request_id=r.id and template_key='join_incomplete';
    if r.checkout_kind='annual_one_off' and v_end is not null then
      insert into public.club_member_notification_intents(organisation_id,user_id,join_request_id,category,template_key,state,idempotency_key,not_before) values
        (r.organisation_id,r.user_id,r.id,'billing','annual_renewal_1_month','unavailable','annual-renewal-month:'||r.id,v_end-interval '1 month'),
        (r.organisation_id,r.user_id,r.id,'billing','annual_renewal_1_week','unavailable','annual-renewal-week:'||r.id,v_end-interval '7 days'),
        (r.organisation_id,r.user_id,r.id,'billing','annual_renewal_final_days','unavailable','annual-renewal-final:'||r.id,v_end-interval '3 days')
      on conflict(organisation_id,idempotency_key) do nothing;
    end if;
  elsif r.membership_id is null and r.upfront_payment_state='confirmed' then
    update public.club_membership_join_requests set status='payment_required',payment_state='pending',updated_at=now() where id=r.id returning * into r;
  end if;
  return jsonb_build_object('event',to_jsonb(e),'request',to_jsonb(r),'membership_id',r.membership_id);
end;
$$;
revoke all on function public.club_record_join_provider_event(uuid,text,text,text,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.club_record_join_provider_event(uuid,text,text,text,integer,text,timestamptz) to service_role;

create or replace function public.club_get_my_join_state(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select j.*,p.name product_name,p.price_minor,p.currency,p.billing,l.name location_name into r
    from public.club_membership_join_requests j join public.club_products p on p.id=j.product_id left join public.club_locations l on l.id=j.location_id
    where j.organisation_id=p_organisation_id and j.user_id=auth.uid() order by j.updated_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id',r.id,'status',r.status,'payment_state',r.payment_state,'payment_method',r.payment_method,
    'payment_provider',r.payment_provider,'product_name',r.product_name,'price_minor',r.price_minor,'currency',r.currency,
    'billing',r.billing,'location_name',r.location_name,'membership_id',r.membership_id,'updated_at',r.updated_at,
    'checkout_kind',r.checkout_kind,'joining_fee_minor',r.joining_fee_minor,'first_period_minor',r.first_period_minor,
    'upfront_amount_minor',r.upfront_amount_minor,'upfront_payment_state',r.upfront_payment_state,
    'recurring_authority_state',r.recurring_authority_state,'paid_through_at',r.paid_through_at,
    'stripe_checkout_ready',r.stripe_checkout_session_id is not null,'gocardless_flow_ready',r.gocardless_redirect_flow_id is not null,
    'activation_blocked_by',case when r.membership_id is not null then null when r.upfront_payment_state<>'confirmed' then 'upfront_card_payment'
      when r.checkout_kind='monthly_recurring' and r.recurring_authority_state<>'confirmed' then 'direct_debit_mandate' else null end);
end;
$$;
revoke all on function public.club_get_my_join_state(uuid) from public,anon;
grant execute on function public.club_get_my_join_state(uuid) to authenticated;
