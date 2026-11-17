-- Controlled historical membership review. This migration adds read projections
-- and review annotations only; it never creates memberships, entitlements,
-- accounts, invitations, billing arrangements or payment activity.
begin;

do $$
declare t text;
begin
  foreach t in array array[
    'club_organisations',
    'club_member_import_batches','club_member_import_rows','club_member_import_package_mappings',
    'club_member_import_identities','club_customers','club_memberships','club_membership_holders',
    'club_products','club_locations','club_membership_shared_contracts','club_members','club_audit_events'
  ] loop
    if to_regclass('public.'||t) is null then
      raise exception 'Required membership-review table public.% is missing; migration made no changes',t;
    end if;
  end loop;
  if to_regprocedure('public.club_capability_allowed(uuid,uuid,text)') is null then
    raise exception 'Membership-review capability function is missing; migration made no changes';
  end if;
  if exists(select 1 from (values
      ('club_member_import_rows','id'),('club_member_import_rows','organisation_id'),('club_member_import_rows','batch_id'),
      ('club_member_import_rows','source_row_number'),('club_member_import_rows','raw_values'),('club_member_import_rows','normalized_values'),
      ('club_member_import_rows','imported_customer_id'),('club_member_import_rows','imported_membership_id'),('club_member_import_rows','updated_at'),
      ('club_member_import_batches','id'),('club_member_import_batches','organisation_id'),('club_member_import_batches','status'),
      ('club_member_import_package_mappings','batch_id'),('club_member_import_package_mappings','organisation_id'),
      ('club_member_import_package_mappings','source_package'),('club_member_import_package_mappings','club_product_id'),('club_member_import_package_mappings','status'),
      ('club_member_import_identities','organisation_id'),('club_member_import_identities','source_system'),
      ('club_member_import_identities','source_member_reference'),('club_member_import_identities','customer_id'),
      ('club_customers','id'),('club_customers','organisation_id'),('club_customers','display_name'),('club_customers','email'),
      ('club_customers','phone'),('club_customers','user_id'),('club_customers','preferred_location_id'),('club_customers','created_at'),
      ('club_memberships','id'),('club_memberships','organisation_id'),('club_memberships','product_id'),
      ('club_memberships','status'),('club_memberships','starts_at'),('club_memberships','ends_at'),('club_memberships','created_at'),
      ('club_membership_holders','membership_id'),('club_membership_holders','organisation_id'),
      ('club_membership_holders','user_id'),('club_membership_holders','customer_id'),
      ('club_products','id'),('club_products','organisation_id'),('club_products','name'),('club_products','kind'),
      ('club_locations','id'),('club_locations','organisation_id'),('club_locations','name'),('club_locations','active'),
      ('club_members','organisation_id'),('club_members','user_id'),('club_members','role'),('club_members','active'),
      ('club_membership_shared_contracts','membership_id'),('club_membership_shared_contracts','organisation_id'),
      ('club_membership_shared_contracts','arrangement_kind'),('club_membership_shared_contracts','responsible_payer_customer_id'),
      ('club_membership_shared_contracts','provider_reconciliation_state'),('club_membership_shared_contracts','agreed_amount_minor'),
      ('club_membership_shared_contracts','currency'),('club_membership_shared_contracts','frequency'),
      ('club_membership_shared_contracts','billing_state'),('club_membership_shared_contracts','paid_through_date'),
      ('club_membership_shared_contracts','created_at'),
      ('club_audit_events','organisation_id'),('club_audit_events','actor_user_id'),('club_audit_events','actor_role'),
      ('club_audit_events','action'),('club_audit_events','target_type'),('club_audit_events','target_id'),
      ('club_audit_events','reason'),('club_audit_events','metadata')
    ) required(table_name,column_name)
    where not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=required.table_name and c.column_name=required.column_name)) then
    raise exception 'Membership-review schema prerequisites do not match; migration made no changes';
  end if;
end $$;

-- A row is an administrative reconciliation note. It is deliberately not a
-- membership, billing, entitlement or identity-link operation.
create unique index if not exists club_member_import_rows_id_organisation_uq
  on public.club_member_import_rows(id,organisation_id);
create table if not exists public.club_legacy_membership_review (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  import_row_id uuid not null,
  customer_id uuid not null,
  canonical_product_id uuid,
  home_location_id uuid,
  person_identity_state text not null default 'needs_review'
    check(person_identity_state in ('needs_review','verified','mismatch')),
  billing_evidence_state text not null default 'not_reviewed'
    check(billing_evidence_state in ('not_reviewed','verified','no_evidence','mismatch')),
  joining_fee_waived boolean,
  promotional_rate_minor integer check(promotional_rate_minor is null or promotional_rate_minor>=0),
  promotion_label text check(promotion_label is null or char_length(promotion_label)<=200),
  billing_interval text check(billing_interval is null or billing_interval in ('weekly','fortnightly','four_weekly','monthly','quarterly','annual','one_off','lifetime','other')),
  historic_package_wording text check(historic_package_wording is null or char_length(historic_package_wording)<=500),
  verified_recurring_amount_minor integer check(verified_recurring_amount_minor is null or verified_recurring_amount_minor>=0),
  household_reference text check(household_reference is null or char_length(household_reference)<=200),
  responsible_payer_reference text check(responsible_payer_reference is null or char_length(responsible_payer_reference)<=200),
  responsible_payer_customer_id uuid,
  source_membership_reference text,
  evidence_note text check(evidence_note is null or char_length(evidence_note)<=1000),
  review_state text not null default 'pending_review' check(review_state in ('pending_review','reviewed','rejected')),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organisation_id,import_row_id),
  foreign key(import_row_id,organisation_id) references public.club_member_import_rows(id,organisation_id) on delete restrict,
  foreign key(customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete restrict,
  foreign key(responsible_payer_customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete restrict,
  foreign key(canonical_product_id,organisation_id) references public.club_products(id,organisation_id) on delete restrict,
  foreign key(home_location_id,organisation_id) references public.club_locations(id,organisation_id) on delete restrict,
  check((review_state='pending_review' and reviewed_by is null and reviewed_at is null) or
        (review_state in ('reviewed','rejected') and reviewed_by is not null and reviewed_at is not null))
);
create index if not exists club_legacy_membership_review_status_idx
  on public.club_legacy_membership_review(organisation_id,review_state,updated_at desc);
alter table public.club_legacy_membership_review enable row level security;
revoke all on public.club_legacy_membership_review from public,anon,authenticated;

-- The existing directory RPC was intentionally membership-only. Include
-- imported customer profiles without membership rows as Pending Review, while
-- never creating a Club role or access entitlement for them.
create or replace function public.club_list_unlinked_membership_customers(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.view') then
    raise exception 'Member directory is not permitted' using errcode='42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',c.id,'user_id',c.user_id,'display_name',c.display_name,'email',c.email,'phone',c.phone,
      'membership_name',coalesce(history.product_name,source_offer.offer_name),
      'membership_status',history.status,
      'membership_ends_at',history.ends_at,
      'directory_status',case
        when history.status='active' and history.starts_at<=now() and (history.ends_at is null or history.ends_at>now()) then 'active'
        when history.status in ('expired','lapsed') or (history.ends_at is not null and history.ends_at<=now()) then 'lapsed'
        when history.status in ('cancelled','ended','former','inactive') then 'former'
        when history.status is null or history.status='pending' then 'pending_review'
        else history.status end,
      'home_location',case when loc.id is null then null else jsonb_build_object('id',loc.id,'name',loc.name) end,
      'source_membership_reference',source_offer.legacy_reference,
      'review_state',coalesce(review.review_state,'pending_review')
    ) order by c.display_name,c.created_at)
    from public.club_customers c
    left join public.club_locations loc on loc.id=c.preferred_location_id and loc.organisation_id=c.organisation_id
    left join lateral (
      select p.name product_name,m.status,m.starts_at,m.ends_at
      from public.club_membership_holders h
      join public.club_memberships m on m.id=h.membership_id and m.organisation_id=h.organisation_id
      join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id
      where h.organisation_id=p_organisation_id and (h.customer_id=c.id or (c.user_id is not null and h.user_id=c.user_id))
      order by case m.status when 'active' then 0 when 'pending' then 1 when 'paused' then 2 when 'suspended' then 2 when 'expired' then 3 when 'cancelled' then 4 else 5 end,m.starts_at desc,m.created_at desc
      limit 1
    ) history on true
    left join lateral (
      select r.id import_row_id,nullif(btrim(coalesce(r.normalized_values->>'membershipName',r.raw_values->>'membership_type',r.raw_values->>'membership',r.raw_values->>'package')),'') offer_name,
        nullif(btrim(coalesce(r.normalized_values->>'legacyReference',r.raw_values->>'legacy_member_reference',r.raw_values->>'member_number',r.raw_values->>'member_id',r.raw_values->>'member id')),'') legacy_reference
      from public.club_member_import_rows r
      where r.organisation_id=c.organisation_id and r.imported_customer_id=c.id
      order by r.updated_at desc limit 1
    ) source_offer on true
    left join public.club_legacy_membership_review review on review.organisation_id=c.organisation_id and review.import_row_id=source_offer.import_row_id
    where c.organisation_id=p_organisation_id
      and (source_offer.import_row_id is not null or history.status is not null)
      and not exists(
      select 1 from public.club_members m
      where m.organisation_id=c.organisation_id and m.user_id=c.user_id
        and exists(select 1 from public.club_memberships member_row
          join public.club_membership_holders holder on holder.membership_id=member_row.id and holder.organisation_id=member_row.organisation_id
          where member_row.organisation_id=m.organisation_id and (holder.user_id=m.user_id or holder.customer_id=c.id))
    )
  ),'[]'::jsonb);
end $$;
revoke all on function public.club_list_unlinked_membership_customers(uuid) from public,anon,authenticated;
grant execute on function public.club_list_unlinked_membership_customers(uuid) to authenticated;

-- Narrow read projection: the underlying shared-contract table remains
-- inaccessible to client roles. Sensitive negotiated values are omitted unless
-- the caller has the dedicated pricing capability.
create or replace function public.club_list_family_contracts_secure(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare can_see_price boolean;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.manage') then
    raise exception 'Membership administration is not permitted' using errcode='42501';
  end if;
  can_see_price:=public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.pricing_sensitive');
  return coalesce((select jsonb_agg(
    jsonb_build_object('membership_id',c.membership_id,'arrangement_kind',c.arrangement_kind,
      'provider_reconciliation_state',c.provider_reconciliation_state,'responsible_payer_name',payer.display_name,
      'agreed_amount_minor',case when can_see_price then c.agreed_amount_minor else null end,
      'currency',case when can_see_price then c.currency else null end,
      'frequency',case when can_see_price then c.frequency else null end,
      'billing_state',case when can_see_price then c.billing_state else null end,
      'paid_through_date',case when can_see_price then c.paid_through_date else null end)
    order by payer.display_name,c.created_at)
    from public.club_membership_shared_contracts c
    join public.club_customers payer on payer.id=c.responsible_payer_customer_id and payer.organisation_id=c.organisation_id
    where c.organisation_id=p_organisation_id and c.arrangement_kind in ('family','couple')),'[]'::jsonb);
end $$;
revoke all on function public.club_list_family_contracts_secure(uuid) from public,anon,authenticated;
grant execute on function public.club_list_family_contracts_secure(uuid) to authenticated;

-- Import-authorised managers can inspect source offer evidence and record a
-- review-only canonical product mapping. It deliberately does not update the
-- live importer mapping table, reconcile memberships, or affect future imports.
create or replace function public.club_list_legacy_membership_review(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then
    raise exception 'Legacy membership review is not permitted' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'import_row_id',r.id,'batch_id',r.batch_id,'customer_id',r.imported_customer_id,'existing_membership_id',r.imported_membership_id,
    'existing_membership_product_id',existing_membership.product_id,'existing_membership_name',existing_product.name,'existing_membership_status',existing_membership.status,
    'display_name',c.display_name,'source_member_reference',coalesce(r.normalized_values->>'legacyReference',r.raw_values->>'legacy_member_reference',r.raw_values->>'member_number',r.raw_values->>'member_id'),
    'original_offer_name',coalesce(r.normalized_values->>'membershipName',r.raw_values->>'membership_type',r.raw_values->>'membership',r.raw_values->>'package'),
    'original_start_date',coalesce(r.normalized_values->>'startDate',r.raw_values->>'start_date',r.raw_values->>'join_date'),
    'original_end_date',coalesce(r.normalized_values->>'endDate',r.raw_values->>'end_date',r.raw_values->>'expiry_date'),
    'original_home_venue',coalesce(r.normalized_values->>'homeLocation',r.raw_values->>'home_gym',r.raw_values->>'home_location'),
    'original_billing_label',coalesce(r.normalized_values->>'billingMethod',r.raw_values->>'payment_method',r.raw_values->>'billing_method'),
    'original_recurring_amount',coalesce(r.normalized_values->>'billingAmount',r.raw_values->>'recurring_amount'),
    'original_joining_fee_waived',coalesce(r.normalized_values->>'joiningFeeWaived',r.raw_values->>'joining_fee_waived'),
    'original_promotion_label',coalesce(r.normalized_values->>'promotionLabel',r.raw_values->>'promotion',r.raw_values->>'promotion_label'),
    'original_billing_interval',coalesce(r.normalized_values->>'billingInterval',r.raw_values->>'billing_interval',r.raw_values->>'frequency'),
    'original_responsible_payer_reference',coalesce(r.normalized_values->>'responsiblePayerReference',r.raw_values->>'responsible_payer_member_id',r.raw_values->>'payer_member_id'),
    'original_household_reference',coalesce(r.normalized_values->>'householdReference',r.raw_values->>'shared_contract_id',r.raw_values->>'household_reference'),
    'original_promotional_rate',coalesce(r.normalized_values->>'promotionalRate',r.raw_values->>'promotional_rate',r.raw_values->>'promo_rate'),
    'original_package_wording',coalesce(r.normalized_values->>'historicPackageWording',r.raw_values->>'package_wording',r.raw_values->>'membership_description'),
    'mapping_product_id',pm.club_product_id,'mapping_status',pm.status,
    'review',case when rev.id is null then null else jsonb_build_object('id',rev.id,'canonical_product_id',rev.canonical_product_id,'home_location_id',rev.home_location_id,'person_identity_state',rev.person_identity_state,'billing_evidence_state',rev.billing_evidence_state,'joining_fee_waived',rev.joining_fee_waived,'promotional_rate_minor',rev.promotional_rate_minor,'promotion_label',rev.promotion_label,'billing_interval',rev.billing_interval,'historic_package_wording',rev.historic_package_wording,'verified_recurring_amount_minor',rev.verified_recurring_amount_minor,'source_membership_reference',rev.source_membership_reference,'household_reference',rev.household_reference,'responsible_payer_reference',rev.responsible_payer_reference,'responsible_payer_customer_id',rev.responsible_payer_customer_id,'evidence_note',rev.evidence_note,'review_state',rev.review_state)
  ) order by r.source_row_number)
  from public.club_member_import_rows r
  join public.club_member_import_batches b on b.id=r.batch_id and b.organisation_id=r.organisation_id
  join public.club_customers c on c.id=r.imported_customer_id and c.organisation_id=r.organisation_id
  left join public.club_memberships existing_membership on existing_membership.id=r.imported_membership_id and existing_membership.organisation_id=r.organisation_id
  left join public.club_products existing_product on existing_product.id=existing_membership.product_id and existing_product.organisation_id=existing_membership.organisation_id
  left join public.club_member_import_package_mappings pm on pm.batch_id=r.batch_id and pm.organisation_id=r.organisation_id and lower(pm.source_package)=lower(coalesce(r.normalized_values->>'membershipName',r.raw_values->>'membership_type',r.raw_values->>'membership',r.raw_values->>'package'))
  left join public.club_legacy_membership_review rev on rev.import_row_id=r.id and rev.organisation_id=r.organisation_id
  where r.organisation_id=p_organisation_id and b.status='completed' and r.imported_customer_id is not null),'[]'::jsonb);
end $$;

create or replace function public.club_save_legacy_membership_review(p_organisation_id uuid,p_import_row_id uuid,p_decision jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_member_import_rows%rowtype; v_customer uuid; v_product uuid; v_location uuid; v_payer_ref text; v_payer uuid; v_household_ref text; v_identity text; v_billing text; v_note text; v_source_ref text; v_review_ref text; actor_role text; saved public.club_legacy_membership_review%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then raise exception 'Legacy membership review is not permitted' using errcode='42501'; end if;
  if jsonb_typeof(p_decision)<>'object' then raise exception 'Review decision must be an object' using errcode='22023'; end if;
  select * into r from public.club_member_import_rows where id=p_import_row_id and organisation_id=p_organisation_id for update;
  if not found or r.imported_customer_id is null then raise exception 'Imported source row not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.club_member_import_batches b where b.id=r.batch_id and b.organisation_id=p_organisation_id and b.status='completed') then
    raise exception 'Only completed historical imports can be reviewed' using errcode='22023';
  end if;
  v_customer:=nullif(p_decision->>'customerId','')::uuid;
  if v_customer is distinct from r.imported_customer_id then raise exception 'Review cannot link or merge a different customer profile' using errcode='42501'; end if;
  v_product:=nullif(p_decision->>'canonicalProductId','')::uuid;
  if v_product is not null and not exists(select 1 from public.club_products where id=v_product and organisation_id=p_organisation_id and kind='membership') then raise exception 'Canonical membership product is outside this organisation or is not a membership' using errcode='42501'; end if;
  v_location:=nullif(p_decision->>'homeLocationId','')::uuid;
  if v_location is not null and not exists(select 1 from public.club_locations where id=v_location and organisation_id=p_organisation_id) then raise exception 'Home venue is outside this organisation' using errcode='42501'; end if;
  v_payer_ref:=nullif(btrim(p_decision->>'responsiblePayerReference'),'');
  v_household_ref:=nullif(btrim(p_decision->>'householdReference'),'');
  if v_payer_ref is not null then
    select customer_id into v_payer from public.club_member_import_identities where organisation_id=p_organisation_id and source_system='clubmanager' and source_member_reference=v_payer_ref;
    if v_payer is null then raise exception 'Responsible payer source identity is not mapped within this organisation' using errcode='22023'; end if;
  end if;
  if v_household_ref is not null and v_payer is null then raise exception 'A shared family/couple review requires one mapped responsible payer reference' using errcode='22023'; end if;
  if v_payer is not null and not exists(
    select 1 from public.club_member_import_rows payer_row
    where payer_row.organisation_id=p_organisation_id and payer_row.imported_customer_id=v_payer
      and coalesce(payer_row.normalized_values->>'householdReference',payer_row.raw_values->>'shared_contract_id',payer_row.raw_values->>'household_reference')=v_household_ref
  ) then raise exception 'Responsible payer source row does not belong to this verified household reference' using errcode='22023'; end if;
  v_identity:=coalesce(p_decision->>'personIdentityState','needs_review'); v_billing:=coalesce(p_decision->>'billingEvidenceState','not_reviewed');
  v_note:=nullif(btrim(p_decision->>'evidenceNote'),'');
  v_source_ref:=nullif(btrim(coalesce(r.normalized_values->>'legacyReference',r.raw_values->>'legacy_member_reference',r.raw_values->>'member_number',r.raw_values->>'member_id',r.raw_values->>'member id',r.raw_values->>'id')),'');
  v_review_ref:=nullif(btrim(p_decision->>'sourceMembershipReference'),'');
  if v_review_ref is not null and v_review_ref is distinct from v_source_ref and not exists(select 1 from public.club_member_import_identities where organisation_id=p_organisation_id and source_system='clubmanager' and source_member_reference=v_review_ref and customer_id=r.imported_customer_id) then raise exception 'Source reference does not map to this exact imported customer' using errcode='22023'; end if;
  if v_identity not in ('needs_review','verified','mismatch') or v_billing not in ('not_reviewed','verified','no_evidence','mismatch') then raise exception 'Invalid identity or billing evidence state' using errcode='22023'; end if;
  if (v_identity='verified' or v_billing='verified') and (v_note is null or char_length(v_note)<8) then raise exception 'Verified decisions require a meaningful evidence note' using errcode='22023'; end if;
  if length(coalesce(p_decision->>'promotionLabel',''))>200 or length(coalesce(p_decision->>'historicPackageWording',''))>500 or length(coalesce(v_household_ref,''))>200 or length(coalesce(p_decision->>'responsiblePayerReference',''))>200 then raise exception 'Legacy offer description is too long' using errcode='22023'; end if;
  if nullif(p_decision->>'verifiedRecurringAmountMinor','') is not null and (p_decision->>'verifiedRecurringAmountMinor')::bigint not between 0 and 2147483647 then raise exception 'Verified recurring amount is invalid' using errcode='22023'; end if;
  if nullif(p_decision->>'promotionalRateMinor','') is not null and (p_decision->>'promotionalRateMinor')::bigint not between 0 and 2147483647 then raise exception 'Promotional rate is invalid' using errcode='22023'; end if;
  if coalesce(p_decision->>'billingInterval','') not in ('','weekly','fortnightly','four_weekly','monthly','quarterly','annual','one_off','lifetime','other') then raise exception 'Billing interval is invalid' using errcode='22023'; end if;
  if v_identity='verified' and (coalesce(v_review_ref,v_source_ref) is null or not exists(select 1 from public.club_member_import_identities where organisation_id=p_organisation_id and source_system='clubmanager' and source_member_reference=coalesce(v_review_ref,v_source_ref) and customer_id=r.imported_customer_id)) then raise exception 'Identity verification requires the exact ClubManager reference already mapped to this profile' using errcode='22023'; end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  insert into public.club_legacy_membership_review(organisation_id,import_row_id,customer_id,canonical_product_id,home_location_id,person_identity_state,billing_evidence_state,joining_fee_waived,promotional_rate_minor,promotion_label,billing_interval,historic_package_wording,verified_recurring_amount_minor,source_membership_reference,household_reference,responsible_payer_reference,responsible_payer_customer_id,evidence_note,review_state,reviewed_by,reviewed_at,updated_at)
  values(p_organisation_id,r.id,r.imported_customer_id,v_product,v_location,v_identity,v_billing,nullif(p_decision->>'joiningFeeWaived','')::boolean,nullif(p_decision->>'promotionalRateMinor','')::integer,nullif(btrim(p_decision->>'promotionLabel'),''),nullif(p_decision->>'billingInterval',''),nullif(btrim(p_decision->>'historicPackageWording'),''),nullif(p_decision->>'verifiedRecurringAmountMinor','')::integer,nullif(btrim(p_decision->>'sourceMembershipReference'),''),nullif(btrim(p_decision->>'householdReference'),''),v_payer_ref,v_payer,v_note,'reviewed',auth.uid(),now(),now())
  on conflict(organisation_id,import_row_id) do update set canonical_product_id=excluded.canonical_product_id,home_location_id=excluded.home_location_id,person_identity_state=excluded.person_identity_state,billing_evidence_state=excluded.billing_evidence_state,joining_fee_waived=excluded.joining_fee_waived,promotional_rate_minor=excluded.promotional_rate_minor,promotion_label=excluded.promotion_label,billing_interval=excluded.billing_interval,historic_package_wording=excluded.historic_package_wording,verified_recurring_amount_minor=excluded.verified_recurring_amount_minor,source_membership_reference=excluded.source_membership_reference,household_reference=excluded.household_reference,responsible_payer_reference=excluded.responsible_payer_reference,responsible_payer_customer_id=excluded.responsible_payer_customer_id,evidence_note=excluded.evidence_note,review_state='reviewed',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
  returning * into saved;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,reason,metadata)
  values(p_organisation_id,auth.uid(),actor_role,'membership.legacy_review_recorded','member_import_row',r.id,coalesce(v_note,'Historical membership mapping recorded'),jsonb_build_object('customer_id',r.imported_customer_id,'canonical_product_id',v_product,'identity_state',v_identity,'billing_evidence_state',v_billing,'operational_effect','review_only_no_membership_no_billing_no_access'));
  return jsonb_build_object('id',saved.id,'review_state',saved.review_state,'canonical_product_id',saved.canonical_product_id,'updated_at',saved.updated_at);
end $$;

revoke all on function public.club_list_legacy_membership_review(uuid),public.club_save_legacy_membership_review(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.club_list_legacy_membership_review(uuid),public.club_save_legacy_membership_review(uuid,uuid,jsonb) to authenticated;

comment on table public.club_legacy_membership_review is 'Audited review-only mapping of historical ClubManager source rows; never creates membership, billing, identity links, or access.';
commit;
