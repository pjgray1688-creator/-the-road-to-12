-- READ-ONLY production preflight for monthly billing anniversaries.
-- This report does not update anchors or any other data. Review output with
-- authoritative Club Manager schedule/payment-period records before any
-- explicitly approved anchor resolution and the 2026-12-31 migration.
begin read only;

with monthly_arrangements as (
  select
    a.organisation_id,
    org.name as organisation_name,
    a.id as arrangement_id,
    a.membership_id,
    a.user_id as payer_user_id,
    a.customer_id as payer_customer_id,
    a.provider_type,
    a.payment_method_family,
    a.frequency,
    a.state as arrangement_state,
    a.next_due_at,
    a.billing_anchor_day,
    (a.next_due_at at time zone 'UTC')::date as next_due_utc_date,
    extract(day from a.next_due_at at time zone 'UTC')::integer as inferred_due_day,
    (
      (a.next_due_at at time zone 'UTC')::date =
      (date_trunc('month', a.next_due_at at time zone 'UTC') + interval '1 month - 1 day')::date
    ) as next_due_is_month_end,
    coalesce((select count(*) from public.club_membership_billing_obligations o
      where o.arrangement_id=a.id and o.organisation_id=a.organisation_id), 0)::integer as historical_period_count,
    coalesce((select array_agg(distinct extract(day from dates.evidence_date)::integer
      order by extract(day from dates.evidence_date)::integer)
      from (
        select (o.next_due_at at time zone 'UTC')::date as evidence_date
        from public.club_membership_billing_obligations o
        where o.arrangement_id=a.id and o.organisation_id=a.organisation_id
        union
        select (o.coverage_start_at at time zone 'UTC')::date
        from public.club_membership_billing_obligations o
        where o.arrangement_id=a.id and o.organisation_id=a.organisation_id and o.coverage_start_at is not null
      ) dates), '{}'::integer[]) as historical_observed_start_days,
    coalesce((select count(*)
      from (
        select (o.next_due_at at time zone 'UTC')::date as evidence_date
        from public.club_membership_billing_obligations o
        where o.arrangement_id=a.id and o.organisation_id=a.organisation_id
        union
        select (o.coverage_start_at at time zone 'UTC')::date
        from public.club_membership_billing_obligations o
        where o.arrangement_id=a.id and o.organisation_id=a.organisation_id and o.coverage_start_at is not null
      ) dates
      where a.billing_anchor_day is not null
        and extract(day from dates.evidence_date)::integer <>
          least(a.billing_anchor_day,
            extract(day from (date_trunc('month', dates.evidence_date::timestamp) + interval '1 month - 1 day'))::integer)
    ), 0)::integer as historical_anchor_conflict_count,
    coalesce((select jsonb_agg(jsonb_build_object(
        'obligation_id', o.id,
        'period_key', o.period_key,
        'state', o.state,
        'scheduled_due_at', o.next_due_at,
        'observed_start_date_utc', (coalesce(o.coverage_start_at, o.next_due_at) at time zone 'UTC')::date,
        'coverage_start_at', o.coverage_start_at,
        'coverage_end_at', o.coverage_end_at,
        'payments', coalesce(payment_evidence.payments, '[]'::jsonb)
      ) order by o.next_due_at, o.id)
      from public.club_membership_billing_obligations o
      left join lateral (
        select jsonb_agg(jsonb_build_object(
          'payment_id', p.id,
          'provider_event_recorded_at', p.occurred_at
        ) order by p.occurred_at, p.id) as payments
        from public.club_membership_billing_payments p
        where p.organisation_id=o.organisation_id and p.obligation_id=o.id
      ) payment_evidence on true
      where o.arrangement_id=a.id and o.organisation_id=a.organisation_id
    ), '[]'::jsonb) as historical_period_evidence
  from public.club_membership_billing_arrangements a
  join public.club_organisations org on org.id = a.organisation_id
  where a.frequency = 'monthly'
), classified as (
  select m.*,
    case
      when m.billing_anchor_day is not null and (
        m.inferred_due_day <> least(m.billing_anchor_day,
          extract(day from (date_trunc('month', m.next_due_at at time zone 'UTC') + interval '1 month - 1 day'))::integer)
        or m.historical_anchor_conflict_count > 0
      ) then 'ANCHOR_CONFLICT'
      when m.billing_anchor_day is null and (
        (m.next_due_is_month_end and m.inferred_due_day < 31)
        or exists (
          select 1
          from jsonb_array_elements(m.historical_period_evidence) item
          where (item.value->>'observed_start_date_utc')::date =
              (date_trunc('month', (item.value->>'observed_start_date_utc')::date::timestamp) + interval '1 month - 1 day')::date
            and extract(day from (item.value->>'observed_start_date_utc')::date)::integer < 31
        )
      ) then 'MISSING_ANCHOR_POSSIBLE_MONTH_END_CLAMP'
      when m.billing_anchor_day is null then 'MISSING_ANCHOR_REQUIRES_SOURCE_REVIEW'
      else 'ANCHOR_PRESENT_REVIEW_HISTORY'
    end as risk_category
  from monthly_arrangements m
)
select
  case when grouping(arrangement_id) = 1 then 'ORGANISATION_RISK_TOTAL' else 'ARRANGEMENT_DETAIL' end as report_row,
  organisation_id,
  organisation_name,
  arrangement_id,
  membership_id,
  payer_user_id,
  payer_customer_id,
  provider_type,
  payment_method_family,
  frequency,
  arrangement_state,
  next_due_at,
  billing_anchor_day,
  inferred_due_day,
  next_due_is_month_end,
  historical_period_count,
  historical_observed_start_days,
  historical_anchor_conflict_count,
  historical_period_evidence,
  risk_category,
  count(*)::integer as arrangements_in_group
from classified
group by grouping sets (
  (organisation_id, organisation_name, arrangement_id, membership_id, payer_user_id,
   payer_customer_id, provider_type, payment_method_family, frequency, arrangement_state,
   next_due_at, billing_anchor_day, inferred_due_day, next_due_is_month_end,
   historical_period_count, historical_observed_start_days, historical_anchor_conflict_count,
   historical_period_evidence, risk_category),
  (organisation_id, organisation_name, risk_category)
)
order by organisation_name, organisation_id, grouping(arrangement_id) desc,
  risk_category, arrangement_id;

rollback;
