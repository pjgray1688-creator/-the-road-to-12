-- Final assertions after corrected synthetic evidence permits migration.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='club_membership_billing_payments'
      and column_name='billing_period_start' and data_type='date'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='club_membership_billing_payments'
      and column_name='billing_period_end' and data_type='date'
  ) then
    raise exception 'Corrected anchor evidence did not permit payment-period columns to be installed';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.club_membership_billing_payments'::regclass
      and conname='club_membership_billing_payment_period_pair_check'
  ) then
    raise exception 'Corrected anchor evidence did not permit the payment-period constraint to be installed';
  end if;
  if (select billing_anchor_day from public.club_membership_billing_arrangements where id='4a000000-0000-4000-8000-000000000001') <> 30
     or (select next_due_at from public.club_membership_billing_arrangements where id='4a000000-0000-4000-8000-000000000001') <> '2024-03-30 10:00:00+00'::timestamptz
     or (select coverage_start_at from public.club_membership_billing_obligations where id='4a000000-0000-4000-8000-000000000002') <> '2024-03-30 10:00:00+00'::timestamptz then
    raise exception 'Successful migration changed corrected synthetic anchor or schedule evidence';
  end if;
end;
$$;
