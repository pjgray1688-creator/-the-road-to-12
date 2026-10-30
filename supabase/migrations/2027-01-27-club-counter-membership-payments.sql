-- Review-only migration: audited in-gym membership payment evidence and Family terms.
-- This migration makes no provider calls, collections, charges or product-price changes.
begin;

alter table public.club_staff_permission_overrides drop constraint if exists club_staff_permission_overrides_capability_check;
alter table public.club_staff_permission_overrides add constraint club_staff_permission_overrides_capability_check check (capability in (
  'members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately',
  'payments.take','payments.record_cash','payments.extend_grace','membership_payments.verify',
  'memberships.pricing_sensitive','memberships.manage','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust',
  'commerce.stock_remove','members.import','staff.permissions_manage','induction.manage_policy','induction.perform',
  'classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive',
  'commerce.pricing_manage','commerce.collections_manage','finance.view','finance.manage','staff.work_submit',
  'staff.work_review','finance.export'
));

create or replace function public.club_capabilities_for_role(p_role text)
returns text[] language sql immutable set search_path=pg_catalog,public as $$
  select case
    when p_role='owner' then array[
      'members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately',
      'payments.take','payments.record_cash','payments.extend_grace','membership_payments.verify','memberships.pricing_sensitive','memberships.manage',
      'refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','commerce.stock_remove','members.import',
      'staff.permissions_manage','induction.manage_policy','induction.perform','classes.manage','services.manage',
      'supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage',
      'commerce.collections_manage','finance.view','finance.manage','staff.work_submit','staff.work_review','finance.export'
    ]::text[]
    when p_role='gym_admin' then array[
      'members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately',
      'payments.take','payments.record_cash','membership_payments.verify','memberships.manage','refunds.issue','refunds.approve','cash.reconcile',
      'inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage','induction.manage_policy',
      'induction.perform','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage',
      'supplier.receive','commerce.pricing_manage','commerce.collections_manage','finance.view','finance.manage',
      'staff.work_submit','staff.work_review','finance.export'
    ]::text[]
    when p_role in ('gym_staff','trainer') then array[
      'members.view','members.create','members.link_account','memberships.assign','payments.take','payments.record_cash',
      'refunds.issue','inventory.adjust','commerce.stock_remove','induction.perform','classes.manage','services.manage',
      'supplier.orders_manage','supplier.receive','commerce.collections_manage','staff.work_submit'
    ]::text[]
    else '{}'::text[]
  end;
$$;

create or replace function public.club_capability_allowed(p_organisation_id uuid,p_user_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select auth.uid() is not null and p_user_id=auth.uid() and exists (
    select 1 from public.club_members m
    where m.organisation_id=p_organisation_id and m.user_id=p_user_id and m.active
      and m.role in ('owner','gym_admin','gym_staff','trainer') and (
        (m.role='owner' and p_capability in ('payments.extend_grace','memberships.pricing_sensitive')) or (
          not exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=p_user_id and o.capability=p_capability and o.decision='deny')
          and (p_capability=any(public.club_capabilities_for_role(m.role)) or (p_capability<>'staff.permissions_manage' and exists(
            select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=p_user_id and o.capability=p_capability and o.decision='allow'
          )))
        )
      )
  );
$$;

create table public.club_membership_counter_payments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  product_id uuid not null,
  customer_id uuid not null,
  membership_id uuid,
  location_id uuid not null,
  method text not null check(method in ('cash','bank_transfer','external_card')),
  amount_minor integer not null check(amount_minor>0),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  state text not null default 'pending_verification' check(state in ('pending_verification','confirmed','rejected')),
  reconciliation_state text not null default 'unreconciled' check(reconciliation_state in ('unreconciled','verified','rejected')),
  external_reference text,
  terminal_success_confirmed boolean not null default false,
  evidence_note text not null check(char_length(btrim(evidence_note)) between 8 and 500),
  starts_at timestamptz not null,
  payment_received_at timestamptz not null,
  provisional_expires_at timestamptz,
  initiated_by uuid not null references auth.users(id) on delete restrict,
  initiated_at timestamptz not null default now(),
  verified_by uuid references auth.users(id) on delete restrict,
  verified_at timestamptz,
  verification_note text,
  idempotency_key text not null check(char_length(btrim(idempotency_key)) between 8 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organisation_id), unique(organisation_id,idempotency_key),
  foreign key(product_id,organisation_id) references public.club_products(id,organisation_id) on delete restrict,
  foreign key(customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete restrict,
  foreign key(membership_id,organisation_id) references public.club_memberships(id,organisation_id) on delete restrict,
  foreign key(location_id,organisation_id) references public.club_locations(id,organisation_id) on delete restrict,
  check(method<>'bank_transfer' or coalesce(char_length(btrim(external_reference)),0)>0),
  check(method<>'external_card' or terminal_success_confirmed),
  check((method='bank_transfer' and provisional_expires_at is null and membership_id is null) or method<>'bank_transfer'),
  check((state='pending_verification' and verified_by is null and verified_at is null) or
    (state in ('confirmed','rejected') and verified_by is not null and verified_at is not null and nullif(btrim(verification_note),'') is not null))
);
create unique index club_membership_counter_payments_reference_uidx on public.club_membership_counter_payments(organisation_id,method,external_reference) where external_reference is not null;
create unique index club_membership_counter_payments_open_uidx on public.club_membership_counter_payments(organisation_id,customer_id,product_id) where state='pending_verification';
create unique index club_membership_counter_payments_fingerprint_uidx on public.club_membership_counter_payments(organisation_id,customer_id,product_id,method,payment_received_at,amount_minor);
create index club_membership_counter_payments_review_idx on public.club_membership_counter_payments(organisation_id,state,initiated_at);
alter table public.club_membership_counter_payments enable row level security;
revoke all on public.club_membership_counter_payments from public,anon,authenticated;

create table public.club_cash_box_collections (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  location_id uuid not null, period_started_at timestamptz, collected_at timestamptz not null,
  expected_amount_minor integer not null, collected_amount_minor integer not null check(collected_amount_minor>=0),
  variance_minor integer not null, currency text not null check(currency ~ '^[A-Z]{3}$'),
  operator_user_id uuid not null references auth.users(id) on delete restrict, notes text check(notes is null or char_length(btrim(notes))<=500),
  recorded_at timestamptz not null default now(),
  unique(id,organisation_id), unique(organisation_id,location_id,collected_at),
  foreign key(location_id,organisation_id) references public.club_locations(id,organisation_id) on delete restrict,
  check(period_started_at is null or collected_at>period_started_at), check(collected_at<=recorded_at+interval '5 minutes'),
  check(variance_minor=collected_amount_minor-expected_amount_minor)
);
create index club_cash_box_collections_location_idx on public.club_cash_box_collections(organisation_id,location_id,collected_at desc);

create table public.club_cash_collection_late_movements (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  collection_id uuid not null, location_id uuid not null, source_type text not null check(source_type in ('counter_membership_payment','cash_declaration','cash_payment','cash_refund')),
  source_id uuid not null, amount_minor integer not null check(amount_minor<>0), currency text not null check(currency ~ '^[A-Z]{3}$'),
  occurred_at timestamptz not null, recorded_at timestamptz not null, flagged_at timestamptz not null default now(),
  unique(id,organisation_id), unique(collection_id,source_type,source_id),
  foreign key(collection_id,organisation_id) references public.club_cash_box_collections(id,organisation_id) on delete restrict,
  foreign key(location_id,organisation_id) references public.club_locations(id,organisation_id) on delete restrict
);

create table public.club_cash_collection_resolutions (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  collection_id uuid not null, resolution_type text not null check(resolution_type in ('explained','investigating','accepted_variance')),
  note text not null check(char_length(btrim(note)) between 8 and 500), resolved_by uuid not null references auth.users(id) on delete restrict,
  resolved_at timestamptz not null default now(),
  foreign key(collection_id,organisation_id) references public.club_cash_box_collections(id,organisation_id) on delete restrict
);

create table public.club_cash_late_movement_resolutions (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  late_movement_id uuid not null unique,
  note text not null check(char_length(btrim(note)) between 8 and 500), resolved_by uuid not null references auth.users(id) on delete restrict,
  resolved_at timestamptz not null default now(),
  foreign key(late_movement_id,organisation_id) references public.club_cash_collection_late_movements(id,organisation_id) on delete restrict
);

alter table public.club_cash_box_collections enable row level security;
alter table public.club_cash_collection_late_movements enable row level security;
alter table public.club_cash_collection_resolutions enable row level security;
alter table public.club_cash_late_movement_resolutions enable row level security;
revoke all on public.club_cash_box_collections,public.club_cash_collection_late_movements,public.club_cash_collection_resolutions,public.club_cash_late_movement_resolutions from public,anon,authenticated;

create or replace function public.club_guard_cash_collection_history() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin raise exception 'Cash collection history is immutable' using errcode='42501'; end $$;
create trigger club_cash_box_collections_immutable before update or delete on public.club_cash_box_collections for each row execute function public.club_guard_cash_collection_history();
create trigger club_cash_collection_late_movements_immutable before update or delete on public.club_cash_collection_late_movements for each row execute function public.club_guard_cash_collection_history();
create trigger club_cash_collection_resolutions_immutable before update or delete on public.club_cash_collection_resolutions for each row execute function public.club_guard_cash_collection_history();
create trigger club_cash_late_movement_resolutions_immutable before update or delete on public.club_cash_late_movement_resolutions for each row execute function public.club_guard_cash_collection_history();

create or replace function public.club_flag_late_cash_movement() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare collection public.club_cash_box_collections%rowtype; occurred timestamptz; recorded timestamptz; amount integer; currency_code text; org uuid; location uuid; source text; payment_method text;
begin
  if tg_table_name='club_membership_counter_payments' then
    if new.method<>'cash' then return new; end if;
    occurred:=new.payment_received_at; recorded:=new.created_at; amount:=new.amount_minor; currency_code:=new.currency; org:=new.organisation_id; location:=new.location_id; source:='counter_membership_payment';
  elsif tg_table_name='club_cash_declarations' then
    occurred:=new.declared_at; recorded:=new.created_at; amount:=new.declared_amount_minor; currency_code:=new.currency; org:=new.organisation_id; location:=new.location_id; source:='cash_declaration';
  elsif tg_table_name='club_payments' then
    if new.method<>'cash' or new.status not in ('paid','partially_refunded','refunded') or exists(select 1 from public.club_cash_declarations d where d.organisation_id=new.organisation_id and d.order_id=new.order_id) then return new; end if;
    select o.location_id into location from public.club_orders o where o.id=new.order_id and o.organisation_id=new.organisation_id;
    occurred:=new.created_at; recorded:=new.created_at; amount:=new.amount_minor; currency_code:=new.currency; org:=new.organisation_id; source:='cash_payment';
  elsif tg_table_name='club_refunds' then
    select o.location_id,p.method,p.currency into location,payment_method,currency_code from public.club_orders o join public.club_payments p on p.id=new.payment_id and p.organisation_id=new.organisation_id where o.id=new.order_id and o.organisation_id=new.organisation_id;
    if payment_method is distinct from 'cash' then return new; end if;
    occurred:=new.created_at; recorded:=new.created_at; amount:=-new.amount_minor; org:=new.organisation_id; source:='cash_refund';
  else
    return new;
  end if;
  if location is null then return new; end if;
  select * into collection from public.club_cash_box_collections c where c.organisation_id=org and c.location_id=location and occurred<=c.collected_at and (c.period_started_at is null or occurred>c.period_started_at) and recorded>c.recorded_at order by c.collected_at desc limit 1;
  if found then insert into public.club_cash_collection_late_movements(organisation_id,collection_id,location_id,source_type,source_id,amount_minor,currency,occurred_at,recorded_at) values(org,collection.id,location,source,new.id,amount,currency_code,occurred,recorded) on conflict(collection_id,source_type,source_id) do nothing; end if;
  return new;
end $$;
create trigger club_counter_payment_late_cash_flag after insert on public.club_membership_counter_payments for each row execute function public.club_flag_late_cash_movement();
create trigger club_cash_declaration_late_flag after insert on public.club_cash_declarations for each row execute function public.club_flag_late_cash_movement();
create trigger club_payment_late_cash_flag after insert on public.club_payments for each row execute function public.club_flag_late_cash_movement();
create trigger club_refund_late_cash_flag after insert on public.club_refunds for each row execute function public.club_flag_late_cash_movement();

create or replace function public.club_initiate_membership_counter_payment(
  p_organisation_id uuid,p_product_id uuid,p_customer_id uuid,p_location_id uuid,p_method text,
  p_external_reference text,p_terminal_success_confirmed boolean,p_evidence_note text,p_starts_at timestamptz,
  p_payment_received_at timestamptz,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare product public.club_products%rowtype; row public.club_membership_counter_payments%rowtype;
  assignment jsonb; provisional_end timestamptz; actual_end timestamptz;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then raise exception 'Membership payment initiation is not permitted' using errcode='42501'; end if;
  if p_method not in ('cash','bank_transfer','external_card') or p_starts_at is null or p_starts_at>now()+interval '5 minutes' or p_payment_received_at is null or p_payment_received_at>now()+interval '5 minutes' or nullif(btrim(p_evidence_note),'') is null or char_length(btrim(p_evidence_note)) not between 8 and 500 or nullif(btrim(p_idempotency_key),'') is null then raise exception 'Complete the payment evidence' using errcode='22023'; end if;
  if p_method='bank_transfer' and nullif(btrim(p_external_reference),'') is null then raise exception 'Bank transfer reference is required' using errcode='22023'; end if;
  if p_method='external_card' and not coalesce(p_terminal_success_confirmed,false) then raise exception 'Terminal success confirmation is required' using errcode='22023'; end if;
  if p_method='cash' and not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.record_cash') then raise exception 'Cash recording is not permitted' using errcode='42501'; end if;
  if p_method in ('cash','external_card') and not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.assign') then raise exception 'Provisional membership access is not permitted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id) then raise exception 'Member is outside this organisation' using errcode='42501'; end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) or not public.club_location_authorized(p_organisation_id,p_location_id) then raise exception 'An authorised active venue is required' using errcode='42501'; end if;
  select * into product from public.club_products where id=p_product_id and organisation_id=p_organisation_id for share;
  if not found or product.kind<>'membership' or product.archived_at is not null or not product.sellable or product.price_minor<=0 or product.pricing_on_request then raise exception 'This product requires a different authorised contract workflow' using errcode='22023'; end if;
  select * into row from public.club_membership_counter_payments where organisation_id=p_organisation_id and idempotency_key=btrim(p_idempotency_key);
  if found then
    if row.product_id<>p_product_id or row.customer_id<>p_customer_id or row.location_id<>p_location_id or row.method<>p_method or row.payment_received_at<>p_payment_received_at then raise exception 'Idempotency key represents another payment' using errcode='23505'; end if;
    return to_jsonb(row);
  end if;
  if p_method in ('cash','external_card') and exists(select 1 from public.club_membership_counter_payments prior where prior.organisation_id=p_organisation_id and prior.customer_id=p_customer_id and prior.product_id=p_product_id and prior.provisional_expires_at is not null and (prior.reconciliation_state='unreconciled' or prior.provisional_expires_at>now())) then raise exception 'Existing provisional access requires management review or expiry' using errcode='23505'; end if;
  actual_end:=case when product.duration_days is not null then p_starts_at+make_interval(days=>product.duration_days) else null end;
  provisional_end:=case when p_method in ('cash','external_card') then least(now()+interval '7 days',coalesce(actual_end,'infinity'::timestamptz)) else null end;
  insert into public.club_membership_counter_payments(organisation_id,product_id,customer_id,location_id,method,amount_minor,currency,external_reference,terminal_success_confirmed,evidence_note,starts_at,payment_received_at,provisional_expires_at,initiated_by,idempotency_key)
  values(p_organisation_id,p_product_id,p_customer_id,p_location_id,p_method,product.price_minor,product.currency,nullif(btrim(p_external_reference),''),coalesce(p_terminal_success_confirmed,false),btrim(p_evidence_note),p_starts_at,p_payment_received_at,provisional_end,auth.uid(),btrim(p_idempotency_key)) returning * into row;
  if provisional_end is not null then
    assignment:=public.club_assign_membership(p_organisation_id,p_product_id,p_customer_id,'{}'::uuid[],p_starts_at,provisional_end,'staff_assignment','counter-provisional:'||row.id::text);
    update public.club_membership_counter_payments set membership_id=(assignment->'membership'->>'id')::uuid,updated_at=now() where id=row.id returning * into row;
  end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata)
  select p_organisation_id,auth.uid(),m.role,'membership.payment_initiated','membership_counter_payment',row.id,p_location_id,btrim(p_evidence_note),jsonb_build_object('product_id',product.id,'customer_id',p_customer_id,'method',p_method,'amount_minor',product.price_minor,'currency',product.currency,'reference_present',row.external_reference is not null,'terminal_success_confirmed',row.terminal_success_confirmed,'payment_received_at',row.payment_received_at,'provisional_expires_at',row.provisional_expires_at,'membership_id',row.membership_id)
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active;
  return to_jsonb(row);
end $$;

create or replace function public.club_verify_membership_counter_payment(p_organisation_id uuid,p_payment_id uuid,p_decision text,p_verification_note text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare payment public.club_membership_counter_payments%rowtype; product public.club_products%rowtype; result jsonb; end_at timestamptz;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'membership_payments.verify') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.assign') then raise exception 'Payment verification is not permitted' using errcode='42501'; end if;
  if p_decision not in ('confirmed','rejected') or nullif(btrim(p_verification_note),'') is null or char_length(btrim(p_verification_note)) not between 8 and 500 then raise exception 'A documented verification decision is required' using errcode='22023'; end if;
  select * into payment from public.club_membership_counter_payments where id=p_payment_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Payment record not found' using errcode='P0002'; end if;
  if payment.state<>'pending_verification' then
    if payment.state<>p_decision then raise exception 'Payment already has a different verification decision' using errcode='23505'; end if;
    return to_jsonb(payment);
  end if;
  if payment.method='cash' and not public.club_capability_allowed(p_organisation_id,auth.uid(),'cash.reconcile') then raise exception 'Cash reconciliation is not permitted' using errcode='42501'; end if;
  if p_decision='confirmed' then
    select * into product from public.club_products where id=payment.product_id and organisation_id=payment.organisation_id for share;
    if not found or product.archived_at is not null or product.price_minor<>payment.amount_minor or product.currency<>payment.currency or product.pricing_on_request then raise exception 'Product terms changed; review without activating access' using errcode='22023'; end if;
    end_at:=case when product.duration_days is not null then payment.starts_at + make_interval(days=>product.duration_days) else null end;
    if payment.membership_id is null then
      result:=public.club_assign_membership(payment.organisation_id,payment.product_id,payment.customer_id,'{}'::uuid[],payment.starts_at,end_at,'staff_assignment','counter-payment:'||payment.id::text);
      payment.membership_id:=(result->'membership'->>'id')::uuid;
    else
      update public.club_memberships set status='active',ends_at=end_at,updated_at=now() where id=payment.membership_id and organisation_id=payment.organisation_id;
      update public.club_entitlement_grants set ends_at=end_at where membership_id=payment.membership_id and organisation_id=payment.organisation_id;
    end if;
    update public.club_membership_counter_payments set state='confirmed',reconciliation_state='verified',membership_id=payment.membership_id,verified_by=auth.uid(),verified_at=now(),verification_note=btrim(p_verification_note),updated_at=now() where id=payment.id returning * into payment;
  else
    if payment.membership_id is not null then
      update public.club_memberships set status='cancelled',ends_at=least(coalesce(ends_at,now()),now()),ended_at=coalesce(ended_at,now()),ended_by=coalesce(ended_by,auth.uid()),end_reason=coalesce(end_reason,'Counter payment evidence rejected'),updated_at=now() where id=payment.membership_id and organisation_id=payment.organisation_id;
      update public.club_entitlement_grants set ends_at=least(coalesce(ends_at,now()),now()) where membership_id=payment.membership_id and organisation_id=payment.organisation_id;
    end if;
    update public.club_membership_counter_payments set state='rejected',reconciliation_state='rejected',verified_by=auth.uid(),verified_at=now(),verification_note=btrim(p_verification_note),updated_at=now() where id=payment.id returning * into payment;
  end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata)
  select p_organisation_id,auth.uid(),m.role,'membership.payment_'||p_decision,'membership_counter_payment',payment.id,payment.location_id,btrim(p_verification_note),jsonb_build_object('membership_id',payment.membership_id,'method',payment.method,'amount_minor',payment.amount_minor,'currency',payment.currency)
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active;
  return to_jsonb(payment);
end $$;

create or replace function public.club_list_membership_counter_payments(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare broad boolean;
begin
  broad:=public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.view') or public.club_capability_allowed(p_organisation_id,auth.uid(),'membership_payments.verify');
  if auth.uid() is null or (not broad and not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take')) then raise exception 'Membership payment status is not permitted' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'method',p.method,'state',p.state,'reconciliation_state',p.reconciliation_state,'amount_minor',p.amount_minor,'currency',p.currency,'external_reference',p.external_reference,'terminal_success_confirmed',p.terminal_success_confirmed,'evidence_note',p.evidence_note,'payment_received_at',p.payment_received_at,'initiated_at',p.initiated_at,'provisional_expires_at',p.provisional_expires_at,'customer_name',p.customer_name,'product_name',p.product_name,'location_name',p.location_name) order by p.initiated_at desc) from (select payment.*,c.display_name customer_name,product.name product_name,l.name location_name from public.club_membership_counter_payments payment join public.club_customers c on c.id=payment.customer_id and c.organisation_id=payment.organisation_id join public.club_products product on product.id=payment.product_id and product.organisation_id=payment.organisation_id join public.club_locations l on l.id=payment.location_id and l.organisation_id=payment.organisation_id where payment.organisation_id=p_organisation_id and (broad or payment.initiated_by=auth.uid()) order by payment.initiated_at desc limit 100) p),'[]'::jsonb);
end $$;

create table public.club_membership_counter_payment_corrections (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  payment_id uuid not null, correction_type text not null check(correction_type in ('reversed','evidence_correction_required')),
  reason text not null check(char_length(btrim(reason)) between 8 and 500), corrected_by uuid not null references auth.users(id) on delete restrict,
  corrected_at timestamptz not null default now(), unique(payment_id,correction_type),
  foreign key(payment_id,organisation_id) references public.club_membership_counter_payments(id,organisation_id) on delete restrict
);
alter table public.club_membership_counter_payment_corrections enable row level security;
revoke all on public.club_membership_counter_payment_corrections from public,anon,authenticated;
create trigger club_counter_payment_corrections_immutable before update or delete on public.club_membership_counter_payment_corrections for each row execute function public.club_guard_cash_collection_history();

create or replace function public.club_correct_membership_counter_payment(p_organisation_id uuid,p_payment_id uuid,p_correction_type text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare payment public.club_membership_counter_payments%rowtype; correction public.club_membership_counter_payment_corrections%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.manage') then raise exception 'Financial correction is not permitted' using errcode='42501'; end if;
  if p_correction_type not in ('reversed','evidence_correction_required') or char_length(btrim(p_reason)) not between 8 and 500 then raise exception 'A documented correction is required' using errcode='22023'; end if;
  select * into payment from public.club_membership_counter_payments where id=p_payment_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Payment record not found' using errcode='P0002'; end if;
  insert into public.club_membership_counter_payment_corrections(organisation_id,payment_id,correction_type,reason,corrected_by) values(p_organisation_id,payment.id,p_correction_type,btrim(p_reason),auth.uid()) returning * into correction;
  if p_correction_type='reversed' and payment.membership_id is not null then
    update public.club_memberships set status='cancelled',ends_at=least(coalesce(ends_at,now()),now()),ended_at=coalesce(ended_at,now()),ended_by=coalesce(ended_by,auth.uid()),end_reason=coalesce(end_reason,btrim(p_reason)),updated_at=now() where id=payment.membership_id and organisation_id=payment.organisation_id;
    update public.club_entitlement_grants set ends_at=least(coalesce(ends_at,now()),now()) where membership_id=payment.membership_id and organisation_id=payment.organisation_id;
  end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata)
  select p_organisation_id,auth.uid(),m.role,'membership.payment_corrected','membership_counter_payment',payment.id,payment.location_id,btrim(p_reason),jsonb_build_object('correction_id',correction.id,'correction_type',p_correction_type,'membership_id',payment.membership_id,'amount_minor',payment.amount_minor,'currency',payment.currency) from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active;
  return to_jsonb(correction);
end $$;

create or replace function public.club_record_cash_box_collection(p_organisation_id uuid,p_location_id uuid,p_collected_amount_minor integer,p_collected_at timestamptz,p_notes text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare previous_cutoff timestamptz; recorded timestamptz:=now(); expected integer:=0; collection public.club_cash_box_collections%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'cash.reconcile') then raise exception 'Cash collection recording is not permitted' using errcode='42501'; end if;
  if p_collected_amount_minor<0 or p_collected_at is null or p_collected_at>recorded+interval '5 minutes' or (p_notes is not null and char_length(btrim(p_notes))>500) then raise exception 'Invalid cash collection' using errcode='22023'; end if;
  perform 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active for update;
  if not found or not public.club_location_authorized(p_organisation_id,p_location_id) then raise exception 'An authorised active venue is required' using errcode='42501'; end if;
  select collected_at into previous_cutoff from public.club_cash_box_collections where organisation_id=p_organisation_id and location_id=p_location_id order by collected_at desc limit 1;
  if previous_cutoff is not null and p_collected_at<=previous_cutoff then raise exception 'Physical collection time must follow the previous venue cutoff' using errcode='22023'; end if;
  select coalesce(sum(amount_minor),0)::integer into expected from (
    select p.amount_minor from public.club_membership_counter_payments p where p.organisation_id=p_organisation_id and p.location_id=p_location_id and p.method='cash' and p.currency='GBP' and p.state<>'rejected' and p.payment_received_at<=p_collected_at and (previous_cutoff is null or p.payment_received_at>previous_cutoff) and p.created_at<=recorded
    union all
    select d.declared_amount_minor from public.club_cash_declarations d where d.organisation_id=p_organisation_id and d.location_id=p_location_id and d.currency='GBP' and d.status in ('declared','confirmed','discrepancy') and d.declared_at<=p_collected_at and (previous_cutoff is null or d.declared_at>previous_cutoff) and d.created_at<=recorded
    union all
    select p.amount_minor from public.club_payments p join public.club_orders o on o.id=p.order_id and o.organisation_id=p.organisation_id where p.organisation_id=p_organisation_id and o.location_id=p_location_id and p.method='cash' and p.currency='GBP' and p.status in ('paid','partially_refunded','refunded') and p.created_at<=p_collected_at and (previous_cutoff is null or p.created_at>previous_cutoff) and p.created_at<=recorded and not exists(select 1 from public.club_cash_declarations d where d.organisation_id=p.organisation_id and d.order_id=p.order_id)
    union all
    select -r.amount_minor from public.club_refunds r join public.club_payments p on p.id=r.payment_id and p.organisation_id=r.organisation_id join public.club_orders o on o.id=r.order_id and o.organisation_id=r.organisation_id where r.organisation_id=p_organisation_id and o.location_id=p_location_id and p.method='cash' and r.created_at<=p_collected_at and (previous_cutoff is null or r.created_at>previous_cutoff) and r.created_at<=recorded
  ) movements;
  insert into public.club_cash_box_collections(organisation_id,location_id,period_started_at,collected_at,expected_amount_minor,collected_amount_minor,variance_minor,currency,operator_user_id,notes,recorded_at)
  values(p_organisation_id,p_location_id,previous_cutoff,p_collected_at,expected,p_collected_amount_minor,p_collected_amount_minor-expected,'GBP',auth.uid(),nullif(btrim(p_notes),''),recorded) returning * into collection;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata)
  select p_organisation_id,auth.uid(),m.role,'cash_box.collection_recorded','cash_box_collection',collection.id,p_location_id,nullif(btrim(p_notes),''),jsonb_build_object('period_started_at',previous_cutoff,'collected_at',p_collected_at,'recorded_at',recorded,'expected_amount_minor',expected,'collected_amount_minor',p_collected_amount_minor,'variance_minor',p_collected_amount_minor-expected,'currency','GBP') from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active;
  return to_jsonb(collection);
end $$;

create or replace function public.club_resolve_cash_collection_variance(p_organisation_id uuid,p_collection_id uuid,p_resolution_type text,p_note text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare collection public.club_cash_box_collections%rowtype; resolution public.club_cash_collection_resolutions%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'cash.reconcile') then raise exception 'Cash variance resolution is not permitted' using errcode='42501'; end if;
  if p_resolution_type not in ('explained','investigating','accepted_variance') or char_length(btrim(p_note)) not between 8 and 500 then raise exception 'A documented variance resolution is required' using errcode='22023'; end if;
  select * into collection from public.club_cash_box_collections where id=p_collection_id and organisation_id=p_organisation_id;
  if not found then raise exception 'Cash collection not found' using errcode='P0002'; end if;
  insert into public.club_cash_collection_resolutions(organisation_id,collection_id,resolution_type,note,resolved_by) values(p_organisation_id,collection.id,p_resolution_type,btrim(p_note),auth.uid()) returning * into resolution;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata)
  select p_organisation_id,auth.uid(),m.role,'cash_box.variance_reviewed','cash_box_collection',collection.id,collection.location_id,btrim(p_note),jsonb_build_object('resolution_id',resolution.id,'resolution_type',p_resolution_type,'variance_minor',collection.variance_minor) from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active;
  return to_jsonb(resolution);
end $$;

create or replace function public.club_resolve_late_cash_movement(p_organisation_id uuid,p_late_movement_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare movement public.club_cash_collection_late_movements%rowtype; resolution public.club_cash_late_movement_resolutions%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'cash.reconcile') then raise exception 'Late cash review is not permitted' using errcode='42501'; end if;
  if char_length(btrim(p_note)) not between 8 and 500 then raise exception 'A documented late-entry resolution is required' using errcode='22023'; end if;
  select * into movement from public.club_cash_collection_late_movements where id=p_late_movement_id and organisation_id=p_organisation_id;
  if not found then raise exception 'Late cash movement not found' using errcode='P0002'; end if;
  insert into public.club_cash_late_movement_resolutions(organisation_id,late_movement_id,note,resolved_by) values(p_organisation_id,movement.id,btrim(p_note),auth.uid()) returning * into resolution;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata)
  select p_organisation_id,auth.uid(),m.role,'cash_box.late_movement_reviewed','cash_collection_late_movement',movement.id,movement.location_id,btrim(p_note),jsonb_build_object('resolution_id',resolution.id,'collection_id',movement.collection_id,'source_type',movement.source_type,'source_id',movement.source_id,'amount_minor',movement.amount_minor) from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active;
  return to_jsonb(resolution);
end $$;

create or replace function public.club_get_cash_collection_review(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'cash.reconcile') then raise exception 'Cash collection review is not permitted' using errcode='42501'; end if;
  return jsonb_build_object(
    'collections',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'locationId',c.location_id,'locationName',l.name,'periodStartedAt',c.period_started_at,'collectedAt',c.collected_at,'recordedAt',c.recorded_at,'expectedAmountMinor',c.expected_amount_minor,'collectedAmountMinor',c.collected_amount_minor,'varianceMinor',c.variance_minor,'currency',c.currency,'operatorUserId',c.operator_user_id,'notes',c.notes,'resolutions',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'type',r.resolution_type,'note',r.note,'resolvedAt',r.resolved_at) order by r.resolved_at desc) from public.club_cash_collection_resolutions r where r.collection_id=c.id),'[]'::jsonb)) order by c.collected_at desc) from public.club_cash_box_collections c join public.club_locations l on l.id=c.location_id and l.organisation_id=c.organisation_id where c.organisation_id=p_organisation_id),'[]'::jsonb),
    'lateMovements',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'collectionId',m.collection_id,'locationId',m.location_id,'locationName',l.name,'sourceType',m.source_type,'sourceId',m.source_id,'amountMinor',m.amount_minor,'currency',m.currency,'occurredAt',m.occurred_at,'recordedAt',m.recorded_at,'flaggedAt',m.flagged_at,'resolved',r.id is not null,'resolutionNote',r.note) order by m.flagged_at desc) from public.club_cash_collection_late_movements m join public.club_locations l on l.id=m.location_id and l.organisation_id=m.organisation_id left join public.club_cash_late_movement_resolutions r on r.late_movement_id=m.id where m.organisation_id=p_organisation_id),'[]'::jsonb)
  );
end $$;

alter table public.club_membership_shared_contracts add column if not exists agreed_amount_minor integer check(agreed_amount_minor is null or agreed_amount_minor>0), add column if not exists currency text check(currency is null or currency ~ '^[A-Z]{3}$'), add column if not exists frequency text check(frequency is null or frequency in ('weekly','monthly','quarterly','annual','other')), add column if not exists billing_state text check(billing_state is null or billing_state in ('pending','active','paused','ended')), add column if not exists terms_set_by uuid references auth.users(id) on delete restrict, add column if not exists terms_set_at timestamptz;

create or replace function public.club_set_family_contract_terms(p_organisation_id uuid,p_membership_id uuid,p_amount_minor integer,p_currency text,p_frequency text,p_paid_through_date date,p_billing_state text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare contract public.club_membership_shared_contracts%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.pricing_sensitive') then raise exception 'Sensitive Family pricing permission is required' using errcode='42501'; end if;
  if p_amount_minor<=0 or p_currency!~'^[A-Z]{3}$' or p_frequency not in ('weekly','monthly','quarterly','annual','other') or p_billing_state not in ('pending','active','paused','ended') or char_length(btrim(p_reason)) not between 8 and 500 then raise exception 'Complete the negotiated Family terms' using errcode='22023'; end if;
  update public.club_membership_shared_contracts set agreed_amount_minor=p_amount_minor,currency=p_currency,frequency=p_frequency,paid_through_date=p_paid_through_date,billing_state=p_billing_state,terms_set_by=auth.uid(),terms_set_at=now(),updated_at=now()
  where membership_id=p_membership_id and organisation_id=p_organisation_id and arrangement_kind='family' returning * into contract;
  if not found then raise exception 'Family contract not found' using errcode='P0002'; end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,reason,metadata)
  select p_organisation_id,auth.uid(),m.role,'membership.family_terms_set','membership',p_membership_id,btrim(p_reason),jsonb_build_object('amount_minor',p_amount_minor,'currency',p_currency,'frequency',p_frequency,'paid_through_date',p_paid_through_date,'billing_state',p_billing_state)
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active;
  return to_jsonb(contract);
end $$;

revoke all on function public.club_initiate_membership_counter_payment(uuid,uuid,uuid,uuid,text,text,boolean,text,timestamptz,timestamptz,text),public.club_verify_membership_counter_payment(uuid,uuid,text,text),public.club_list_membership_counter_payments(uuid),public.club_correct_membership_counter_payment(uuid,uuid,text,text),public.club_record_cash_box_collection(uuid,uuid,integer,timestamptz,text),public.club_resolve_cash_collection_variance(uuid,uuid,text,text),public.club_resolve_late_cash_movement(uuid,uuid,text),public.club_get_cash_collection_review(uuid),public.club_set_family_contract_terms(uuid,uuid,integer,text,text,date,text,text) from public,anon;
grant execute on function public.club_initiate_membership_counter_payment(uuid,uuid,uuid,uuid,text,text,boolean,text,timestamptz,timestamptz,text),public.club_verify_membership_counter_payment(uuid,uuid,text,text),public.club_list_membership_counter_payments(uuid),public.club_correct_membership_counter_payment(uuid,uuid,text,text),public.club_record_cash_box_collection(uuid,uuid,integer,timestamptz,text),public.club_resolve_cash_collection_variance(uuid,uuid,text,text),public.club_resolve_late_cash_movement(uuid,uuid,text),public.club_get_cash_collection_review(uuid),public.club_set_family_contract_terms(uuid,uuid,integer,text,text,date,text,text) to authenticated;

commit;
