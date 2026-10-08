-- Trusted, idempotent GoCardless recurring collections for active memberships.
-- Apply only after 2026-12-01-paid-member-provider-checkout.sql.

alter table public.club_membership_billing_arrangements
  add column if not exists provider_authority_state text not null default 'unknown',
  add column if not exists collection_status text not null default 'blocked',
  add column if not exists coverage_paid_through_at timestamptz,
  add column if not exists initial_paid_through_at timestamptz,
  add column if not exists mandate_event_occurred_at timestamptz,
  add column if not exists action_required_reason text;

alter table public.club_membership_billing_arrangements
  drop constraint if exists club_membership_billing_arrangements_provider_authority_state_check;
alter table public.club_membership_billing_arrangements
  add constraint club_membership_billing_arrangements_provider_authority_state_check
  check (provider_authority_state in ('unknown','pending','active','failed','cancelled','expired','replaced'));
alter table public.club_membership_billing_arrangements
  drop constraint if exists club_membership_billing_arrangements_collection_status_check;
alter table public.club_membership_billing_arrangements
  add constraint club_membership_billing_arrangements_collection_status_check
  check (collection_status in ('ready','pending','action_required','blocked'));

alter table public.club_membership_billing_obligations
  add column if not exists provider_payment_reference text,
  add column if not exists provider_status text,
  add column if not exists provider_charge_date date,
  add column if not exists provider_created_at timestamptz,
  add column if not exists last_provider_event_at timestamptz,
  add column if not exists provider_failure_code text,
  add column if not exists provider_retry_expected boolean not null default false,
  add column if not exists collection_claimed_at timestamptz,
  add column if not exists collection_claimed_by text,
  add column if not exists collection_attempted_at timestamptz,
  add column if not exists collection_settled_at timestamptz,
  add column if not exists coverage_start_at timestamptz,
  add column if not exists coverage_end_at timestamptz;

alter table public.club_membership_billing_provider_events
  add column if not exists provider_occurred_at timestamptz,
  add column if not exists provider_reference text;

create unique index if not exists club_billing_obligation_gc_payment_uq
  on public.club_membership_billing_obligations(provider_payment_reference)
  where provider_payment_reference is not null;
create unique index if not exists club_billing_arrangement_gc_mandate_uq
  on public.club_membership_billing_arrangements(provider_subscription_reference)
  where provider_type='gocardless' and provider_subscription_reference is not null;
create index if not exists club_billing_gc_claim_idx
  on public.club_membership_billing_arrangements(provider_type,state,provider_authority_state,next_due_at)
  where provider_type='gocardless';

-- The joining transaction already established the prepaid first-month boundary.
update public.club_membership_billing_arrangements a set
  provider_authority_state=case when j.recurring_authority_state='confirmed' then 'active' else 'unknown' end,
  collection_status=case when j.recurring_authority_state='confirmed' then 'ready' else 'blocked' end,
  coverage_paid_through_at=coalesce(a.coverage_paid_through_at,j.paid_through_at,a.next_due_at),
  initial_paid_through_at=coalesce(a.initial_paid_through_at,j.paid_through_at,a.next_due_at)
from public.club_membership_join_requests j
where a.membership_id=j.membership_id and a.provider_type='gocardless';

-- Ensure the first future period exists without creating a second membership or arrangement.
insert into public.club_membership_billing_obligations(
  organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,
  provider_customer_reference,provider_subscription_reference,amount_minor,currency,frequency,next_due_at,period_key,
  coverage_start_at,coverage_end_at
)
select a.organisation_id,a.id,a.membership_id,a.user_id,a.customer_id,a.provider_type,a.payment_method_family,
  a.provider_customer_reference,a.provider_subscription_reference,a.amount_minor,a.currency,a.frequency,a.next_due_at,
  to_char(a.next_due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),a.next_due_at,
  public.club_next_membership_billing_due(a.next_due_at,a.frequency)
from public.club_membership_billing_arrangements a
where a.provider_type='gocardless' and a.frequency='monthly' and a.state='active'
on conflict(arrangement_id,period_key) do nothing;

create or replace function public.club_claim_due_gocardless_collections(p_limit integer default 25,p_worker_id text default null,p_claim_ttl_seconds integer default 900)
returns setof public.club_membership_billing_obligations language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_membership_billing_obligations%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Billing worker access is not permitted' using errcode='42501'; end if;
  if p_limit<1 or p_limit>100 or nullif(btrim(p_worker_id),'') is null or p_claim_ttl_seconds<60 or p_claim_ttl_seconds>3600 then raise exception 'Invalid collection claim' using errcode='22023'; end if;
  for o in
    select ob.* from public.club_membership_billing_obligations ob
    join public.club_membership_billing_arrangements a on a.id=ob.arrangement_id and a.organisation_id=ob.organisation_id
    join public.club_memberships m on m.id=a.membership_id and m.organisation_id=a.organisation_id
    where a.provider_type='gocardless' and a.payment_method_family='direct_debit' and a.frequency='monthly'
      and a.state='active' and a.provider_authority_state='active' and a.collection_status in ('ready','pending')
      and nullif(a.provider_subscription_reference,'') is not null and m.status='active'
      and ob.next_due_at<=now() and ob.provider_payment_reference is null
      and ob.state in ('upcoming','due','payment_pending')
      and (ob.collection_claimed_at is null or ob.collection_claimed_at<now()-make_interval(secs=>p_claim_ttl_seconds))
    order by ob.next_due_at,ob.id for update of ob skip locked limit p_limit
  loop
    update public.club_membership_billing_obligations set state='payment_pending',collection_claimed_at=now(),collection_claimed_by=p_worker_id,collection_attempted_at=now(),updated_at=now() where id=o.id returning * into o;
    update public.club_membership_billing_arrangements set collection_status='pending',updated_at=now() where id=o.arrangement_id;
    return next o;
  end loop;
end; $$;

create or replace function public.club_store_gocardless_collection(p_obligation_id uuid,p_worker_id text,p_provider_payment_id text,p_provider_status text,p_charge_date date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_membership_billing_obligations%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Billing worker access is not permitted' using errcode='42501'; end if;
  if p_provider_payment_id!~'^PM' or p_provider_status not in ('pending_customer_approval','pending_submission','submitted','confirmed','paid_out') then raise exception 'Invalid GoCardless payment response' using errcode='22023'; end if;
  select * into o from public.club_membership_billing_obligations where id=p_obligation_id for update;
  if not found or o.provider_type<>'gocardless' or o.collection_claimed_by is distinct from p_worker_id then raise exception 'Collection claim is unavailable' using errcode='40001'; end if;
  if o.provider_payment_reference is not null and o.provider_payment_reference<>p_provider_payment_id then raise exception 'Collection already has another provider payment' using errcode='23505'; end if;
  update public.club_membership_billing_obligations set provider_payment_reference=p_provider_payment_id,provider_status=p_provider_status,
    provider_charge_date=p_charge_date,provider_created_at=coalesce(provider_created_at,now()),state='payment_pending',
    collection_claimed_at=null,collection_claimed_by=null,updated_at=now() where id=o.id returning * into o;
  return to_jsonb(o);
end; $$;

create or replace function public.club_fail_gocardless_collection_attempt(p_obligation_id uuid,p_worker_id text,p_failure_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_membership_billing_obligations%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Billing worker access is not permitted' using errcode='42501'; end if;
  update public.club_membership_billing_obligations set state='failed',failure_reason=left(coalesce(nullif(btrim(p_failure_reason),''),'Provider rejected collection'),300),
    provider_retry_expected=false,collection_claimed_at=null,collection_claimed_by=null,updated_at=now()
    where id=p_obligation_id and collection_claimed_by=p_worker_id and provider_payment_reference is null returning * into o;
  if found then update public.club_membership_billing_arrangements set collection_status='action_required',action_required_reason='collection_creation_failed',updated_at=now() where id=o.arrangement_id; end if;
  return case when o.id is null then null else to_jsonb(o) end;
end; $$;

create or replace function public.club_reconcile_gocardless_collection_event(p_provider_event_key text,p_provider_payment_id text,p_provider_status text,p_occurred_at timestamptz,p_failure_reason text default null,p_retry_expected boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_membership_billing_obligations%rowtype; a public.club_membership_billing_arrangements%rowtype; e public.club_membership_billing_provider_events%rowtype; next_due timestamptz; next_period text; restored_paid_through timestamptz; was_settled boolean;
begin
  if auth.role()<>'service_role' then raise exception 'Provider event access is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_provider_event_key),'') is null or p_provider_payment_id!~'^PM' or p_provider_status not in ('created','submitted','confirmed','paid_out','failed','cancelled','charged_back','retry_scheduled') or p_occurred_at is null then raise exception 'Invalid GoCardless payment event' using errcode='22023'; end if;
  select * into o from public.club_membership_billing_obligations where provider_payment_reference=p_provider_payment_id for update;
  if not found then raise exception 'GoCardless payment has not been linked yet' using errcode='P0002'; end if;
  insert into public.club_membership_billing_provider_events(organisation_id,provider_type,provider_event_key,event_type,obligation_id,payload,provider_occurred_at,provider_reference)
    values(o.organisation_id,'gocardless',p_provider_event_key,'payment_'||p_provider_status,o.id,jsonb_build_object('status',p_provider_status,'retry_expected',coalesce(p_retry_expected,false),'failure_reason',p_failure_reason),p_occurred_at,p_provider_payment_id)
    on conflict(organisation_id,provider_type,provider_event_key) do nothing returning * into e;
  if not found then return jsonb_build_object('duplicate',true,'obligation_id',o.id); end if;
  if o.last_provider_event_at is not null and p_occurred_at<o.last_provider_event_at then return jsonb_build_object('stale',true,'obligation_id',o.id); end if;
  was_settled:=o.collection_settled_at is not null;
  if p_provider_status in ('created','submitted') then
    update public.club_membership_billing_obligations set provider_status=p_provider_status,state='payment_pending',last_provider_event_at=p_occurred_at,updated_at=now() where id=o.id;
  elsif p_provider_status in ('confirmed','paid_out') then
    update public.club_membership_billing_obligations set provider_status=p_provider_status,state=case when state in ('failed','grace','retry_scheduled','overdue') then 'recovered' else 'paid' end,
      last_provider_event_at=p_occurred_at,last_paid_at=coalesce(last_paid_at,p_occurred_at),last_payment_reference=p_provider_payment_id,
      collection_settled_at=coalesce(collection_settled_at,p_occurred_at),failure_reason=null,provider_failure_code=null,provider_retry_expected=false,grace_started_at=null,updated_at=now() where id=o.id;
    if not was_settled then
      insert into public.club_membership_billing_payments(organisation_id,obligation_id,amount_minor,currency,provider_reference,provider_event_key,occurred_at)
        values(o.organisation_id,o.id,o.amount_minor,o.currency,p_provider_payment_id,p_provider_event_key,p_occurred_at) on conflict do nothing;
      select * into a from public.club_membership_billing_arrangements where id=o.arrangement_id for update;
      next_due:=coalesce(o.coverage_end_at,public.club_next_membership_billing_due(o.next_due_at,o.frequency));
      next_period:=to_char(next_due at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
      insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,provider_customer_reference,provider_subscription_reference,amount_minor,currency,frequency,next_due_at,period_key,coverage_start_at,coverage_end_at)
        values(a.organisation_id,a.id,a.membership_id,a.user_id,a.customer_id,a.provider_type,a.payment_method_family,a.provider_customer_reference,a.provider_subscription_reference,a.amount_minor,a.currency,a.frequency,next_due,next_period,next_due,public.club_next_membership_billing_due(next_due,a.frequency)) on conflict(arrangement_id,period_key) do nothing;
      update public.club_membership_billing_arrangements set next_due_at=greatest(next_due_at,next_due),coverage_paid_through_at=greatest(coalesce(coverage_paid_through_at,next_due),next_due),last_successful_payment_at=p_occurred_at,
        collection_status=case when provider_authority_state='active' then 'ready' else 'blocked' end,
        action_required_reason=case when provider_authority_state='active' then null else action_required_reason end,updated_at=now() where id=a.id;
      update public.club_membership_join_requests set paid_through_at=greatest(coalesce(paid_through_at,next_due),next_due),updated_at=now() where membership_id=a.membership_id;
      update public.club_membership_payment_access_suspensions set active=false,cleared_at=now() where obligation_id=o.id and active;
    end if;
  elsif p_provider_status='retry_scheduled' then
    update public.club_membership_billing_obligations set provider_status=p_provider_status,state='retry_scheduled',last_provider_event_at=p_occurred_at,provider_retry_expected=true,failure_reason=p_failure_reason,updated_at=now() where id=o.id;
    update public.club_membership_billing_arrangements set collection_status='pending',action_required_reason=null,updated_at=now() where id=o.arrangement_id;
  else
    update public.club_membership_billing_obligations set provider_status=p_provider_status,state='grace',last_provider_event_at=p_occurred_at,provider_failure_code=p_provider_status,
      provider_retry_expected=coalesce(p_retry_expected,false),failure_reason=coalesce(nullif(btrim(p_failure_reason),''),'Direct Debit collection '||replace(p_provider_status,'_',' ')),grace_started_at=coalesce(grace_started_at,p_occurred_at),updated_at=now() where id=o.id;
    update public.club_membership_billing_arrangements set collection_status=case when p_retry_expected then 'pending' else 'action_required' end,action_required_reason=case when p_retry_expected then null else 'collection_'||p_provider_status end,updated_at=now() where id=o.arrangement_id;
    if was_settled then
      select * into a from public.club_membership_billing_arrangements where id=o.arrangement_id for update;
      select coalesce(max(x.coverage_end_at),a.initial_paid_through_at) into restored_paid_through
        from public.club_membership_billing_obligations x
        where x.arrangement_id=a.id and x.id<>o.id and x.collection_settled_at is not null and x.provider_status in ('confirmed','paid_out');
      update public.club_membership_billing_arrangements set coverage_paid_through_at=restored_paid_through,updated_at=now() where id=a.id;
      update public.club_membership_join_requests set paid_through_at=restored_paid_through,updated_at=now() where membership_id=a.membership_id;
    end if;
  end if;
  return jsonb_build_object('duplicate',false,'obligation_id',o.id,'status',p_provider_status,'advanced',p_provider_status in ('confirmed','paid_out') and not was_settled);
end; $$;

create or replace function public.club_reconcile_gocardless_mandate_event(p_provider_event_key text,p_mandate_id text,p_provider_status text,p_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_membership_billing_arrangements%rowtype; e public.club_membership_billing_provider_events%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Provider event access is not permitted' using errcode='42501'; end if;
  if p_mandate_id!~'^MD' or p_provider_status not in ('active','failed','cancelled','expired','replaced') or p_occurred_at is null then raise exception 'Invalid GoCardless mandate event' using errcode='22023'; end if;
  select * into a from public.club_membership_billing_arrangements where provider_type='gocardless' and provider_subscription_reference=p_mandate_id for update;
  if not found then return jsonb_build_object('matched',false); end if;
  insert into public.club_membership_billing_provider_events(organisation_id,provider_type,provider_event_key,event_type,payload,provider_occurred_at,provider_reference)
    values(a.organisation_id,'gocardless',p_provider_event_key,'mandate_'||p_provider_status,jsonb_build_object('status',p_provider_status),p_occurred_at,p_mandate_id)
    on conflict(organisation_id,provider_type,provider_event_key) do nothing returning * into e;
  if not found then return jsonb_build_object('matched',true,'duplicate',true); end if;
  if a.mandate_event_occurred_at is not null and p_occurred_at<a.mandate_event_occurred_at then return jsonb_build_object('matched',true,'stale',true); end if;
  update public.club_membership_billing_arrangements set provider_authority_state=p_provider_status,mandate_event_occurred_at=p_occurred_at,
    collection_status=case when p_provider_status='active' then 'ready' else 'blocked' end,
    action_required_reason=case when p_provider_status='active' then null else 'mandate_'||p_provider_status end,updated_at=now() where id=a.id;
  if p_provider_status='active' then
    update public.club_membership_billing_obligations set state='upcoming',failure_reason=null,cancelled_at=null,updated_at=now()
      where arrangement_id=a.id and provider_payment_reference is null and state='cancelled';
  end if;
  if p_provider_status<>'active' then
    update public.club_membership_billing_obligations set state='cancelled',failure_reason='Direct Debit mandate '||replace(p_provider_status,'_',' '),cancelled_at=now(),updated_at=now()
      where arrangement_id=a.id and provider_payment_reference is null and state in ('upcoming','due','payment_pending');
  end if;
  return jsonb_build_object('matched',true,'duplicate',false,'arrangement_id',a.id,'status',p_provider_status);
end; $$;

-- The same hosted mandate flow can repair an active membership without reusing
-- the commercial joining record or changing its membership/staff/Coach roles.
create or replace function public.club_prepare_recurring_mandate_attempt(p_request_id uuid,p_replace_reference text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; c public.club_customers%rowtype; p public.club_products%rowtype; o public.club_organisations%rowtype; a public.club_membership_billing_arrangements%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into r from public.club_membership_join_requests where id=p_request_id and user_id=auth.uid() for update;
  if not found or r.checkout_kind<>'monthly_recurring' or r.upfront_payment_state<>'confirmed' then raise exception 'Direct Debit setup is not available' using errcode='42501'; end if;
  if r.membership_id is null then return public.club_prepare_join_provider_attempt(p_request_id,'gocardless',p_replace_reference); end if;
  select * into a from public.club_membership_billing_arrangements where membership_id=r.membership_id and organisation_id=r.organisation_id for update;
  if not found or a.provider_type<>'gocardless' or a.provider_authority_state not in ('failed','cancelled','expired','replaced','unknown','pending') then raise exception 'A replacement Direct Debit is not required' using errcode='22023'; end if;
  if a.provider_authority_state='pending' and r.gocardless_redirect_flow_id is null then raise exception 'A replacement Direct Debit is already pending' using errcode='40001'; end if;
  if p_replace_reference is not null and r.gocardless_redirect_flow_id is distinct from p_replace_reference then raise exception 'Direct Debit setup changed; resume the current attempt' using errcode='40001'; end if;
  select * into p from public.club_products where id=r.product_id and organisation_id=r.organisation_id and archived_at is null;
  select * into c from public.club_customers where id=r.customer_id and organisation_id=r.organisation_id;
  select * into o from public.club_organisations where id=r.organisation_id and active;
  if p.id is null or c.id is null or o.id is null then raise exception 'Membership is no longer available' using errcode='22023'; end if;
  if p_replace_reference is not null or (a.provider_authority_state<>'pending' and r.gocardless_redirect_flow_id is not null) then
    update public.club_membership_join_requests set gocardless_redirect_flow_id=null,gocardless_customer_id=null,gocardless_bank_account_id=null,gocardless_mandate_id=null,gocardless_flow_generation=gocardless_flow_generation+1 where id=r.id;
  elsif r.gocardless_flow_generation=0 then update public.club_membership_join_requests set gocardless_flow_generation=1 where id=r.id; end if;
  update public.club_membership_join_requests set recurring_authority_state='pending',payment_failure_reason=null,last_activity_at=now(),updated_at=now() where id=r.id returning * into r;
  update public.club_membership_billing_arrangements set provider_authority_state='pending',collection_status='blocked',action_required_reason='replacement_mandate_pending',updated_at=now() where id=a.id;
  return jsonb_build_object('id',r.id,'organisation_id',r.organisation_id,'organisation_slug',o.slug,'user_id',r.user_id,'customer_id',r.customer_id,'product_id',r.product_id,'product_name',p.name,'currency',p.currency,'checkout_kind',r.checkout_kind,'upfront_amount_minor',r.upfront_amount_minor,'upfront_payment_state',r.upfront_payment_state,'recurring_authority_state',r.recurring_authority_state,'email',c.email,'display_name',c.display_name,'gocardless_redirect_flow_id',r.gocardless_redirect_flow_id,'gocardless_mandate_id',r.gocardless_mandate_id,'gocardless_flow_generation',r.gocardless_flow_generation);
end; $$;

create or replace function public.club_bind_replacement_gocardless_mandate(p_request_id uuid,p_mandate_id text,p_customer_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; a public.club_membership_billing_arrangements%rowtype;
begin
  if auth.role()<>'service_role' or p_mandate_id!~'^MD' then raise exception 'Replacement mandate update is not permitted' using errcode='42501'; end if;
  select * into r from public.club_membership_join_requests where id=p_request_id and membership_id is not null for share;
  if not found or r.gocardless_mandate_id is distinct from p_mandate_id then return jsonb_build_object('matched',false); end if;
  update public.club_membership_billing_arrangements set provider_subscription_reference=p_mandate_id,provider_customer_reference=coalesce(nullif(btrim(p_customer_id),''),provider_customer_reference),provider_authority_state='pending',collection_status='blocked',action_required_reason='mandate_confirmation_pending',updated_at=now()
    where membership_id=r.membership_id and organisation_id=r.organisation_id and provider_type='gocardless' returning * into a;
  update public.club_membership_billing_obligations set provider_subscription_reference=p_mandate_id,
    provider_customer_reference=coalesce(nullif(btrim(p_customer_id),''),provider_customer_reference),updated_at=now()
    where arrangement_id=a.id and provider_payment_reference is null and state in ('upcoming','due','payment_pending','cancelled');
  return jsonb_build_object('matched',a.id is not null,'arrangement_id',a.id);
end; $$;

create or replace function public.club_get_member_billing(p_organisation_id uuid,p_user_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'membership_id',o.membership_id,'arrangement_id',o.arrangement_id,'amount_minor',o.amount_minor,'currency',o.currency,'next_due_at',o.next_due_at,'arrangement_next_due_at',a.next_due_at,'frequency',a.frequency,'state',o.state,'payment_method_family',a.payment_method_family,'grace_started_at',o.grace_started_at,'failure_reason',o.failure_reason,'provider_status',o.provider_status,'provider_charge_date',o.provider_charge_date,'mandate_status',a.provider_authority_state,'collection_status',a.collection_status,'action_required_reason',a.action_required_reason,'paid_through_at',a.coverage_paid_through_at) order by o.next_due_at),'[]'::jsonb)
from public.club_membership_billing_obligations o join public.club_membership_billing_arrangements a on a.id=o.arrangement_id and a.organisation_id=o.organisation_id where o.organisation_id=p_organisation_id and o.user_id=p_user_id and auth.uid()=p_user_id;
$$;

create or replace function public.club_list_customer_billing(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'membership_id',o.membership_id,'amount_minor',o.amount_minor,'currency',o.currency,'next_due_at',o.next_due_at,'state',o.state,'payment_method_family',o.payment_method_family,'failure_reason',o.failure_reason,'provider_status',o.provider_status,'provider_charge_date',o.provider_charge_date,'provider_payment_reference',o.provider_payment_reference,'mandate_status',a.provider_authority_state,'collection_status',a.collection_status,'action_required_reason',a.action_required_reason,'paid_through_at',a.coverage_paid_through_at) order by o.next_due_at),'[]'::jsonb)
from public.club_membership_billing_obligations o join public.club_membership_billing_arrangements a on a.id=o.arrangement_id and a.organisation_id=o.organisation_id where o.organisation_id=p_organisation_id and (o.customer_id=p_customer_id or exists(select 1 from public.club_customers c where c.id=p_customer_id and c.organisation_id=o.organisation_id and c.user_id=o.user_id)) and public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take');
$$;

revoke all on function public.club_claim_due_gocardless_collections(integer,text,integer),public.club_store_gocardless_collection(uuid,text,text,text,date),public.club_fail_gocardless_collection_attempt(uuid,text,text),public.club_reconcile_gocardless_collection_event(text,text,text,timestamptz,text,boolean),public.club_reconcile_gocardless_mandate_event(text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.club_prepare_recurring_mandate_attempt(uuid,text) from public,anon;
revoke all on function public.club_bind_replacement_gocardless_mandate(uuid,text,text) from public,anon,authenticated;
grant execute on function public.club_claim_due_gocardless_collections(integer,text,integer),public.club_store_gocardless_collection(uuid,text,text,text,date),public.club_fail_gocardless_collection_attempt(uuid,text,text),public.club_reconcile_gocardless_collection_event(text,text,text,timestamptz,text,boolean),public.club_reconcile_gocardless_mandate_event(text,text,text,timestamptz),public.club_bind_replacement_gocardless_mandate(uuid,text,text) to service_role;
grant execute on function public.club_prepare_recurring_mandate_attempt(uuid,text) to authenticated;
revoke all on function public.club_get_member_billing(uuid,uuid),public.club_list_customer_billing(uuid,uuid) from public,anon;
grant execute on function public.club_get_member_billing(uuid,uuid),public.club_list_customer_billing(uuid,uuid) to authenticated;

comment on function public.club_claim_due_gocardless_collections(integer,text,integer) is 'Claims due trusted obligations in small retry-safe batches. Provider creation uses the obligation id as its stable idempotency key.';
