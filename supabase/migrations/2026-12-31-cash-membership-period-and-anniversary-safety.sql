-- Record the contractual billing period separately from receipt and paid-through
-- dates. Never move a renewal anniversary based on when counter cash is entered.

-- The original inline check's generated identifier was truncated to the
-- singular `...arrangement...` form, while the cash migration's explicit
-- plural identifier was truncated differently. Both checks can therefore
-- coexist, leaving the old check to reject cash. Remove those exact legacy
-- names and retain one concise check with the established allowlist.
alter table public.club_membership_billing_arrangements
  drop constraint if exists club_membership_billing_arrangement_payment_method_family_check;
alter table public.club_membership_billing_arrangements
  drop constraint if exists club_membership_billing_arrangements_payment_method_family_chec;
alter table public.club_membership_billing_arrangements
  drop constraint if exists club_member_billing_arrangement_method_family_check;
alter table public.club_membership_billing_arrangements
  add constraint club_member_billing_arrangement_method_family_check
  check (payment_method_family in ('direct_debit','recurring_card','cash','other'));

alter table public.club_membership_billing_arrangements
  add column if not exists billing_anchor_day integer check (billing_anchor_day is null or billing_anchor_day between 1 and 31);

-- For older arrangements without an anchor, retain the currently stored due day
-- as the prospective anchor. This does not rewrite any existing due date.
update public.club_membership_billing_arrangements
set billing_anchor_day = extract(day from next_due_at at time zone 'UTC')::integer
where billing_anchor_day is null and frequency = 'monthly';

alter table public.club_membership_billing_payments
  add column if not exists billing_period_start date,
  add column if not exists billing_period_end date;
alter table public.club_membership_billing_payments
  drop constraint if exists club_membership_billing_payment_period_pair_check;
alter table public.club_membership_billing_payments
  add constraint club_membership_billing_payment_period_pair_check
  check ((billing_period_start is null and billing_period_end is null)
    or (billing_period_start is not null and billing_period_end is not null and billing_period_end >= billing_period_start));

create or replace function public.club_guard_recurring_membership_arrangement()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare product_billing text; product_duration_days integer;
begin
  select p.billing,p.duration_days into product_billing,product_duration_days
  from public.club_memberships m
  join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id
  where m.id=new.membership_id and m.organisation_id=new.organisation_id;
  if not found then raise exception 'Membership billing product is unavailable' using errcode='22023'; end if;
  if new.frequency='monthly' and (product_billing<>'recurring' or product_duration_days in (1,7)) then
    raise exception 'Fixed-duration and one-off memberships cannot create monthly billing obligations' using errcode='22023';
  end if;
  if product_billing='recurring' and new.frequency='monthly' and new.billing_anchor_day is null then
    new.billing_anchor_day:=extract(day from new.next_due_at at time zone 'UTC')::integer;
  end if;
  return new;
end; $$;
revoke all on function public.club_guard_recurring_membership_arrangement() from public,anon,authenticated;
drop trigger if exists club_guard_recurring_membership_arrangement on public.club_membership_billing_arrangements;
create trigger club_guard_recurring_membership_arrangement
before insert or update of membership_id,frequency,next_due_at on public.club_membership_billing_arrangements
for each row execute function public.club_guard_recurring_membership_arrangement();

-- Cash is an audited settlement of one existing obligation. An inactive or
-- cancelled membership may retain payment evidence for review, but it cannot
-- generate another obligation or be reactivated by this path.
create or replace function public.club_record_membership_cash_payment(
  p_organisation_id uuid,p_obligation_id uuid,p_location_id uuid,p_amount_minor integer,p_currency text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_membership_billing_obligations%rowtype;
  a public.club_membership_billing_arrangements%rowtype;
  pay public.club_membership_billing_payments%rowtype;
  membership_row public.club_memberships%rowtype;
  product_billing text;
  product_duration_days integer;
  next_due timestamptz;
  next_period text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.record_cash') then
    raise exception 'Membership cash payment is not permitted' using errcode='42501';
  end if;
  if p_location_id is null
    or not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active)
    or not public.club_location_authorized(p_organisation_id,p_location_id) then
    raise exception 'A physical authorised location is required' using errcode='42501';
  end if;
  if nullif(btrim(p_idempotency_key),'') is null or p_amount_minor<=0 or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'Invalid membership cash payment' using errcode='22023';
  end if;
  select * into pay from public.club_membership_billing_payments
  where organisation_id=p_organisation_id and provider_event_key=p_idempotency_key;
  if found then return to_jsonb(pay); end if;
  select * into o from public.club_membership_billing_obligations
  where id=p_obligation_id and organisation_id=p_organisation_id for update;
  if not found or o.payment_method_family<>'cash' or o.state in ('paid','recovered','cancelled','waived')
    or p_amount_minor<>o.amount_minor or p_currency<>o.currency then
    raise exception 'Cash amount does not match an outstanding membership obligation' using errcode='22023';
  end if;
  insert into public.club_membership_billing_payments(
    organisation_id,obligation_id,amount_minor,currency,provider_reference,provider_event_key
  ) values(p_organisation_id,o.id,p_amount_minor,p_currency,'staff-cash:'||p_idempotency_key,p_idempotency_key)
  returning * into pay;
  update public.club_membership_billing_obligations
  set state=case when state in ('failed','grace','retry_scheduled','overdue') then 'recovered' else 'paid' end,
      last_paid_at=now(),last_payment_reference=pay.id::text,failure_reason=null,grace_started_at=null,
      recovery_exhausted_at=null,updated_at=now()
  where id=o.id;
  select * into a from public.club_membership_billing_arrangements
  where id=o.arrangement_id and organisation_id=o.organisation_id for update;
  select membership_record.* into membership_row
  from public.club_memberships membership_record
  join public.club_products product_record on product_record.id=membership_record.product_id and product_record.organisation_id=membership_record.organisation_id
  where membership_record.id=a.membership_id and membership_record.organisation_id=a.organisation_id for share of membership_record;
  if not found then raise exception 'Membership billing record is unavailable' using errcode='22023'; end if;
  select p.billing,p.duration_days into product_billing,product_duration_days from public.club_products p
  where p.id=membership_row.product_id and p.organisation_id=membership_row.organisation_id;
  if membership_row.status='active' and (membership_row.ends_at is null or membership_row.ends_at>now()) and a.state='active'
    and product_billing='recurring' and coalesce(product_duration_days,0) not in (1,7)
    and a.frequency in ('weekly','monthly','quarterly','annual')
    and a.next_due_at<=o.next_due_at then
    if a.frequency='monthly' then
      next_due:=public.club_membership_anniversary(a.next_due_at,coalesce(a.billing_anchor_day,extract(day from a.next_due_at at time zone 'UTC')::integer),1);
    else
      next_due:=public.club_next_membership_billing_due(a.next_due_at,a.frequency);
    end if;
    if next_due is not null then
      next_period:=to_char(next_due at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
      insert into public.club_membership_billing_obligations(
        organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,
        cash_channel,amount_minor,currency,frequency,next_due_at,period_key,coverage_start_at,coverage_end_at
      ) values(a.organisation_id,a.id,a.membership_id,a.user_id,a.customer_id,a.provider_type,a.payment_method_family,
        a.cash_channel,a.amount_minor,a.currency,a.frequency,next_due,next_period,next_due,
        case when a.frequency='monthly' then public.club_membership_anniversary(next_due,a.billing_anchor_day,1)
          else public.club_next_membership_billing_due(next_due,a.frequency) end)
      on conflict(arrangement_id,period_key) do nothing;
      update public.club_membership_billing_arrangements
      set next_due_at=next_due,last_successful_payment_at=now(),updated_at=now()
      where id=a.id and organisation_id=a.organisation_id;
    end if;
  end if;
  return jsonb_build_object('payment',to_jsonb(pay),
    'obligation',(select to_jsonb(x) from public.club_membership_billing_obligations x where x.id=o.id));
end; $$;
revoke all on function public.club_record_membership_cash_payment(uuid,uuid,uuid,integer,text,text) from public,anon,authenticated;

-- Exact-period evidence is mandatory. Period boundaries are derived from the
-- obligation's contractual schedule, never from the actual receipt date.
create or replace function public.club_record_verified_membership_cash_payment(
  p_organisation_id uuid,p_obligation_id uuid,p_location_id uuid,p_amount_minor integer,p_currency text,
  p_idempotency_key text,p_receipt_date date,p_billing_period_start date,p_billing_period_end date,
  p_paid_through_date date,p_verification_note text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb; pay public.club_membership_billing_payments%rowtype;
  o public.club_membership_billing_obligations%rowtype;
  a public.club_membership_billing_arrangements%rowtype;
  member_status text; member_ends_at timestamptz; actor_role text;
  note_value text:=nullif(btrim(p_verification_note),'');
  expected_start date; expected_end date; next_boundary timestamptz; first_record boolean;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.record_cash') then
    raise exception 'Membership cash payment is not permitted' using errcode='42501';
  end if;
  if p_receipt_date is null or p_receipt_date>current_date or p_billing_period_start is null
    or p_billing_period_end is null or p_billing_period_end<p_billing_period_start
    or p_paid_through_date is null or note_value is null or char_length(note_value)>500 then
    raise exception 'Enter a valid received date, billing period, paid-through date and verification note' using errcode='22023';
  end if;
  select * into o from public.club_membership_billing_obligations
  where id=p_obligation_id and organisation_id=p_organisation_id;
  if not found then raise exception 'Membership billing period was not found' using errcode='P0002'; end if;
  select * into a from public.club_membership_billing_arrangements
  where id=o.arrangement_id and organisation_id=o.organisation_id;
  if not found or a.payment_method_family<>'cash' or o.frequency<>a.frequency
    or o.frequency not in ('monthly','weekly','quarterly','annual') then
    raise exception 'Cash settlement requires a supported recurring membership period' using errcode='22023';
  end if;
  next_boundary:=coalesce(o.coverage_end_at,case when o.frequency='monthly'
    then public.club_membership_anniversary(o.next_due_at,coalesce(a.billing_anchor_day,extract(day from o.next_due_at at time zone 'UTC')::integer),1)
    else public.club_next_membership_billing_due(o.next_due_at,o.frequency) end);
  expected_start:=(coalesce(o.coverage_start_at,o.next_due_at) at time zone 'UTC')::date;
  if next_boundary is null then raise exception 'The billing period boundary cannot be verified' using errcode='22023'; end if;
  expected_end:=(next_boundary at time zone 'UTC')::date-1;
  if p_billing_period_start<>expected_start or p_billing_period_end<>expected_end then
    raise exception 'The billing period dates do not match this scheduled renewal period' using errcode='22023';
  end if;
  result:=public.club_record_membership_cash_payment(p_organisation_id,p_obligation_id,p_location_id,p_amount_minor,p_currency,p_idempotency_key);
  select * into pay from public.club_membership_billing_payments
  where organisation_id=p_organisation_id and provider_event_key=p_idempotency_key for update;
  if not found or pay.obligation_id<>p_obligation_id or pay.amount_minor<>p_amount_minor or pay.currency<>p_currency then
    raise exception 'This cash receipt key is already attached to a different payment' using errcode='23505';
  end if;
  if pay.receipt_date is not null and (
    pay.receipt_date<>p_receipt_date or pay.billing_period_start<>p_billing_period_start
    or pay.billing_period_end<>p_billing_period_end or pay.paid_through_date<>p_paid_through_date
    or pay.verification_note<>note_value
  ) then raise exception 'This cash receipt was already recorded with different evidence' using errcode='23505'; end if;
  first_record:=pay.receipt_date is null;
  update public.club_membership_billing_payments set receipt_date=p_receipt_date,
    billing_period_start=p_billing_period_start,billing_period_end=p_billing_period_end,
    paid_through_date=p_paid_through_date,recorded_by=coalesce(recorded_by,auth.uid()),
    verification_note=coalesce(verification_note,note_value)
  where id=pay.id returning * into pay;
  update public.club_membership_payment_access_suspensions set active=false,cleared_at=coalesce(cleared_at,now())
  where organisation_id=p_organisation_id and obligation_id=pay.obligation_id and active;
  select m.status,m.ends_at into member_status,member_ends_at
  from public.club_membership_billing_obligations ob
  join public.club_memberships m on m.id=ob.membership_id and m.organisation_id=ob.organisation_id
  where ob.organisation_id=p_organisation_id and ob.id=pay.obligation_id;
  if first_record then
    select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
    insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,reason,metadata)
    values(p_organisation_id,auth.uid(),actor_role,'membership.cash_payment_verified','membership_billing_payment',pay.id,note_value,
      jsonb_build_object('obligationId',pay.obligation_id,'amountMinor',pay.amount_minor,'currency',pay.currency,
        'receiptDate',p_receipt_date,'billingPeriodStart',p_billing_period_start,'billingPeriodEnd',p_billing_period_end,
        'paidThroughDate',p_paid_through_date,'locationId',p_location_id,'idempotencyKey',p_idempotency_key));
  end if;
  return jsonb_build_object('payment',to_jsonb(pay),'settlement',result,
    'membershipStatus',member_status,'membershipEndsAt',member_ends_at,
    'coverageNeedsReview',member_status<>'active' or (member_ends_at is not null and member_ends_at<=now()));
end; $$;
revoke all on function public.club_record_verified_membership_cash_payment(uuid,uuid,uuid,integer,text,text,date,date,text) from public,anon,authenticated;
revoke all on function public.club_record_verified_membership_cash_payment(uuid,uuid,uuid,integer,text,text,date,date,date,date,text) from public,anon;
grant execute on function public.club_record_verified_membership_cash_payment(uuid,uuid,uuid,integer,text,text,date,date,date,date,text) to authenticated;

create or replace function public.club_list_customer_billing(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'id',o.id,'membership_id',o.membership_id,'amount_minor',o.amount_minor,'currency',o.currency,
  'next_due_at',o.next_due_at,'state',o.state,'payment_method_family',o.payment_method_family,
  'cash_channel',o.cash_channel,'frequency',o.frequency,'billing_anchor_day',a.billing_anchor_day,
  'coverage_start_at',o.coverage_start_at,'coverage_end_at',o.coverage_end_at,
  'failure_reason',o.failure_reason,'provider_status',o.provider_status,
  'provider_charge_date',o.provider_charge_date,'provider_payment_reference',o.provider_payment_reference,
  'mandate_status',a.provider_authority_state,'collection_status',a.collection_status,
  'action_required_reason',a.action_required_reason,'paid_through_at',a.coverage_paid_through_at
) order by o.next_due_at),'[]'::jsonb)
from public.club_membership_billing_obligations o
join public.club_membership_billing_arrangements a on a.id=o.arrangement_id and a.organisation_id=o.organisation_id
where o.organisation_id=p_organisation_id
  and (o.customer_id=p_customer_id or exists(select 1 from public.club_customers c where c.id=p_customer_id and c.organisation_id=o.organisation_id and c.user_id=o.user_id))
  and public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take');
$$;
revoke all on function public.club_list_customer_billing(uuid,uuid) from public,anon;
grant execute on function public.club_list_customer_billing(uuid,uuid) to authenticated;

comment on column public.club_membership_billing_payments.receipt_date is 'Actual staff-verified date payment was received; distinct from the contractual billing period and paid-through date.';
comment on column public.club_membership_billing_payments.billing_period_start is 'Inclusive start date of the scheduled obligation period settled by this payment.';
comment on column public.club_membership_billing_payments.billing_period_end is 'Inclusive final date of the scheduled obligation period settled by this payment.';
