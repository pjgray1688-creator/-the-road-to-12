-- Set-based, tenant-scoped invitation preview. The previous preview invoked
-- club_madhouse_member_activation_candidate_state once per active customer;
-- that function repeatedly scanned import rows and household identities.
-- Preserve the classifier's outcomes while computing duplicate facts once.
begin;

do $$ begin
  if to_regprocedure('public.club_capability_allowed(uuid,uuid,text)') is null
    or to_regprocedure('public.club_madhouse_member_activation_candidate_state(uuid)') is null
    or to_regclass('public.club_madhouse_member_activation_invitations') is null
    or to_regclass('public.club_member_import_rows') is null
    or to_regclass('public.club_member_import_identities') is null
    or to_regclass('public.club_member_import_batches') is null then
    raise exception 'Member activation preview prerequisites are missing; no changes made';
  end if;
end $$;

-- The prior classifier compares normalized email expressions and household
-- source references. These indexes support the now-set-based grouping/join.
create index if not exists club_customers_org_normalized_email_idx
  on public.club_customers(organisation_id,lower(btrim(coalesce(email,''))));
create index if not exists club_member_import_rows_org_normalized_email_idx
  on public.club_member_import_rows(organisation_id,lower(btrim(coalesce(normalized_values->>'email',''))))
  where nullif(btrim(normalized_values->>'email'),'') is not null;
create index if not exists club_member_import_rows_org_legacy_reference_idx
  on public.club_member_import_rows(organisation_id,(normalized_values->>'legacyReference'))
  where nullif(btrim(normalized_values->>'legacyReference'),'') is not null;
create index if not exists club_member_import_identities_org_customer_idx
  on public.club_member_import_identities(organisation_id,source_system,customer_id,source_member_reference);
create index if not exists club_madhouse_activation_invites_latest_idx
  on public.club_madhouse_member_activation_invitations(organisation_id,customer_id,created_at desc,id desc)
  include(status,expires_at);

create or replace function public.club_preview_madhouse_member_activation_invitations(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,auth as $$
declare v_rows jsonb; v_counts jsonb; v_eligible integer;
begin
  if auth.uid() is null or p_organisation_id<>'fa44592a-1593-4ad3-a621-63a4a4bcbceb'
    or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.link_account')
    or not exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id
      and m.user_id=auth.uid() and m.active and m.role in ('owner','gym_admin')) then
    raise exception 'Member invitation management is not permitted' using errcode='42501';
  end if;

  with active_memberships as materialized (
    select m.id,m.organisation_id,m.product_id
    from public.club_memberships m
    join public.club_product_entitlements pe on pe.organisation_id=m.organisation_id
      and pe.product_id=m.product_id and pe.entitlement_key='gym_access'
    where m.organisation_id=p_organisation_id and m.status='active'
      and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())
  ), active_customer_ids as materialized (
    select h.customer_id customer_id
    from public.club_membership_holders h
    join active_memberships m on m.id=h.membership_id and m.organisation_id=h.organisation_id
    where h.organisation_id=p_organisation_id and h.customer_id is not null
    union
    select c.id
    from public.club_customers c
    join public.club_membership_holders h on h.organisation_id=c.organisation_id and h.user_id=c.user_id
    join active_memberships m on m.id=h.membership_id and m.organisation_id=h.organisation_id
    where c.organisation_id=p_organisation_id and c.user_id is not null
  ), active_customers as materialized (
    select c.id,c.display_name,c.email,c.user_id,
      lower(btrim(coalesce(c.email,''))) normalized_email
    from active_customer_ids a join public.club_customers c on c.id=a.customer_id
    where c.organisation_id=p_organisation_id
  ), customer_email_counts as materialized (
    select lower(btrim(coalesce(c.email,''))) email,count(*)::integer row_count
    from public.club_customers c where c.organisation_id=p_organisation_id
    group by lower(btrim(coalesce(c.email,'')))
  ), import_email_counts as materialized (
    select lower(btrim(coalesce(r.normalized_values->>'email',''))) email,count(*)::integer row_count
    from public.club_member_import_rows r where r.organisation_id=p_organisation_id
      and nullif(btrim(r.normalized_values->>'email'),'') is not null
    group by lower(btrim(coalesce(r.normalized_values->>'email','')))
  ), household_customers as materialized (
    select distinct i.customer_id
    from public.club_member_import_identities i
    join public.club_member_import_rows r on r.organisation_id=i.organisation_id
      and r.normalized_values->>'legacyReference'=i.source_member_reference
    join public.club_member_import_batches b on b.id=r.batch_id and b.organisation_id=r.organisation_id
    where i.organisation_id=p_organisation_id and i.source_system='clubmanager'
      and nullif(btrim(coalesce(r.raw_values->>(b.mapping->>'householdReference'),
        r.raw_values->>'shared_contract_id',r.raw_values->>'household_reference')),'') is not null
  ), auth_email_conflicts as materialized (
    -- Auth emails are unique in Supabase. bool_or keeps the result fail-safe if
    -- legacy data nevertheless contains multiple normalized matches.
    select lower(btrim(coalesce(u.email,''))) email,
      bool_or(exists(select 1 from public.club_customers linked
        where linked.organisation_id=p_organisation_id and linked.user_id=u.id)) has_linked_customer
    from auth.users u
    where lower(btrim(coalesce(u.email,''))) in (select normalized_email from active_customers where normalized_email<>'')
    group by lower(btrim(coalesce(u.email,'')))
  ), latest_invites as materialized (
    select distinct on (i.customer_id) i.customer_id,i.id,i.status,i.expires_at
    from public.club_madhouse_member_activation_invitations i
    where i.organisation_id=p_organisation_id
    order by i.customer_id,i.created_at desc,i.id desc
  ), classified as materialized (
    select c.*,
      case
        when c.user_id is not null then 'already_linked'
        when c.normalized_email='' then 'missing_email'
        when c.normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'invalid_email'
        when split_part(c.normalized_email,'@',2) in ('example.com','example.net','example.org','invalid','localhost')
          or split_part(c.normalized_email,'@',1) in ('admin','family','info','membership','noreply','no-reply','shared','test','unknown','placeholder')
          or split_part(c.normalized_email,'@',1) like '%placeholder%' then 'shared_or_placeholder'
        when coalesce(cc.row_count,0)>1 or coalesce(ic.row_count,0)>1 or hc.customer_id is not null then 'shared_or_ambiguous_email'
        when coalesce(aec.has_linked_customer,false) then 'account_link_conflict'
        else 'eligible'
      end eligibility,
      i.id invite_id,i.status invite_status,i.expires_at invite_expires_at
    from active_customers c
    left join customer_email_counts cc on cc.email=c.normalized_email
    left join import_email_counts ic on ic.email=c.normalized_email
    left join household_customers hc on hc.customer_id=c.id
    left join auth_email_conflicts aec on aec.email=c.normalized_email
    left join latest_invites i on i.customer_id=c.id
  ), presented as materialized (
    select id, id customer_id,display_name,
      case when nullif(split_part(coalesce(email,''),'@',1),'') is null then 'Email unavailable'
        when split_part(email,'@',2)='' then 'Invalid email address'
        else left(split_part(email,'@',1),1)||'••••@'||split_part(email,'@',2) end masked_email,
      eligibility,
      case when invite_status='redeemed' then 'completed'
        when user_id is not null then 'already_linked'
        when invite_status in ('queued','sent') and invite_expires_at<=now() then 'expired'
        when invite_status in ('queued','sent') then invite_status
        when invite_status='failed' then 'failed'
        when invite_status='exception' then 'exception'
        when invite_status='revoked' then 'revoked'
        else eligibility end state,
      invite_id,invite_expires_at,
      (eligibility='eligible' and (invite_status is null or invite_status in ('failed','expired','revoked')
        or (invite_status in ('queued','sent') and invite_expires_at<=now()))) sendable
    from classified
  )
  select coalesce((select jsonb_agg(to_jsonb(p) order by lower(p.display_name)) from presented p),'[]'::jsonb),
    coalesce((select jsonb_object_agg(q.state,q.row_count) from
      (select p.state,count(*)::integer row_count from presented p group by p.state) q),'{}'::jsonb),
    (select count(*)::integer from presented p where p.sendable)
  into v_rows,v_counts,v_eligible;

  return jsonb_build_object('members',v_rows,'counts',v_counts,'eligible_count',coalesce(v_eligible,0));
end; $$;
revoke all on function public.club_preview_madhouse_member_activation_invitations(uuid) from public,anon;
grant execute on function public.club_preview_madhouse_member_activation_invitations(uuid) to authenticated;

commit;
