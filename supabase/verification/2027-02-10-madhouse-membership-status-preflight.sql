-- READ ONLY. Run before the status-correction migration in Supabase SQL Editor.
-- Outputs aggregate decision counts only; no member names, emails or phone data.
with scope as (
  select 'fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid organisation_id,
         '6bf9d303-525a-4565-88a4-b4121fac7f98'::uuid batch_id
), population as (
  select ir.id import_row_id,ir.imported_customer_id,ir.imported_membership_id,m.id membership_id,
    m.status,m.starts_at,m.ends_at,m.ended_at,m.migration_metadata,p.id product_id,p.name product_name,
    p.is_lifetime,p.legacy_import_category,
    exists(select 1 from public.club_product_entitlements pe where pe.organisation_id=ir.organisation_id and pe.product_id=p.id and pe.entitlement_key='gym_access') has_gym_access,
    exists(select 1 from public.club_membership_payment_access_suspensions s where s.organisation_id=ir.organisation_id and s.membership_id=m.id and s.active) payment_suspended,
    exists(select 1 from public.club_membership_access_events ae where ae.organisation_id=ir.organisation_id and ae.membership_id=m.id and ae.new_status='paused'
      and not exists(select 1 from public.club_membership_access_events later where later.organisation_id=ae.organisation_id and later.membership_id=ae.membership_id and later.created_at>ae.created_at and later.new_status='active')) manually_paused,
    exists(select 1 from public.club_membership_billing_obligations o where o.organisation_id=ir.organisation_id and o.membership_id=m.id and o.state in ('due','payment_pending','failed','grace','retry_scheduled','overdue')) unpaid_or_failed,
    exists(select 1 from public.club_membership_billing_arrangements a where a.organisation_id=ir.organisation_id and a.membership_id=m.id and a.state in ('cancelled','failed','suspended','action_required')) cancelled_provider,
    exists(select 1 from public.club_membership_counter_payments cp where cp.organisation_id=ir.organisation_id and cp.membership_id=m.id and cp.state in ('pending_verification','rejected')) unresolved_counter_payment,
    exists(select 1 from public.club_membership_shared_contracts sc where sc.organisation_id=ir.organisation_id and sc.membership_id=m.id and (
      sc.provider_reconciliation_state in ('pending','mismatch') or lower(coalesce(sc.billing_state,'')) in ('unpaid','failed','overdue','cancelled','pending','suspended','action_required')
      or (sc.paid_through_date is not null and sc.paid_through_date<current_date))) household_payment_block,
    exists(select 1 from public.club_audit_events ae where ae.organisation_id=ir.organisation_id
      and ((ae.target_type='membership' and ae.target_id=m.id) or (ae.target_type='customer' and ae.target_id=ir.imported_customer_id))
      and (ae.action ilike '%fraud%' or ae.action ilike '%do_not_activate%' or ae.action ilike '%access_restrict%')) risk_restriction
  from scope s
  join public.club_member_import_rows ir on ir.organisation_id=s.organisation_id and ir.batch_id=s.batch_id
  left join public.club_memberships m on m.id=ir.imported_membership_id and m.organisation_id=ir.organisation_id
  left join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id
), classified as (
  select *, case
    when membership_id is null then 'pending_review_no_imported_membership'
    when status='active' then 'already_active_unchanged'
    when status='expired' and ended_at is null and migration_metadata->>'source_system'='clubmanager'
      and nullif(btrim(migration_metadata->>'source_status'),'') is null
      and legacy_import_category is null and starts_at<=now() and (is_lifetime or ends_at>now())
      and has_gym_access and not payment_suspended and not manually_paused and not unpaid_or_failed
      and not cancelled_provider and not unresolved_counter_payment and not household_payment_block and not risk_restriction
      then 'eligible_for_status_correction'
    when status='expired' and (is_lifetime or ends_at>now()) then 'manual_review_current_term_has_blocker_or_no_gym_entitlement'
    when status='expired' and ends_at is not null and ends_at<=now()-interval '2 months' then 'former_over_two_months'
    when status='expired' and ends_at is not null and ends_at<=now() then 'recent_lapse_within_two_months'
    else 'manual_review_other_status_or_missing_dates' end classification
  from population
)
select classification,count(*)::integer records
from classified
group by classification
order by classification;

-- Expected completed import population: 702 rows, 477 membership links.
select count(*) import_rows,
       count(*) filter(where imported_membership_id is not null) linked_memberships,
       count(*) filter(where imported_membership_id is null) profile_only
from public.club_member_import_rows
where organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid
  and batch_id='6bf9d303-525a-4565-88a4-b4121fac7f98'::uuid;
