-- READ ONLY. Run in Supabase SQL Editor after selecting the Madhouse project.
-- Returns aggregate counts only: no names, email addresses, UUIDs, tokens,
-- credential material, or individual rows are selected.
-- Active population and email/household tests mirror the deployed preview and
-- club_madhouse_member_activation_candidate_state classifier.
begin;
set transaction read only;

with active_memberships as materialized (
  select m.id,m.organisation_id,m.product_id
  from public.club_memberships m
  join public.club_product_entitlements pe on pe.organisation_id=m.organisation_id
    and pe.product_id=m.product_id and pe.entitlement_key='gym_access'
  where m.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'
    and m.status='active' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())
), active_customer_memberships as materialized (
  select h.customer_id,m.id membership_id
  from public.club_membership_holders h
  join active_memberships m on m.id=h.membership_id and m.organisation_id=h.organisation_id
  where h.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb' and h.customer_id is not null
  union
  select c.id,m.id
  from public.club_customers c
  join public.club_membership_holders h on h.organisation_id=c.organisation_id and h.user_id=c.user_id
  join active_memberships m on m.id=h.membership_id and m.organisation_id=h.organisation_id
  where c.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb' and c.user_id is not null
), active_customer_ids as materialized (
  select distinct customer_id from active_customer_memberships
), customer_membership_flags as materialized (
  select c.id customer_id,
    coalesce(bool_or(m.id is not null),false) has_membership_record,
    coalesce(bool_or(m.id is not null and (m.status<>'active' or m.ends_at<=now() or p.legacy_import_category is not null)),false) has_inactive_or_historical_membership
  from public.club_customers c
  left join public.club_membership_holders h on h.organisation_id=c.organisation_id
    and (h.customer_id=c.id or (c.user_id is not null and h.user_id=c.user_id))
  left join public.club_memberships m on m.id=h.membership_id and m.organisation_id=h.organisation_id
  left join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id
  where c.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'
  group by c.id
), customer_email_stats as materialized (
  select lower(btrim(coalesce(c.email,''))) email,
    count(*)::integer customer_count,
    count(*) filter(where a.customer_id is not null)::integer active_customer_count,
    count(*) filter(where f.has_inactive_or_historical_membership)::integer inactive_or_historical_membership_customers,
    count(*) filter(where not f.has_membership_record)::integer profile_only_customers,
    count(*) filter(where exists(select 1 from public.club_member_import_identities i
      where i.organisation_id=c.organisation_id and i.customer_id=c.id and i.source_system='clubmanager'))::integer imported_customer_count
  from public.club_customers c
  left join active_customer_ids a on a.customer_id=c.id
  join customer_membership_flags f on f.customer_id=c.id
  where c.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'
  group by lower(btrim(coalesce(c.email,'')))
), import_email_stats as materialized (
  select lower(btrim(coalesce(r.normalized_values->>'email',''))) email,
    count(*)::integer row_count,
    count(distinct nullif(btrim(r.normalized_values->>'legacyReference'),''))::integer distinct_reference_count,
    count(*) filter(where nullif(btrim(r.normalized_values->>'legacyReference'),'') is not null)::integer referenced_row_count
  from public.club_member_import_rows r
  where r.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'
    and nullif(btrim(r.normalized_values->>'email'),'') is not null
  group by lower(btrim(coalesce(r.normalized_values->>'email','')))
), household_customers as materialized (
  select distinct i.customer_id
  from public.club_member_import_identities i
  join public.club_member_import_rows r on r.organisation_id=i.organisation_id
    and r.normalized_values->>'legacyReference'=i.source_member_reference
  join public.club_member_import_batches b on b.id=r.batch_id and b.organisation_id=r.organisation_id
  where i.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'
    and i.source_system='clubmanager'
    and nullif(btrim(coalesce(r.raw_values->>(b.mapping->>'householdReference'),
      r.raw_values->>'shared_contract_id',r.raw_values->>'household_reference')),'') is not null
), auth_email_conflicts as materialized (
  select lower(btrim(coalesce(u.email,''))) email,
    bool_or(exists(select 1 from public.club_customers linked
      where linked.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb' and linked.user_id=u.id)) has_linked_customer
  from auth.users u
  where lower(btrim(coalesce(u.email,''))) in (
    select lower(btrim(coalesce(c.email,''))) from public.club_customers c
    join active_customer_ids a on a.customer_id=c.id
    where c.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'
      and nullif(btrim(c.email),'') is not null
  )
  group by lower(btrim(coalesce(u.email,'')))
), latest_invites as materialized (
  select distinct on (i.customer_id) i.customer_id,i.status,i.expires_at
  from public.club_madhouse_member_activation_invitations i
  where i.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'
  order by i.customer_id,i.created_at desc,i.id desc
), candidates as materialized (
  select c.id,c.user_id,lower(btrim(coalesce(c.email,''))) email,
    coalesce(es.customer_count,0) customer_count,
    coalesce(es.active_customer_count,0) active_customer_count,
    greatest(coalesce(es.inactive_or_historical_membership_customers,0)-case when cmf.has_inactive_or_historical_membership then 1 else 0 end,0) other_inactive_or_historical_membership_customers,
    greatest(coalesce(es.profile_only_customers,0)-case when not cmf.has_membership_record then 1 else 0 end,0) other_profile_only_customers,
    coalesce(es.imported_customer_count,0) imported_customer_count,
    coalesce(irs.row_count,0) import_row_count,
    coalesce(irs.distinct_reference_count,0) import_reference_count,
    coalesce(irs.referenced_row_count,0) import_referenced_row_count,
    (hc.customer_id is not null) source_household_marker,
    exists(select 1 from active_customer_memberships acm
      join public.club_membership_shared_contracts sc on sc.membership_id=acm.membership_id
        and sc.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'
      where acm.customer_id=c.id) shared_contract,
    exists(select 1 from active_customer_memberships acm
      join public.club_membership_shared_contracts sc on sc.membership_id=acm.membership_id
        and sc.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'
      where acm.customer_id=c.id and sc.responsible_payer_customer_id<>c.id) external_payer,
    coalesce(aec.has_linked_customer,false) auth_link_conflict,
    i.status invite_status,i.expires_at invite_expires_at
  from active_customer_ids a
  join public.club_customers c on c.id=a.customer_id
    and c.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'
  join customer_membership_flags cmf on cmf.customer_id=c.id
  left join customer_email_stats es on es.email=lower(btrim(coalesce(c.email,'')))
  left join import_email_stats irs on irs.email=lower(btrim(coalesce(c.email,'')))
  left join household_customers hc on hc.customer_id=c.id
  left join auth_email_conflicts aec on aec.email=lower(btrim(coalesce(c.email,'')))
  left join latest_invites i on i.customer_id=c.id
), classified as materialized (
  select c.*,
    case
      when c.user_id is not null then 'already_linked'
      when c.email='' then 'missing_email'
      when c.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'invalid_email'
      when split_part(c.email,'@',2) in ('example.com','example.net','example.org','invalid','localhost')
        or split_part(c.email,'@',1) in ('admin','family','info','membership','noreply','no-reply','shared','test','unknown','placeholder')
        or split_part(c.email,'@',1) like '%placeholder%' then 'shared_or_placeholder'
      when c.customer_count>1 or c.import_row_count>1 or c.source_household_marker then 'shared_or_ambiguous_email'
      when c.auth_link_conflict then 'account_link_conflict'
      else 'eligible'
    end eligibility,
    case when c.invite_status='redeemed' then 'completed'
      when c.user_id is not null then 'already_linked'
      when c.invite_status in ('queued','sent') and c.invite_expires_at<=now() then 'expired'
      when c.invite_status in ('queued','sent') then c.invite_status
      when c.invite_status='failed' then 'failed'
      when c.invite_status='exception' then 'exception'
      when c.invite_status='revoked' then 'revoked'
      else case
        when c.user_id is not null then 'already_linked'
        when c.email='' then 'missing_email'
        when c.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'invalid_email'
        when split_part(c.email,'@',2) in ('example.com','example.net','example.org','invalid','localhost')
          or split_part(c.email,'@',1) in ('admin','family','info','membership','noreply','no-reply','shared','test','unknown','placeholder')
          or split_part(c.email,'@',1) like '%placeholder%' then 'shared_or_placeholder'
        when c.customer_count>1 or c.import_row_count>1 or c.source_household_marker then 'shared_or_ambiguous_email'
        when c.auth_link_conflict then 'account_link_conflict'
        else 'eligible' end
    end display_state
  from candidates c
), metrics as (
  select 'Active membership candidates' metric,count(*)::bigint affected_active_customers,count(distinct nullif(email,''))::bigint distinct_emails from classified
  union all select 'Currently eligible by deployed classifier',count(*) filter(where eligibility='eligible' and (invite_status is null or invite_status in ('failed','expired','revoked') or (invite_status in ('queued','sent') and invite_expires_at<=now())))::bigint,count(distinct nullif(email,'')) filter(where eligibility='eligible')::bigint from classified
  union all select 'Already linked',count(*) filter(where eligibility='already_linked')::bigint,count(distinct nullif(email,'')) filter(where eligibility='already_linked')::bigint from classified
  union all select 'Missing email',count(*) filter(where eligibility='missing_email')::bigint,0::bigint from classified
  union all select 'Malformed email',count(*) filter(where eligibility='invalid_email')::bigint,count(distinct email) filter(where eligibility='invalid_email')::bigint from classified
  union all select 'Placeholder or unusable email',count(*) filter(where eligibility='shared_or_placeholder')::bigint,count(distinct email) filter(where eligibility='shared_or_placeholder')::bigint from classified
  union all select 'Same normalized address used by multiple active customers',count(*) filter(where user_id is null and email<>'' and active_customer_count>1)::bigint,count(distinct email) filter(where user_id is null and email<>'' and active_customer_count>1)::bigint from classified
  union all select 'Address collision only with inactive or profile-only customers',count(*) filter(where user_id is null and email<>'' and customer_count>1 and active_customer_count=1)::bigint,count(distinct email) filter(where user_id is null and email<>'' and customer_count>1 and active_customer_count=1)::bigint from classified
  union all select 'Matches another inactive or historical membership profile (overlapping)',count(*) filter(where user_id is null and email<>'' and other_inactive_or_historical_membership_customers>0)::bigint,count(distinct email) filter(where user_id is null and email<>'' and other_inactive_or_historical_membership_customers>0)::bigint from classified
  union all select 'Matches another profile-only customer (overlapping)',count(*) filter(where user_id is null and email<>'' and other_profile_only_customers>0)::bigint,count(distinct email) filter(where user_id is null and email<>'' and other_profile_only_customers>0)::bigint from classified
  union all select 'Duplicate imported customer profiles with same normalized address',count(*) filter(where user_id is null and email<>'' and imported_customer_count>1)::bigint,count(distinct email) filter(where user_id is null and email<>'' and imported_customer_count>1)::bigint from classified
  union all select 'Repeated import rows: one nonblank legacy reference only',count(*) filter(where user_id is null and import_row_count>1 and import_reference_count=1 and import_referenced_row_count=import_row_count)::bigint,count(distinct email) filter(where user_id is null and import_row_count>1 and import_reference_count=1 and import_referenced_row_count=import_row_count)::bigint from classified
  union all select 'Repeated import rows: multiple or missing legacy references',count(*) filter(where user_id is null and import_row_count>1 and (import_reference_count<>1 or import_referenced_row_count<>import_row_count))::bigint,count(distinct email) filter(where user_id is null and import_row_count>1 and (import_reference_count<>1 or import_referenced_row_count<>import_row_count))::bigint from classified
  union all select 'Source household marker (overlapping)',count(*) filter(where user_id is null and source_household_marker)::bigint,count(distinct email) filter(where user_id is null and source_household_marker and email<>'')::bigint from classified
  union all select 'Shared membership contract / payer (overlapping)',count(*) filter(where user_id is null and shared_contract)::bigint,count(distinct email) filter(where user_id is null and shared_contract and email<>'')::bigint from classified
  union all select 'Responsible payer is a different Club customer (overlapping)',count(*) filter(where user_id is null and external_payer)::bigint,count(distinct email) filter(where user_id is null and external_payer and email<>'')::bigint from classified
  union all select 'Different customer is already linked to matching Auth email',count(*) filter(where user_id is null and auth_link_conflict)::bigint,count(distinct email) filter(where user_id is null and auth_link_conflict)::bigint from classified
  union all select 'Potential staff-review candidates: unique customer address blocked by duplicate import rows or household marker',count(*) filter(where user_id is null and eligibility='shared_or_ambiguous_email' and customer_count=1 and active_customer_count=1 and not auth_link_conflict and (import_row_count>1 or source_household_marker))::bigint,count(distinct email) filter(where user_id is null and eligibility='shared_or_ambiguous_email' and customer_count=1 and active_customer_count=1 and not auth_link_conflict and (import_row_count>1 or source_household_marker))::bigint from classified
  union all select 'Invitation pending or sent',count(*) filter(where display_state in ('queued','sent'))::bigint,count(distinct email) filter(where display_state in ('queued','sent') and email<>'')::bigint from classified
  union all select 'Invitation completed',count(*) filter(where display_state='completed')::bigint,count(distinct email) filter(where display_state='completed' and email<>'')::bigint from classified
)
select metric,affected_active_customers,distinct_emails from metrics order by metric;

rollback;
