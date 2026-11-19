-- Correct only the expired status introduced for blank-status ClubManager
-- imports. Product, dates, holders, payer links and billing records are retained.
-- Run the read-only verification script before this migration.
begin;

-- club_audit_events requires a human auth actor. A migration has no such
-- actor, so preserve its immutable before/after evidence in a dedicated
-- append-only table instead of inventing a staff identity.
create table if not exists public.club_import_membership_status_corrections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  batch_id uuid not null references public.club_member_import_batches(id) on delete restrict,
  import_row_id uuid not null,
  customer_id uuid not null,
  membership_id uuid not null,
  previous_status text not null,
  new_status text not null check(new_status='active'),
  product_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  migration_key text not null,
  corrected_at timestamptz not null default now(),
  executed_by text not null default current_user,
  authenticated_actor uuid references auth.users(id) on delete set null,
  unique(organisation_id,membership_id,migration_key),
  foreign key(import_row_id,organisation_id) references public.club_member_import_rows(id,organisation_id) on delete restrict,
  foreign key(customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete restrict,
  foreign key(membership_id,organisation_id) references public.club_memberships(id,organisation_id) on delete restrict,
  foreign key(product_id,organisation_id) references public.club_products(id,organisation_id) on delete restrict
);
alter table public.club_import_membership_status_corrections enable row level security;
revoke all on public.club_import_membership_status_corrections from public,anon,authenticated;

do $$
declare
  v_org uuid:='fa44592a-1593-4ad3-a621-63a4a4bcbceb';
  v_batch uuid:='6bf9d303-525a-4565-88a4-b4121fac7f98';
  v_batch_rows integer; v_memberships integer; v_candidates integer:=0; v_changed integer; v_grants integer; v_audit integer;
  r record;
begin
  if not exists(select 1 from public.club_organisations where id=v_org) then
    raise exception 'Madhouse organisation prerequisite failed; no membership was changed';
  end if;
  select count(*) into v_batch_rows from public.club_member_import_rows where organisation_id=v_org and batch_id=v_batch;
  select count(*) into v_memberships from public.club_memberships where organisation_id=v_org and import_batch_id=v_batch and source='legacy_import';
  if v_batch_rows<>702 or v_memberships<>477 then
    raise exception 'Import population preflight mismatch: rows %, memberships %; expected 702 and 477. No membership was changed',v_batch_rows,v_memberships;
  end if;

  -- Lock only in-scope memberships while classifying them. Candidate rules use
  -- the original import linkage, the mapped product entitlement and the
  -- importer's known blank-status provenance. Date validity alone never
  -- overrides a payment, suspension, cancellation, household or risk blocker.
  for r in
    select m.id from public.club_memberships m
    join public.club_member_import_rows ir on ir.id=m.import_row_id and ir.organisation_id=m.organisation_id
    join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id
    where m.organisation_id=v_org and m.import_batch_id=v_batch and m.source='legacy_import'
      and ir.batch_id=v_batch and ir.imported_membership_id=m.id and ir.imported_customer_id is not null
      and m.status='expired' and m.ended_at is null
      and m.migration_metadata->>'source_system'='clubmanager'
      and nullif(btrim(m.migration_metadata->>'source_status'),'') is null
      and p.legacy_import_category is null
      and m.starts_at<=now()
      and (p.is_lifetime or m.ends_at>now())
      and exists(select 1 from public.club_product_entitlements pe where pe.organisation_id=v_org and pe.product_id=p.id and pe.entitlement_key='gym_access')
      and not exists(select 1 from public.club_membership_payment_access_suspensions s where s.organisation_id=v_org and s.membership_id=m.id and s.active)
      and not exists(select 1 from public.club_membership_access_events ae where ae.organisation_id=v_org and ae.membership_id=m.id
        and ae.new_status='paused' and not exists(select 1 from public.club_membership_access_events later where later.organisation_id=ae.organisation_id and later.membership_id=ae.membership_id and later.created_at>ae.created_at and later.new_status='active'))
      and not exists(select 1 from public.club_membership_billing_obligations o where o.organisation_id=v_org and o.membership_id=m.id
        and o.state in ('due','payment_pending','failed','grace','retry_scheduled','overdue'))
      and not exists(select 1 from public.club_membership_billing_arrangements a where a.organisation_id=v_org and a.membership_id=m.id and a.state in ('cancelled','failed','suspended','action_required'))
      and not exists(select 1 from public.club_membership_counter_payments cp where cp.organisation_id=v_org and cp.membership_id=m.id and cp.state in ('pending_verification','rejected'))
      and not exists(select 1 from public.club_membership_shared_contracts sc where sc.organisation_id=v_org and sc.membership_id=m.id and (
        sc.provider_reconciliation_state in ('pending','mismatch')
        or lower(coalesce(sc.billing_state,'')) in ('unpaid','failed','overdue','cancelled','pending','suspended','action_required')
        or (sc.paid_through_date is not null and sc.paid_through_date<current_date)))
      and not exists(select 1 from public.club_audit_events ae where ae.organisation_id=v_org
        and ((ae.target_type='membership' and ae.target_id=m.id) or (ae.target_type='customer' and ae.target_id=ir.imported_customer_id))
        and (ae.action ilike '%fraud%' or ae.action ilike '%do_not_activate%' or ae.action ilike '%access_restrict%'))
    order by m.id for update of m
  loop
    v_candidates:=coalesce(v_candidates,0)+1;
  end loop;
  if v_candidates<0 or v_candidates>v_memberships then raise exception 'Candidate count assertion failed'; end if;

  insert into public.club_import_membership_status_corrections(
    organisation_id,batch_id,import_row_id,customer_id,membership_id,previous_status,new_status,
    product_id,starts_at,ends_at,migration_key,authenticated_actor)
  select v_org,v_batch,ir.id,ir.imported_customer_id,m.id,m.status,'active',m.product_id,m.starts_at,m.ends_at,
    '2027-02-10-madhouse-imported-membership-status-correction',auth.uid()
  from public.club_memberships m
  join public.club_member_import_rows ir on ir.id=m.import_row_id and ir.organisation_id=m.organisation_id
  join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id
  where m.organisation_id=v_org and m.import_batch_id=v_batch and m.source='legacy_import'
    and ir.batch_id=v_batch and ir.imported_membership_id=m.id and ir.imported_customer_id is not null
    and m.status='expired' and m.ended_at is null and m.migration_metadata->>'source_system'='clubmanager'
    and nullif(btrim(m.migration_metadata->>'source_status'),'') is null and p.legacy_import_category is null and m.starts_at<=now()
    and (p.is_lifetime or m.ends_at>now())
    and exists(select 1 from public.club_product_entitlements pe where pe.organisation_id=v_org and pe.product_id=p.id and pe.entitlement_key='gym_access')
    and not exists(select 1 from public.club_membership_payment_access_suspensions s where s.organisation_id=v_org and s.membership_id=m.id and s.active)
    and not exists(select 1 from public.club_membership_access_events ae where ae.organisation_id=v_org and ae.membership_id=m.id and ae.new_status='paused'
      and not exists(select 1 from public.club_membership_access_events later where later.organisation_id=ae.organisation_id and later.membership_id=ae.membership_id and later.created_at>ae.created_at and later.new_status='active'))
    and not exists(select 1 from public.club_membership_billing_obligations o where o.organisation_id=v_org and o.membership_id=m.id and o.state in ('due','payment_pending','failed','grace','retry_scheduled','overdue'))
    and not exists(select 1 from public.club_membership_billing_arrangements a where a.organisation_id=v_org and a.membership_id=m.id and a.state in ('cancelled','failed','suspended','action_required'))
    and not exists(select 1 from public.club_membership_counter_payments cp where cp.organisation_id=v_org and cp.membership_id=m.id and cp.state in ('pending_verification','rejected'))
    and not exists(select 1 from public.club_membership_shared_contracts sc where sc.organisation_id=v_org and sc.membership_id=m.id and (
      sc.provider_reconciliation_state in ('pending','mismatch') or lower(coalesce(sc.billing_state,'')) in ('unpaid','failed','overdue','cancelled','pending','suspended','action_required')
      or (sc.paid_through_date is not null and sc.paid_through_date<current_date)))
    and not exists(select 1 from public.club_audit_events ae where ae.organisation_id=v_org
      and ((ae.target_type='membership' and ae.target_id=m.id) or (ae.target_type='customer' and ae.target_id=ir.imported_customer_id))
      and (ae.action ilike '%fraud%' or ae.action ilike '%do_not_activate%' or ae.action ilike '%access_restrict%'))
  ;
  get diagnostics v_audit=row_count;
  if v_audit<>v_candidates then raise exception 'Audit count assertion failed: expected %, got %; transaction rolled back',v_candidates,v_audit; end if;

  update public.club_memberships m set status='active',updated_at=now()
  from public.club_member_import_rows ir, public.club_products p
  where m.organisation_id=v_org and m.import_batch_id=v_batch and m.source='legacy_import'
    and ir.id=m.import_row_id and ir.organisation_id=m.organisation_id and ir.batch_id=v_batch
    and ir.imported_membership_id=m.id and ir.imported_customer_id is not null
    and p.id=m.product_id and p.organisation_id=m.organisation_id and m.status='expired' and m.ended_at is null
    and m.migration_metadata->>'source_system'='clubmanager' and nullif(btrim(m.migration_metadata->>'source_status'),'') is null
    and p.legacy_import_category is null
    and m.starts_at<=now() and (p.is_lifetime or m.ends_at>now())
    and exists(select 1 from public.club_product_entitlements pe where pe.organisation_id=v_org and pe.product_id=p.id and pe.entitlement_key='gym_access')
    and not exists(select 1 from public.club_membership_payment_access_suspensions s where s.organisation_id=v_org and s.membership_id=m.id and s.active)
    and not exists(select 1 from public.club_membership_access_events ae where ae.organisation_id=v_org and ae.membership_id=m.id and ae.new_status='paused'
      and not exists(select 1 from public.club_membership_access_events later where later.organisation_id=ae.organisation_id and later.membership_id=ae.membership_id and later.created_at>ae.created_at and later.new_status='active'))
    and not exists(select 1 from public.club_membership_billing_obligations o where o.organisation_id=v_org and o.membership_id=m.id and o.state in ('due','payment_pending','failed','grace','retry_scheduled','overdue'))
    and not exists(select 1 from public.club_membership_billing_arrangements a where a.organisation_id=v_org and a.membership_id=m.id and a.state in ('cancelled','failed','suspended','action_required'))
    and not exists(select 1 from public.club_membership_counter_payments cp where cp.organisation_id=v_org and cp.membership_id=m.id and cp.state in ('pending_verification','rejected'))
    and not exists(select 1 from public.club_membership_shared_contracts sc where sc.organisation_id=v_org and sc.membership_id=m.id and (
      sc.provider_reconciliation_state in ('pending','mismatch') or lower(coalesce(sc.billing_state,'')) in ('unpaid','failed','overdue','cancelled','pending','suspended','action_required')
      or (sc.paid_through_date is not null and sc.paid_through_date<current_date)))
    and not exists(select 1 from public.club_audit_events ae where ae.organisation_id=v_org
      and ((ae.target_type='membership' and ae.target_id=m.id) or (ae.target_type='customer' and ae.target_id=ir.imported_customer_id))
      and (ae.action ilike '%fraud%' or ae.action ilike '%do_not_activate%' or ae.action ilike '%access_restrict%'));
  get diagnostics v_changed=row_count;
  if v_changed<>v_candidates then raise exception 'Membership correction count assertion failed: expected %, got %; transaction rolled back',v_candidates,v_changed; end if;

  -- The existing access projection requires a membership-bound grant for a
  -- linked account. Only verified Auth identities with an active Club identity
  -- receive grants. Unlinked or unverified imported profiles receive none.
  insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,
    allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
  select c.user_id,v_org,m.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,
    e.discount_percent,e.discount_period,e.discount_max_uses,m.starts_at,m.ends_at,'legacy_import'
  from public.club_memberships m
  join public.club_member_import_rows ir on ir.id=m.import_row_id and ir.organisation_id=m.organisation_id and ir.imported_membership_id=m.id
  join public.club_customers c on c.id=ir.imported_customer_id and c.organisation_id=v_org and c.user_id is not null
  join public.club_members cm on cm.organisation_id=v_org and cm.user_id=c.user_id and cm.active
  join auth.users u on u.id=c.user_id and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
  join public.club_product_entitlements e on e.product_id=m.product_id and e.organisation_id=v_org
  where m.organisation_id=v_org and m.import_batch_id=v_batch and m.status='active' and m.source='legacy_import'
    and m.migration_metadata->>'source_system'='clubmanager' and e.entitlement_key='gym_access'
    and exists(select 1 from public.club_import_membership_status_corrections corrected where corrected.organisation_id=v_org
      and corrected.batch_id=v_batch and corrected.membership_id=m.id
      and corrected.migration_key='2027-02-10-madhouse-imported-membership-status-correction')
    and not exists(select 1 from public.club_entitlement_grants existing where existing.user_id=c.user_id
      and existing.organisation_id=v_org and existing.membership_id=m.id and existing.entitlement_key='gym_access')
  on conflict do nothing;
  get diagnostics v_grants=row_count;
  raise notice 'Madhouse membership correction: % eligible status changes; % rows changed; % verified linked grants added. Review the preflight/postflight reports for lapsed, pending and manual-review totals.',v_candidates,v_changed,v_grants;
end $$;

commit;
