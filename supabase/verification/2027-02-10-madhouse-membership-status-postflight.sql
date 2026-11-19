-- READ ONLY. Run after the Madhouse membership-status correction.
-- Aggregate counts only; no names, emails, phone numbers or PINs are returned.
with scope as (
  select 'fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid organisation_id,
         '6bf9d303-525a-4565-88a4-b4121fac7f98'::uuid batch_id
), imported as (
  select m.id,m.organisation_id,m.status,m.product_id,m.starts_at,m.ends_at,ir.imported_customer_id,
    c.user_id,u.email_confirmed_at,u.phone_confirmed_at
  from scope s
  join public.club_memberships m on m.organisation_id=s.organisation_id and m.import_batch_id=s.batch_id
  join public.club_member_import_rows ir on ir.id=m.import_row_id and ir.organisation_id=m.organisation_id and ir.imported_membership_id=m.id
  left join public.club_customers c on c.id=ir.imported_customer_id and c.organisation_id=ir.organisation_id
  left join auth.users u on u.id=c.user_id
), corrections as (
  select a.* from scope s join public.club_import_membership_status_corrections a
    on a.organisation_id=s.organisation_id and a.batch_id=s.batch_id
    and a.migration_key='2027-02-10-madhouse-imported-membership-status-correction'
), grant_state as (
  select i.id membership_id,
    exists(select 1 from public.club_entitlement_grants g where g.organisation_id=i.organisation_id
      and g.membership_id=i.id and g.user_id=i.user_id and g.entitlement_key='gym_access'
      and g.starts_at<=now() and (g.ends_at is null or g.ends_at>now())) has_valid_gym_grant
  from imported i where i.user_id is not null
)
select 'import_rows' metric,count(*)::bigint value from scope s join public.club_member_import_rows ir
  on ir.organisation_id=s.organisation_id and ir.batch_id=s.batch_id
union all select 'imported_memberships',count(*) from imported
union all select 'status_corrections_audited',count(*) from corrections
union all select 'corrected_membership_still_active',count(*) from imported i join corrections a on a.membership_id=i.id and a.organisation_id=i.organisation_id where i.status='active'
union all select 'corrected_product_or_start_changed',count(*) from imported i join corrections a on a.membership_id=i.id and a.organisation_id=i.organisation_id where i.product_id<>a.product_id or i.starts_at<>a.starts_at
union all select 'corrected_expiry_changed',count(*) from imported i join corrections a on a.membership_id=i.id and a.organisation_id=i.organisation_id where i.ends_at is distinct from a.ends_at
union all select 'active_unlinked_or_unverified',count(*) from imported i where i.status='active'
  and (i.user_id is null or (i.email_confirmed_at is null and i.phone_confirmed_at is null))
union all select 'active_linked_without_valid_gym_grant',count(*) from imported i join grant_state g on g.membership_id=i.id
  where i.status='active' and i.user_id is not null and (i.email_confirmed_at is not null or i.phone_confirmed_at is not null) and not g.has_valid_gym_grant
union all select 'active_linked_with_valid_gym_grant',count(*) from imported i join grant_state g on g.membership_id=i.id
  where i.status='active' and i.user_id is not null and (i.email_confirmed_at is not null or i.phone_confirmed_at is not null) and g.has_valid_gym_grant
union all select 'still_expired_memberships',count(*) from imported where status='expired'
union all select 'other_membership_statuses',count(*) from imported where status not in ('active','expired');
