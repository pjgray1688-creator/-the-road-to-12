-- Authorised, append-only manual payment-grace extensions.
-- This does not collect, reschedule, retry, waive or mark any payment as paid.
begin;

alter table public.club_staff_permission_overrides drop constraint if exists club_staff_permission_overrides_capability_check;
alter table public.club_staff_permission_overrides add constraint club_staff_permission_overrides_capability_check check (capability in (
  'members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately',
  'payments.take','payments.record_cash','payments.extend_grace','refunds.issue','refunds.approve','cash.reconcile',
  'inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage',
  'induction.manage_policy','induction.perform','classes.manage','services.manage',
  'supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage',
  'commerce.collections_manage','finance.view','finance.manage','staff.work_submit','staff.work_review','finance.export'
));

create or replace function public.club_capabilities_for_role(p_role text)
returns text[] language sql immutable set search_path=pg_catalog,public as $$
  select case
    when p_role='owner' then array[
      'members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately',
      'payments.take','payments.record_cash','payments.extend_grace','refunds.issue','refunds.approve','cash.reconcile',
      'inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage',
      'induction.manage_policy','induction.perform','classes.manage','services.manage',
      'supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage',
      'commerce.collections_manage','finance.view','finance.manage','staff.work_submit','staff.work_review','finance.export'
    ]::text[]
    when p_role='gym_admin' then array[
      'members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately',
      'payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile',
      'inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage',
      'induction.manage_policy','induction.perform','classes.manage','services.manage',
      'supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage',
      'commerce.collections_manage','finance.view','finance.manage','staff.work_submit','staff.work_review','finance.export'
    ]::text[]
    when p_role in ('gym_staff','trainer') then array[
      'members.view','members.create','members.link_account','memberships.assign',
      'payments.take','payments.record_cash','refunds.issue','inventory.adjust','commerce.stock_remove',
      'induction.perform','classes.manage','services.manage','supplier.orders_manage','supplier.receive',
      'commerce.collections_manage','staff.work_submit'
    ]::text[]
    else '{}'::text[]
  end;
$$;

create or replace function public.club_capability_allowed(p_organisation_id uuid,p_user_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select auth.uid() is not null and p_user_id=auth.uid() and exists (
    select 1 from public.club_members m
    where m.organisation_id=p_organisation_id and m.user_id=p_user_id and m.active
      and m.role in ('owner','gym_admin','gym_staff','trainer')
      and (
        (m.role='owner' and p_capability='payments.extend_grace')
        or (
          not exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=p_user_id and o.capability=p_capability and o.decision='deny')
          and (
            p_capability=any(public.club_capabilities_for_role(m.role))
            or (p_capability<>'staff.permissions_manage' and exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=p_user_id and o.capability=p_capability and o.decision='allow'))
          )
        )
      )
  );
$$;

create table public.club_membership_payment_grace_extensions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  obligation_id uuid not null,
  membership_id uuid not null,
  sequence_number integer not null check(sequence_number>0),
  previous_grace_expires_at timestamptz not null,
  new_grace_expires_at timestamptz not null,
  agreed_payment_date date,
  reason text not null check(char_length(btrim(reason)) between 8 and 500),
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  covered_holders jsonb not null check(jsonb_typeof(covered_holders)='array' and jsonb_array_length(covered_holders)>0),
  idempotency_key text not null check(char_length(btrim(idempotency_key)) between 8 and 200),
  unique(organisation_id,idempotency_key),
  unique(obligation_id,sequence_number),
  foreign key(obligation_id,organisation_id) references public.club_membership_billing_obligations(id,organisation_id) on delete restrict,
  foreign key(membership_id,organisation_id) references public.club_memberships(id,organisation_id) on delete restrict,
  check(new_grace_expires_at>previous_grace_expires_at)
);
create index club_membership_payment_grace_extensions_obligation_idx on public.club_membership_payment_grace_extensions(obligation_id,sequence_number desc);

create table public.club_membership_payment_grace_extension_closures (
  extension_id uuid primary key references public.club_membership_payment_grace_extensions(id) on delete restrict,
  organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  obligation_id uuid not null,
  closure_reason text not null check(closure_reason='payment_recovered'),
  closed_at timestamptz not null default now(),
  foreign key(obligation_id,organisation_id) references public.club_membership_billing_obligations(id,organisation_id) on delete restrict
);

alter table public.club_membership_payment_grace_extensions enable row level security;
alter table public.club_membership_payment_grace_extension_closures enable row level security;
revoke all on public.club_membership_payment_grace_extensions,public.club_membership_payment_grace_extension_closures from public,anon,authenticated;

create or replace function public.club_guard_payment_grace_history_immutable() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  raise exception 'Payment grace history is immutable' using errcode='42501';
end $$;
create trigger club_guard_payment_grace_extensions_immutable before update or delete on public.club_membership_payment_grace_extensions for each row execute function public.club_guard_payment_grace_history_immutable();
create trigger club_guard_payment_grace_closures_immutable before update or delete on public.club_membership_payment_grace_extension_closures for each row execute function public.club_guard_payment_grace_history_immutable();

create or replace function public.club_close_recovered_payment_grace() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.state in ('paid','recovered') and old.state is distinct from new.state then
    insert into public.club_membership_payment_grace_extension_closures(extension_id,organisation_id,obligation_id,closure_reason,closed_at)
    select x.id,x.organisation_id,x.obligation_id,'payment_recovered',coalesce(new.last_paid_at,now())
    from public.club_membership_payment_grace_extensions x
    where x.obligation_id=new.id and x.organisation_id=new.organisation_id
    on conflict(extension_id) do nothing;
  end if;
  return new;
end $$;
create trigger club_close_recovered_payment_grace after update of state on public.club_membership_billing_obligations for each row execute function public.club_close_recovered_payment_grace();

create or replace function public.club_get_payment_grace_extension_context(p_organisation_id uuid,p_obligation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare o public.club_membership_billing_obligations%rowtype; original_expiry timestamptz; current_expiry timestamptz;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.extend_grace') then raise exception 'Payment grace access is not permitted' using errcode='42501'; end if;
  select * into o from public.club_membership_billing_obligations where id=p_obligation_id and organisation_id=p_organisation_id;
  if not found then raise exception 'Billing obligation not found' using errcode='P0002'; end if;
  original_expiry:=coalesce(o.grace_expires_at,public.club_membership_grace_expires_at(p_organisation_id,o.payment_method_family,coalesce(o.grace_started_at,o.next_due_at)));
  select greatest(original_expiry,coalesce(max(x.new_grace_expires_at),original_expiry)) into current_expiry from public.club_membership_payment_grace_extensions x where x.obligation_id=o.id;
  return jsonb_build_object(
    'obligationId',o.id,'membershipId',o.membership_id,'state',o.state,
    'eligible',o.state in ('failed','grace','retry_scheduled','overdue') and not exists(select 1 from public.club_membership_shared_contracts contract where contract.organisation_id=o.organisation_id and contract.membership_id=o.membership_id and contract.imported and contract.provider_reconciliation_state='pending'),
    'amountMinor',o.amount_minor,'currency',o.currency,'originalDueAt',o.next_due_at,
    'originalGraceExpiresAt',original_expiry,'currentGraceExpiresAt',current_expiry,
    'extensionCount',(select count(*) from public.club_membership_payment_grace_extensions x where x.obligation_id=o.id),
    'suspended',exists(select 1 from public.club_membership_payment_access_suspensions s where s.obligation_id=o.id and s.active),
    'coveredHolders',coalesce((select jsonb_agg(jsonb_build_object('customerId',c.id,'userId',h.user_id,'displayName',coalesce(nullif(btrim(c.display_name),''),nullif(btrim(p.display_name),''),'Member')) order by coalesce(c.display_name,p.display_name,'Member'))
      from public.club_membership_holders h
      left join lateral (select customer.* from public.club_customers customer where customer.organisation_id=h.organisation_id and (customer.id=h.customer_id or customer.user_id=h.user_id) order by (customer.id=h.customer_id) desc limit 1) c on true
      left join public.profiles p on p.id=h.user_id
      where h.organisation_id=o.organisation_id and h.membership_id=o.membership_id),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(jsonb_build_object(
      'id',x.id,'sequence',x.sequence_number,'previousGraceExpiresAt',x.previous_grace_expires_at,
      'newGraceExpiresAt',x.new_grace_expires_at,'agreedPaymentDate',x.agreed_payment_date,
      'reason',x.reason,'approvedAt',x.approved_at,'approvedByName',coalesce(nullif(btrim(p.display_name),''),'Authorised staff'),
      'coveredHolders',x.covered_holders,'closedAt',closure.closed_at
    ) order by x.sequence_number desc) from public.club_membership_payment_grace_extensions x
      left join public.profiles p on p.id=x.approved_by
      left join public.club_membership_payment_grace_extension_closures closure on closure.extension_id=x.id
      where x.obligation_id=o.id),'[]'::jsonb)
  );
end $$;

create or replace function public.club_extend_membership_payment_grace(p_organisation_id uuid,p_obligation_id uuid,p_new_grace_expires_at timestamptz,p_agreed_payment_date date,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_membership_billing_obligations%rowtype; existing public.club_membership_payment_grace_extensions%rowtype;
  original_expiry timestamptz; current_expiry timestamptz; next_sequence integer; holders jsonb; created public.club_membership_payment_grace_extensions%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.extend_grace') then raise exception 'Payment grace extension is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_idempotency_key),'') is null or nullif(btrim(p_reason),'') is null then raise exception 'Extension reason and idempotency key are required' using errcode='22023'; end if;
  select * into existing from public.club_membership_payment_grace_extensions where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key;
  if found then
    if existing.obligation_id<>p_obligation_id or existing.new_grace_expires_at<>p_new_grace_expires_at or existing.agreed_payment_date is distinct from p_agreed_payment_date or existing.reason<>btrim(p_reason) then raise exception 'Idempotency key already represents another extension' using errcode='23505'; end if;
    return public.club_get_payment_grace_extension_context(p_organisation_id,p_obligation_id);
  end if;
  select * into o from public.club_membership_billing_obligations where id=p_obligation_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Billing obligation not found' using errcode='P0002'; end if;
  if o.state not in ('failed','grace','retry_scheduled','overdue') then raise exception 'Only a failed or overdue unpaid obligation is eligible' using errcode='22023'; end if;
  if exists(select 1 from public.club_membership_shared_contracts contract where contract.organisation_id=o.organisation_id and contract.membership_id=o.membership_id and contract.imported and contract.provider_reconciliation_state='pending') then raise exception 'Imported payment reconciliation must be completed before extending grace' using errcode='22023'; end if;
  if p_new_grace_expires_at is null or not isfinite(p_new_grace_expires_at) or p_new_grace_expires_at<=now() then raise exception 'New grace expiry must be a finite future time' using errcode='22023'; end if;
  if char_length(btrim(p_reason)) not between 8 and 500 then raise exception 'Extension reason must be between 8 and 500 characters' using errcode='22023'; end if;
  original_expiry:=coalesce(o.grace_expires_at,public.club_membership_grace_expires_at(p_organisation_id,o.payment_method_family,coalesce(o.grace_started_at,o.next_due_at)));
  select greatest(original_expiry,coalesce(max(x.new_grace_expires_at),original_expiry)),coalesce(max(x.sequence_number),0)+1 into current_expiry,next_sequence from public.club_membership_payment_grace_extensions x where x.obligation_id=o.id;
  if p_new_grace_expires_at<=current_expiry then raise exception 'New grace expiry must be later than the current grace expiry' using errcode='22023'; end if;
  if p_agreed_payment_date is not null and (p_agreed_payment_date<(now() at time zone 'Europe/London')::date or p_agreed_payment_date>(p_new_grace_expires_at at time zone 'Europe/London')::date) then raise exception 'Agreed payment date must be current, future and no later than the grace expiry' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('customerId',c.id,'userId',h.user_id,'displayName',coalesce(nullif(btrim(c.display_name),''),nullif(btrim(p.display_name),''),'Member')) order by coalesce(c.display_name,p.display_name,'Member')),'[]'::jsonb) into holders
  from public.club_membership_holders h
  left join lateral (select customer.* from public.club_customers customer where customer.organisation_id=h.organisation_id and (customer.id=h.customer_id or customer.user_id=h.user_id) order by (customer.id=h.customer_id) desc limit 1) c on true
  left join public.profiles p on p.id=h.user_id where h.organisation_id=o.organisation_id and h.membership_id=o.membership_id;
  insert into public.club_membership_payment_grace_extensions(organisation_id,obligation_id,membership_id,sequence_number,previous_grace_expires_at,new_grace_expires_at,agreed_payment_date,reason,approved_by,covered_holders,idempotency_key)
  values(p_organisation_id,o.id,o.membership_id,next_sequence,current_expiry,p_new_grace_expires_at,p_agreed_payment_date,btrim(p_reason),auth.uid(),holders,btrim(p_idempotency_key)) returning * into created;
  update public.club_membership_payment_access_suspensions set active=false,cleared_at=coalesce(cleared_at,now()) where obligation_id=o.id and organisation_id=p_organisation_id and active;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,reason,metadata)
  select p_organisation_id,auth.uid(),m.role,'membership.payment_grace_extended','billing_obligation',o.id,btrim(p_reason),jsonb_build_object(
    'extension_id',created.id,'sequence',created.sequence_number,'membership_id',o.membership_id,'amount_minor',o.amount_minor,'currency',o.currency,
    'original_due_at',o.next_due_at,'previous_grace_expires_at',current_expiry,'new_grace_expires_at',p_new_grace_expires_at,
    'agreed_payment_date',p_agreed_payment_date,'covered_holders',holders,'covered_holder_count',jsonb_array_length(holders)
  ) from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active;
  return public.club_get_payment_grace_extension_context(p_organisation_id,p_obligation_id);
end $$;

create or replace function public.club_evaluate_membership_billing(p_organisation_id uuid,p_as_of timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare policy public.club_membership_billing_policies%rowtype; o public.club_membership_billing_obligations%rowtype; changed integer:=0; expiry timestamptz; extension_expiry timestamptz; stage text; key text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then raise exception 'Billing evaluation is not permitted' using errcode='42501'; end if;
  select * into policy from public.club_membership_billing_policies where organisation_id=p_organisation_id;
  for o in select obligation.* from public.club_membership_billing_obligations obligation
    left join public.club_membership_shared_contracts contract on contract.membership_id=obligation.membership_id and contract.organisation_id=obligation.organisation_id
    where obligation.organisation_id=p_organisation_id and obligation.state not in ('paid','recovered','cancelled','waived')
      and not (coalesce(contract.imported,false) and contract.provider_reconciliation_state='pending') for update of obligation loop
    if o.next_due_at<=p_as_of and o.state='upcoming' then update public.club_membership_billing_obligations set state='due',updated_at=now() where id=o.id; changed:=changed+1; end if;
    if o.next_due_at<=p_as_of and o.state in ('due','payment_pending','failed') then
      expiry:=coalesce(o.grace_expires_at,public.club_membership_grace_expires_at(p_organisation_id,o.payment_method_family,coalesce(o.grace_started_at,o.next_due_at)));
      update public.club_membership_billing_obligations set state='grace',grace_started_at=coalesce(grace_started_at,o.next_due_at),grace_expires_at=expiry,updated_at=now() where id=o.id;
    else expiry:=o.grace_expires_at; end if;
    select max(x.new_grace_expires_at) into extension_expiry from public.club_membership_payment_grace_extensions x where x.obligation_id=o.id;
    expiry:=greatest(expiry,extension_expiry);
    if extension_expiry is not null and p_as_of<extension_expiry then
      update public.club_membership_payment_access_suspensions set active=false,cleared_at=coalesce(cleared_at,now()) where obligation_id=o.id and active;
    end if;
    if expiry is not null and p_as_of>=expiry and coalesce(policy.access_suspension_enabled,false) then
      update public.club_membership_billing_obligations set state='overdue',recovery_exhausted_at=coalesce(recovery_exhausted_at,p_as_of),updated_at=now() where id=o.id;
      insert into public.club_membership_payment_access_suspensions(organisation_id,membership_id,user_id,obligation_id)
      values(p_organisation_id,o.membership_id,o.user_id,o.id) on conflict(obligation_id) do update set active=true,cleared_at=null;
      stage:='access_suspended';
    else stage:=case when extension_expiry is not null and p_as_of<extension_expiry then 'extended_grace' when expiry is not null then 'grace_reminder' else 'payment_failed' end; end if;
    key:='billing:'||o.id::text||':'||stage;
    if o.user_id is not null then insert into public.club_membership_billing_notifications(organisation_id,obligation_id,user_id,notification_type,idempotency_key)
      values(p_organisation_id,o.id,o.user_id,stage,key) on conflict(organisation_id,idempotency_key) do nothing; end if;
  end loop;
  return jsonb_build_object('organisation_id',p_organisation_id,'evaluated_at',p_as_of,'changed',changed);
end $$;

-- A shared contract still has one obligation, but authorised staff must be able
-- to reach it from every covered holder's profile.
create or replace function public.club_list_customer_billing(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'id',obligation.id,'membership_id',obligation.membership_id,'amount_minor',obligation.amount_minor,
  'currency',obligation.currency,'next_due_at',obligation.next_due_at,'state',obligation.state,
  'payment_method_family',obligation.payment_method_family,'provider_type',arrangement.provider_type,
  'stripe_merchant_entity',case when arrangement.provider_type='stripe' then join_request.stripe_merchant_entity end,'failure_reason',obligation.failure_reason,
  'provider_status',obligation.provider_status,'provider_charge_date',obligation.provider_charge_date,
  'provider_payment_reference',obligation.provider_payment_reference,
  'mandate_status',arrangement.provider_authority_state,'collection_status',arrangement.collection_status,
  'action_required_reason',arrangement.action_required_reason,'paid_through_at',arrangement.coverage_paid_through_at
) order by obligation.next_due_at),'[]'::jsonb)
from public.club_membership_billing_obligations as obligation
join public.club_membership_billing_arrangements as arrangement on arrangement.id=obligation.arrangement_id and arrangement.organisation_id=obligation.organisation_id
left join lateral (
  select request.stripe_merchant_entity from public.club_membership_join_requests as request
  where request.organisation_id=arrangement.organisation_id and request.membership_id=arrangement.membership_id
  order by request.updated_at desc limit 1
) as join_request on true
where obligation.organisation_id=p_organisation_id
  and (
    obligation.customer_id=p_customer_id
    or exists(select 1 from public.club_customers customer where customer.id=p_customer_id and customer.organisation_id=obligation.organisation_id and customer.user_id=obligation.user_id)
    or exists(
      select 1 from public.club_membership_holders holder
      join public.club_customers customer on customer.id=p_customer_id and customer.organisation_id=holder.organisation_id
      where holder.organisation_id=obligation.organisation_id and holder.membership_id=obligation.membership_id
        and (holder.customer_id=customer.id or (customer.user_id is not null and holder.user_id=customer.user_id))
    )
  )
  and (public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') or public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.extend_grace'));
$$;

revoke all on function public.club_get_payment_grace_extension_context(uuid,uuid),public.club_extend_membership_payment_grace(uuid,uuid,timestamptz,date,text,text) from public,anon;
grant execute on function public.club_get_payment_grace_extension_context(uuid,uuid),public.club_extend_membership_payment_grace(uuid,uuid,timestamptz,date,text,text) to authenticated;
revoke all on function public.club_guard_payment_grace_history_immutable(),public.club_close_recovered_payment_grace() from public,anon,authenticated;
revoke all on function public.club_list_customer_billing(uuid,uuid) from public,anon;
grant execute on function public.club_list_customer_billing(uuid,uuid) to authenticated;

commit;
