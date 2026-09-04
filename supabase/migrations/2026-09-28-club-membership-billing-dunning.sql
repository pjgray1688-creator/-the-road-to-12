-- Provider-neutral recurring membership billing and recovery lifecycle.
-- No provider credentials or historical payments are fabricated by this migration.

create table if not exists public.club_membership_billing_policies (
  organisation_id uuid primary key references public.club_organisations(id) on delete cascade,
  grace_period_days integer check (grace_period_days is null or grace_period_days >= 0),
  suspend_after_days integer check (suspend_after_days is null or suspend_after_days >= 0),
  max_retries integer not null default 0 check (max_retries >= 0),
  retry_intervals_days integer[] not null default '{}',
  late_fee_enabled boolean not null default false,
  late_fee_amount_minor integer check (late_fee_amount_minor is null or late_fee_amount_minor > 0),
  access_suspension_enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.club_membership_billing_arrangements (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  membership_id uuid not null, user_id uuid not null references auth.users(id) on delete restrict, customer_id uuid,
  provider_type text, payment_method_family text not null default 'other' check (payment_method_family in ('direct_debit','recurring_card','other')),
  provider_customer_reference text, provider_subscription_reference text, amount_minor integer not null check (amount_minor > 0), currency text not null check (currency ~ '^[A-Z]{3}$'),
  frequency text not null default 'monthly' check (frequency in ('weekly','monthly','quarterly','annual','other')), next_due_at timestamptz not null,
  state text not null default 'active' check (state in ('active','cancelled')), last_successful_payment_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, organisation_id), unique (organisation_id, membership_id),
  foreign key (membership_id, organisation_id) references public.club_memberships(id, organisation_id) on delete restrict,
  foreign key (customer_id, organisation_id) references public.club_customers(id, organisation_id) on delete set null
);

create table if not exists public.club_membership_billing_obligations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  arrangement_id uuid,
  membership_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  customer_id uuid,
  provider_type text,
  payment_method_family text not null default 'other' check (payment_method_family in ('direct_debit','recurring_card','other')),
  provider_customer_reference text,
  provider_subscription_reference text,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  frequency text not null default 'monthly' check (frequency in ('weekly','monthly','quarterly','annual','other')),
  next_due_at timestamptz not null,
  period_key text not null,
  state text not null default 'upcoming' check (state in ('upcoming','due','payment_pending','paid','failed','grace','retry_scheduled','recovered','overdue','waived','cancelled')),
  last_paid_at timestamptz,
  last_payment_reference text,
  failure_reason text,
  grace_started_at timestamptz,
  recovery_exhausted_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (arrangement_id, period_key),
  unique (id, organisation_id),
  foreign key (membership_id, organisation_id) references public.club_memberships(id, organisation_id) on delete restrict,
  foreign key (customer_id, organisation_id) references public.club_customers(id, organisation_id) on delete set null,
  foreign key (arrangement_id, organisation_id) references public.club_membership_billing_arrangements(id, organisation_id) on delete restrict
);

create table if not exists public.club_membership_billing_payments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  obligation_id uuid not null,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  provider_reference text,
  provider_event_key text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organisation_id, provider_event_key),
  unique (obligation_id, provider_reference),
  foreign key (obligation_id, organisation_id) references public.club_membership_billing_obligations(id, organisation_id) on delete restrict
);

create table if not exists public.club_membership_billing_retries (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  obligation_id uuid not null, retry_number integer not null check (retry_number > 0), strategy text not null check (strategy in ('provider_managed','r12_requested')),
  scheduled_at timestamptz, requested_at timestamptz, attempted_at timestamptz, result text check (result is null or result in ('pending','succeeded','failed','unavailable','cancelled')),
  provider_reference text, failure_reason text, created_at timestamptz not null default now(),
  unique (obligation_id, retry_number, strategy), foreign key (obligation_id, organisation_id) references public.club_membership_billing_obligations(id, organisation_id) on delete restrict
);

create table if not exists public.club_membership_billing_late_fees (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  obligation_id uuid not null, amount_minor integer not null check (amount_minor > 0), currency text not null check (currency ~ '^[A-Z]{3}$'),
  state text not null default 'outstanding' check (state in ('outstanding','waived','settled')), waived_by uuid references auth.users(id) on delete set null, waived_at timestamptz, reason text, created_at timestamptz not null default now(),
  unique (obligation_id), foreign key (obligation_id, organisation_id) references public.club_membership_billing_obligations(id, organisation_id) on delete restrict
);

create table if not exists public.club_membership_billing_notifications (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  obligation_id uuid not null, user_id uuid not null references auth.users(id) on delete restrict, notification_type text not null,
  channel text, state text not null default 'unavailable' check (state in ('pending','unavailable','sent','failed')),
  provider_reference text, idempotency_key text not null, created_at timestamptz not null default now(), sent_at timestamptz,
  unique (organisation_id, idempotency_key), foreign key (obligation_id, organisation_id) references public.club_membership_billing_obligations(id, organisation_id) on delete restrict
);

create table if not exists public.club_membership_billing_provider_events (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  provider_type text not null, provider_event_key text not null, event_type text not null, obligation_id uuid, payload jsonb not null default '{}', received_at timestamptz not null default now(),
  unique (organisation_id, provider_type, provider_event_key), foreign key (obligation_id, organisation_id) references public.club_membership_billing_obligations(id, organisation_id) on delete set null
);

create table if not exists public.club_membership_payment_access_suspensions (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  membership_id uuid not null, user_id uuid not null references auth.users(id) on delete restrict, obligation_id uuid not null,
  reason text not null default 'payment_overdue', active boolean not null default true, created_at timestamptz not null default now(), cleared_at timestamptz,
  unique (obligation_id), foreign key (membership_id, organisation_id) references public.club_memberships(id, organisation_id) on delete restrict,
  foreign key (obligation_id, organisation_id) references public.club_membership_billing_obligations(id, organisation_id) on delete restrict
);

create index if not exists club_billing_obligations_due_idx on public.club_membership_billing_obligations(organisation_id,state,next_due_at);
create index if not exists club_billing_notifications_obligation_idx on public.club_membership_billing_notifications(organisation_id,obligation_id,created_at desc);
alter table public.club_membership_billing_policies enable row level security;
alter table public.club_membership_billing_arrangements enable row level security;
alter table public.club_membership_billing_obligations enable row level security;
alter table public.club_membership_billing_payments enable row level security;
alter table public.club_membership_billing_retries enable row level security;
alter table public.club_membership_billing_late_fees enable row level security;
alter table public.club_membership_billing_notifications enable row level security;
alter table public.club_membership_billing_provider_events enable row level security;
alter table public.club_membership_payment_access_suspensions enable row level security;
revoke all on table public.club_membership_billing_policies,public.club_membership_billing_arrangements,public.club_membership_billing_obligations,public.club_membership_billing_payments,public.club_membership_billing_retries,public.club_membership_billing_late_fees,public.club_membership_billing_notifications,public.club_membership_billing_provider_events,public.club_membership_payment_access_suspensions from public,anon,authenticated;

create or replace function public.club_next_membership_billing_due(p_due_at timestamptz,p_frequency text)
returns timestamptz language plpgsql immutable as $$
declare months integer; target date; day integer; last_day integer;
begin
  if p_frequency='weekly' then return p_due_at + interval '7 days'; end if;
  if p_frequency='annual' then return p_due_at + interval '1 year'; end if;
  if p_frequency not in ('monthly','quarterly') then return null; end if;
  months:=case when p_frequency='monthly' then 1 else 3 end;
  day:=extract(day from p_due_at)::integer;
  target:=(date_trunc('month',p_due_at)::date + (months||' months')::interval)::date;
  last_day:=extract(day from (date_trunc('month',target::timestamp)+interval '1 month - 1 day'))::integer;
  return target + (least(day,last_day)-1) * interval '1 day' + (p_due_at-date_trunc('day',p_due_at));
end;
$$;

create or replace function public.club_enrol_membership_billing(p_organisation_id uuid,p_membership_id uuid,p_user_id uuid,p_customer_id uuid,p_provider_type text,p_payment_method_family text,p_amount_minor integer,p_currency text,p_frequency text,p_next_due_at timestamptz,p_provider_customer_reference text,p_provider_subscription_reference text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.club_memberships%rowtype; a public.club_membership_billing_arrangements%rowtype; o public.club_membership_billing_obligations%rowtype; period text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then raise exception 'Billing administration is not permitted' using errcode='42501'; end if;
  select * into m from public.club_memberships where id=p_membership_id and organisation_id=p_organisation_id for share;
  if not found or not exists(select 1 from public.club_membership_holders where membership_id=m.id and user_id=p_user_id) then raise exception 'Membership billing identity is invalid' using errcode='22023'; end if;
  if p_amount_minor<=0 or p_currency !~ '^[A-Z]{3}$' or p_payment_method_family not in ('direct_debit','recurring_card','other') or p_frequency not in ('weekly','monthly','quarterly','annual','other') or p_next_due_at is null then raise exception 'Invalid billing obligation' using errcode='22023'; end if;
  insert into public.club_membership_billing_arrangements(organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,amount_minor,currency,frequency,next_due_at,provider_customer_reference,provider_subscription_reference)
  values(p_organisation_id,p_membership_id,p_user_id,p_customer_id,p_provider_type,p_payment_method_family,p_amount_minor,p_currency,p_frequency,p_next_due_at,p_provider_customer_reference,p_provider_subscription_reference)
  on conflict (organisation_id,membership_id) do update set user_id=excluded.user_id,customer_id=excluded.customer_id,provider_type=excluded.provider_type,payment_method_family=excluded.payment_method_family,amount_minor=excluded.amount_minor,currency=excluded.currency,frequency=excluded.frequency,next_due_at=excluded.next_due_at,provider_customer_reference=excluded.provider_customer_reference,provider_subscription_reference=excluded.provider_subscription_reference,state='active',updated_at=now()
  returning * into a;
  period:=to_char(p_next_due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,amount_minor,currency,frequency,next_due_at,period_key)
  values(p_organisation_id,a.id,p_membership_id,p_user_id,p_customer_id,p_provider_type,p_payment_method_family,p_amount_minor,p_currency,p_frequency,p_next_due_at,period)
  on conflict (arrangement_id,period_key) do nothing returning * into o;
  if o.id is null then select * into o from public.club_membership_billing_obligations where arrangement_id=a.id and period_key=period; end if;
  return jsonb_build_object('arrangement',to_jsonb(a),'obligation',to_jsonb(o));
end; $$;

create or replace function public.club_ingest_membership_payment_event(p_organisation_id uuid,p_provider_type text,p_provider_event_key text,p_event_type text,p_obligation_id uuid,p_amount_minor integer,p_currency text,p_provider_reference text,p_failure_reason text,p_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_membership_billing_obligations%rowtype; a public.club_membership_billing_arrangements%rowtype; e public.club_membership_billing_provider_events%rowtype; paid public.club_membership_billing_payments%rowtype; next_due timestamptz; next_period text;
begin
  if p_provider_event_key is null or p_event_type not in ('payment_submitted','payment_confirmed','payment_failed','retry_scheduled','payment_cancelled','mandate_cancelled') then raise exception 'Invalid provider event' using errcode='22023'; end if;
  select * into e from public.club_membership_billing_provider_events where organisation_id=p_organisation_id and provider_type=p_provider_type and provider_event_key=p_provider_event_key;
  if found then return to_jsonb(e); end if;
  select * into o from public.club_membership_billing_obligations where id=p_obligation_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Billing obligation not found' using errcode='P0002'; end if;
  insert into public.club_membership_billing_provider_events(organisation_id,provider_type,provider_event_key,event_type,obligation_id,payload) values(p_organisation_id,p_provider_type,p_provider_event_key,p_event_type,p_obligation_id,jsonb_build_object('amount_minor',p_amount_minor,'currency',p_currency,'provider_reference',p_provider_reference)) returning * into e;
  if p_event_type='payment_confirmed' then
    if p_amount_minor<>o.amount_minor or p_currency<>o.currency then raise exception 'Payment amount does not match obligation' using errcode='22023'; end if;
    insert into public.club_membership_billing_payments(organisation_id,obligation_id,amount_minor,currency,provider_reference,provider_event_key,occurred_at) values(p_organisation_id,o.id,p_amount_minor,p_currency,p_provider_reference,p_provider_event_key,coalesce(p_occurred_at,now())) on conflict (organisation_id,provider_event_key) do nothing returning * into paid;
    update public.club_membership_billing_obligations set state=case when state in ('failed','grace','retry_scheduled','overdue') then 'recovered' else 'paid' end,last_paid_at=coalesce(p_occurred_at,now()),last_payment_reference=p_provider_reference,failure_reason=null,grace_started_at=null,recovery_exhausted_at=null,updated_at=now() where id=o.id;
    select * into a from public.club_membership_billing_arrangements where id=o.arrangement_id and organisation_id=o.organisation_id for update;
    next_due:=public.club_next_membership_billing_due(a.next_due_at,a.frequency);
    if next_due is not null and a.next_due_at<=o.next_due_at then
      next_period:=to_char(next_due at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
      insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,provider_customer_reference,provider_subscription_reference,amount_minor,currency,frequency,next_due_at,period_key)
      values(a.organisation_id,a.id,a.membership_id,a.user_id,a.customer_id,a.provider_type,a.payment_method_family,a.provider_customer_reference,a.provider_subscription_reference,a.amount_minor,a.currency,a.frequency,next_due,next_period) on conflict (arrangement_id,period_key) do nothing;
      update public.club_membership_billing_arrangements set next_due_at=next_due,last_successful_payment_at=coalesce(p_occurred_at,now()),updated_at=now() where id=a.id;
    end if;
    update public.club_membership_payment_access_suspensions set active=false,cleared_at=now() where obligation_id=o.id and active;
  elsif p_event_type='payment_failed' then update public.club_membership_billing_obligations set state='grace',failure_reason=p_failure_reason,grace_started_at=coalesce(grace_started_at,coalesce(p_occurred_at,now())),updated_at=now() where id=o.id;
  elsif p_event_type='retry_scheduled' then update public.club_membership_billing_obligations set state='retry_scheduled',updated_at=now() where id=o.id;
  elsif p_event_type in ('payment_cancelled','mandate_cancelled') then update public.club_membership_billing_obligations set state='overdue',failure_reason=coalesce(p_failure_reason,'Payment method cancelled'),updated_at=now() where id=o.id;
  end if;
  return jsonb_build_object('event',to_jsonb(e),'obligation',(select to_jsonb(x) from public.club_membership_billing_obligations x where x.id=o.id),'payment',case when paid.id is null then null else to_jsonb(paid) end);
end; $$;

create or replace function public.club_evaluate_membership_billing(p_organisation_id uuid,p_as_of timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.club_membership_billing_policies%rowtype; o public.club_membership_billing_obligations%rowtype; changed integer:=0; overdue_days integer; stage text; key text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then raise exception 'Billing evaluation is not permitted' using errcode='42501'; end if;
  select * into p from public.club_membership_billing_policies where organisation_id=p_organisation_id;
  for o in select * from public.club_membership_billing_obligations where organisation_id=p_organisation_id and state not in ('paid','recovered','cancelled','waived') for update loop
    if o.next_due_at<=p_as_of and o.state='upcoming' then update public.club_membership_billing_obligations set state='due',updated_at=now() where id=o.id; changed:=changed+1; end if;
    if o.next_due_at<=p_as_of and o.state in ('due','payment_pending','failed') then update public.club_membership_billing_obligations set state='grace',grace_started_at=coalesce(grace_started_at,o.next_due_at),updated_at=now() where id=o.id; end if;
    overdue_days:=greatest(0,floor(extract(epoch from (p_as_of-coalesce(o.grace_started_at,o.next_due_at)))/86400)::integer);
    if coalesce(p.late_fee_enabled,false) and coalesce(p.late_fee_amount_minor,0)>0 and overdue_days>0 then insert into public.club_membership_billing_late_fees(organisation_id,obligation_id,amount_minor,currency) values(p_organisation_id,o.id,p.late_fee_amount_minor,o.currency) on conflict (obligation_id) do nothing; end if;
    if coalesce(p.suspend_after_days,2147483647)<=overdue_days and coalesce(p.access_suspension_enabled,false) then
      update public.club_membership_billing_obligations set state='overdue',recovery_exhausted_at=coalesce(recovery_exhausted_at,p_as_of),updated_at=now() where id=o.id;
      insert into public.club_membership_payment_access_suspensions(organisation_id,membership_id,user_id,obligation_id) values(p_organisation_id,o.membership_id,o.user_id,o.id) on conflict (obligation_id) do update set active=true,cleared_at=null;
    end if;
    stage:=case when overdue_days=0 then 'payment_failed' when overdue_days=coalesce(p.grace_period_days,0) then 'grace_reminder' when coalesce(p.suspend_after_days,2147483647)<=overdue_days then 'access_suspended' else 'payment_failed' end;
    key:='billing:'||o.id::text||':'||stage;
    insert into public.club_membership_billing_notifications(organisation_id,obligation_id,user_id,notification_type,idempotency_key) values(p_organisation_id,o.id,o.user_id,stage,key) on conflict (organisation_id,idempotency_key) do nothing;
  end loop;
  return jsonb_build_object('organisation_id',p_organisation_id,'evaluated_at',p_as_of,'changed',changed);
end; $$;

create or replace function public.club_list_membership_billing_attention(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then raise exception 'Billing access is not permitted' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'membership_id',o.membership_id,'user_id',o.user_id,'amount_minor',o.amount_minor,'currency',o.currency,'next_due_at',o.next_due_at,'state',o.state,'failure_reason',o.failure_reason,'payment_method_family',o.payment_method_family,'grace_started_at',o.grace_started_at,'recovery_exhausted_at',o.recovery_exhausted_at) order by o.next_due_at), '[]'::jsonb) into result
  from public.club_membership_billing_obligations o where o.organisation_id=p_organisation_id and o.state in ('due','failed','grace','retry_scheduled','overdue');
  return result;
end; $$;

create or replace function public.club_get_member_billing(p_organisation_id uuid,p_user_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'membership_id',o.membership_id,'arrangement_id',o.arrangement_id,'amount_minor',o.amount_minor,'currency',o.currency,'next_due_at',o.next_due_at,'arrangement_next_due_at',a.next_due_at,'frequency',a.frequency,'state',o.state,'payment_method_family',a.payment_method_family,'grace_started_at',o.grace_started_at,'failure_reason',o.failure_reason) order by o.next_due_at),'[]'::jsonb)
from public.club_membership_billing_obligations o join public.club_membership_billing_arrangements a on a.id=o.arrangement_id and a.organisation_id=o.organisation_id where o.organisation_id=p_organisation_id and o.user_id=p_user_id and auth.uid()=p_user_id;
$$;

create or replace function public.club_save_membership_billing_policy(p_organisation_id uuid,p_grace_period_days integer,p_suspend_after_days integer,p_max_retries integer,p_retry_intervals_days integer[],p_late_fee_enabled boolean,p_late_fee_amount_minor integer,p_access_suspension_enabled boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.club_membership_billing_policies%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then raise exception 'Billing policy administration is not permitted' using errcode='42501'; end if;
  if p_grace_period_days is not null and p_grace_period_days<0 or p_suspend_after_days is not null and p_suspend_after_days<0 or p_max_retries<0 or p_late_fee_amount_minor is not null and p_late_fee_amount_minor<=0 then raise exception 'Invalid billing policy' using errcode='22023'; end if;
  insert into public.club_membership_billing_policies(organisation_id,grace_period_days,suspend_after_days,max_retries,retry_intervals_days,late_fee_enabled,late_fee_amount_minor,access_suspension_enabled,updated_by,updated_at)
  values(p_organisation_id,p_grace_period_days,p_suspend_after_days,p_max_retries,coalesce(p_retry_intervals_days,'{}'),p_late_fee_enabled,p_late_fee_amount_minor,p_access_suspension_enabled,auth.uid(),now())
  on conflict (organisation_id) do update set grace_period_days=excluded.grace_period_days,suspend_after_days=excluded.suspend_after_days,max_retries=excluded.max_retries,retry_intervals_days=excluded.retry_intervals_days,late_fee_enabled=excluded.late_fee_enabled,late_fee_amount_minor=excluded.late_fee_amount_minor,access_suspension_enabled=excluded.access_suspension_enabled,updated_by=excluded.updated_by,updated_at=now()
  returning * into p;
  return to_jsonb(p);
end; $$;

create or replace function public.club_waive_membership_late_fee(p_organisation_id uuid,p_late_fee_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare f public.club_membership_billing_late_fees%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') or nullif(btrim(p_reason),'') is null then raise exception 'Late-fee waiver is not permitted' using errcode='42501'; end if;
  update public.club_membership_billing_late_fees set state='waived',waived_by=auth.uid(),waived_at=now(),reason=p_reason where id=p_late_fee_id and organisation_id=p_organisation_id and state='outstanding' returning * into f;
  if not found then raise exception 'Late fee is not available' using errcode='P0002'; end if;
  return to_jsonb(f);
end; $$;

revoke all on function public.club_enrol_membership_billing(uuid,uuid,uuid,uuid,text,text,integer,text,text,timestamptz,text,text),public.club_evaluate_membership_billing(uuid,timestamptz),public.club_list_membership_billing_attention(uuid),public.club_get_member_billing(uuid,uuid),public.club_save_membership_billing_policy(uuid,integer,integer,integer,integer[],boolean,integer,boolean),public.club_waive_membership_late_fee(uuid,uuid,text) from public,anon;
revoke all on function public.club_ingest_membership_payment_event(uuid,text,text,text,uuid,integer,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.club_enrol_membership_billing(uuid,uuid,uuid,uuid,text,text,integer,text,text,timestamptz,text,text),public.club_evaluate_membership_billing(uuid,timestamptz),public.club_list_membership_billing_attention(uuid),public.club_get_member_billing(uuid,uuid),public.club_save_membership_billing_policy(uuid,integer,integer,integer,integer[],boolean,integer,boolean),public.club_waive_membership_late_fee(uuid,uuid,text) to authenticated;
grant execute on function public.club_ingest_membership_payment_event(uuid,text,text,text,uuid,integer,text,text,text,timestamptz) to service_role;

-- Payment suspension is an additive access restriction: induction, location
-- scope and every existing access rule still run through the established base.
create or replace function public.club_check_member_location_access(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare base jsonb; induction jsonb;
begin
  if auth.uid() is null or (auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner'])) then raise exception 'Location eligibility is not permitted' using errcode='42501'; end if;
  if exists(select 1 from public.club_membership_payment_access_suspensions where organisation_id=p_organisation_id and user_id=p_user_id and active) then
    return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','payment_overdue');
  end if;
  base:=public.club_check_member_location_access_base(p_organisation_id,p_user_id,p_location_id,p_at);
  if base->>'allowed' <> 'true' then return base; end if;
  induction:=public.club_get_member_induction_state(p_organisation_id,p_user_id,p_location_id,p_at);
  if induction->'state'->>'access_effect'='hold' then return base||jsonb_build_object('allowed',false,'reason','induction_overdue','induction',induction->'state'); end if;
  return base||jsonb_build_object('induction',induction->'state');
end; $$;
revoke all on function public.club_check_member_location_access(uuid,uuid,uuid,timestamptz) from public,anon;
grant execute on function public.club_check_member_location_access(uuid,uuid,uuid,timestamptz) to authenticated;

comment on table public.club_membership_billing_obligations is 'Provider-neutral recurring obligations; existing imported members may start here without fabricated payment history.';
comment on table public.club_membership_billing_notifications is 'Internal communication intent. Unconfigured channels remain unavailable, never falsely sent.';
