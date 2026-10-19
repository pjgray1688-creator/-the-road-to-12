-- Synthetic negative-path fixture for the 2026-12-31 migration preflight.
-- The disposable harness runs this in a clone after 12-30 and before 12-31.
-- Intentionally does not begin a transaction: rows are isolated to a database
-- that the harness drops at exit, while the migration itself is tested with
-- --single-transaction so expected preflight failures prove rollback safety.

insert into auth.users(id, email)
values ('4a000000-0000-4000-8000-000000000010', 'anchor-guard@example.test');

insert into public.club_organisations(id, name, slug)
values ('4a000000-0000-4000-8000-000000000011', 'Anchor guard test', 'anchor-guard-test');

insert into public.club_products(id, organisation_id, name, kind, price_minor, currency, billing, duration_days)
values ('4a000000-0000-4000-8000-000000000012', '4a000000-0000-4000-8000-000000000011', 'Monthly anchor test', 'membership', 1000, 'GBP', 'recurring', null);

insert into public.club_memberships(id, organisation_id, product_id, status, starts_at, source, assignment_idempotency_key)
values ('4a000000-0000-4000-8000-000000000013', '4a000000-0000-4000-8000-000000000011', '4a000000-0000-4000-8000-000000000012', 'active', '2024-01-01 00:00:00+00', 'anchor_guard_fixture', 'anchor-guard-membership');

insert into public.club_membership_billing_arrangements(
  id, organisation_id, membership_id, user_id, provider_type,
  payment_method_family, amount_minor, currency, frequency, next_due_at
) values (
  '4a000000-0000-4000-8000-000000000001', '4a000000-0000-4000-8000-000000000011',
  '4a000000-0000-4000-8000-000000000013', '4a000000-0000-4000-8000-000000000010',
  'cash', 'other', 1000, 'GBP', 'monthly', '2024-03-30 10:00:00+00'
);

-- The pre-12-31 arrangement trigger may initially derive an anchor from the
-- due date. Set this field alone so the test models a legacy unresolved row.
update public.club_membership_billing_arrangements
set billing_anchor_day = 30
where id = '4a000000-0000-4000-8000-000000000001';

insert into public.club_membership_billing_obligations(
  id, organisation_id, arrangement_id, membership_id, user_id, provider_type,
  payment_method_family, amount_minor, currency, frequency, next_due_at,
  period_key, state, coverage_start_at, coverage_end_at
) values (
  '4a000000-0000-4000-8000-000000000002', '4a000000-0000-4000-8000-000000000011',
  '4a000000-0000-4000-8000-000000000001', '4a000000-0000-4000-8000-000000000013',
  '4a000000-0000-4000-8000-000000000010', 'cash', 'other', 1000, 'GBP', 'monthly',
  '2024-03-30 10:00:00+00', 'anchor-guard-2024-03', 'due',
  '2024-03-30 10:00:00+00', '2024-04-30 10:00:00+00'
);

do $$
begin
  if (select billing_anchor_day from public.club_membership_billing_arrangements where id='4a000000-0000-4000-8000-000000000001') <> 30 then
    raise exception 'Synthetic arrangement did not start with the expected March 30 anchor';
  end if;
  if (select next_due_at from public.club_membership_billing_obligations where id='4a000000-0000-4000-8000-000000000002') <> '2024-03-30 10:00:00+00'::timestamptz then
    raise exception 'Synthetic obligation trigger did not preserve the March 30 scheduled due date';
  end if;
end;
$$;
