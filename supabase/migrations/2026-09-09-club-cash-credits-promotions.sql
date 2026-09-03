-- R12 Club cash declarations, non-monetary service credits, membership setup charges and promotions.
-- Forward-only, review/install manually. No provider secrets or platform revenue are stored here.

create table public.club_cash_declarations (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid, purpose text not null check (purpose in ('commerce_order','membership','balance_top_up','other')),
  user_id uuid references auth.users(id) on delete set null, customer_id uuid, order_id uuid, membership_id uuid,
  declared_amount_minor integer not null check (declared_amount_minor > 0), currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'declared' check (status in ('declared','confirmed','rejected','cancelled','discrepancy')),
  declared_at timestamptz not null default now(), confirmed_at timestamptz, confirmed_by uuid references auth.users(id) on delete set null,
  discrepancy_minor integer, notes text, idempotency_key text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organisation_id, idempotency_key), unique (id, organisation_id),
  foreign key (location_id, organisation_id) references public.club_locations(id, organisation_id),
  foreign key (customer_id, organisation_id) references public.club_customers(id, organisation_id),
  foreign key (order_id, organisation_id) references public.club_orders(id, organisation_id),
  foreign key (membership_id, organisation_id) references public.club_memberships(id, organisation_id)
);
create index club_cash_declarations_org_status_idx on public.club_cash_declarations(organisation_id, status, declared_at desc);

create table public.club_service_credit_accounts (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, customer_id uuid, credit_key text not null,
  unit text not null check (unit in ('minute','session','class','credit','custom')), status text not null default 'active' check (status in ('active','suspended','closed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (id, organisation_id),
  foreign key (customer_id, organisation_id) references public.club_customers(id, organisation_id), check (user_id is not null or customer_id is not null),
  unique (organisation_id, credit_key, user_id), unique (organisation_id, credit_key, customer_id)
);
create table public.club_service_credit_entries (
  id uuid primary key default gen_random_uuid(), account_id uuid not null, organisation_id uuid not null,
  entry_type text not null check (entry_type in ('grant','purchase_grant','promotion_grant','manual_adjustment','usage','refund_restoration','expiry')),
  quantity_delta integer not null check (quantity_delta <> 0), balance_after integer not null check (balance_after >= 0), order_id uuid, service_id uuid, promotion_id uuid,
  actor_user_id uuid references auth.users(id) on delete set null, idempotency_key text, occurred_at timestamptz not null default now(), unique (id, organisation_id),
  foreign key (account_id, organisation_id) references public.club_service_credit_accounts(id, organisation_id) on delete cascade,
  foreign key (order_id, organisation_id) references public.club_orders(id, organisation_id), foreign key (service_id, organisation_id) references public.club_services(id, organisation_id),
  unique (organisation_id, idempotency_key)
);
create index club_service_credit_entries_account_idx on public.club_service_credit_entries(account_id, occurred_at desc);

create table public.club_membership_initial_charges (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade, product_id uuid not null,
  charge_type text not null check (charge_type in ('joining_fee','first_period','setup_fee','other_initial')), amount_minor integer not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'), required boolean not null default true, active boolean not null default true, position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (id, organisation_id), unique (organisation_id, product_id, charge_type),
  foreign key (product_id, organisation_id) references public.club_products(id, organisation_id) on delete cascade
);

create table public.club_promotions (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade, name text not null, description text,
  status text not null default 'draft' check (status in ('draft','active','paused','expired')), starts_at timestamptz not null, ends_at timestamptz,
  location_ids uuid[] not null default '{}', eligibility jsonb not null default '{}' check (jsonb_typeof(eligibility) = 'object'), created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (id, organisation_id), check (ends_at is null or ends_at > starts_at)
);
create table public.club_promotion_effects (
  id uuid primary key default gen_random_uuid(), promotion_id uuid not null references public.club_promotions(id) on delete cascade, effect_type text not null check (effect_type in ('percentage_discount','fixed_discount','waive_charge','grant_service_units')),
  percentage_basis_points integer check (percentage_basis_points is null or percentage_basis_points between 1 and 10000), amount_minor integer check (amount_minor is null or amount_minor >= 0), charge_type text check (charge_type is null or charge_type in ('joining_fee','first_period','setup_fee','other_initial')),
  credit_key text, credit_unit text check (credit_unit is null or credit_unit in ('minute','session','class','credit','custom')), credit_quantity integer check (credit_quantity is null or credit_quantity > 0),
  unique (id, promotion_id)
);
create table public.club_promotion_redemptions (
  id uuid primary key default gen_random_uuid(), promotion_id uuid not null references public.club_promotions(id), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, customer_id uuid, order_id uuid, membership_id uuid, discount_minor integer not null default 0 check (discount_minor >= 0), units_granted integer not null default 0 check (units_granted >= 0),
  redeemed_at timestamptz not null default now(), location_id uuid, idempotency_key text, unique (organisation_id, idempotency_key), unique (id, organisation_id),
  foreign key (customer_id, organisation_id) references public.club_customers(id, organisation_id), foreign key (order_id, organisation_id) references public.club_orders(id, organisation_id), foreign key (membership_id, organisation_id) references public.club_memberships(id, organisation_id), foreign key (location_id, organisation_id) references public.club_locations(id, organisation_id)
);

alter table public.club_cash_declarations enable row level security; alter table public.club_service_credit_accounts enable row level security; alter table public.club_service_credit_entries enable row level security; alter table public.club_membership_initial_charges enable row level security; alter table public.club_promotions enable row level security; alter table public.club_promotion_effects enable row level security; alter table public.club_promotion_redemptions enable row level security;
revoke all on table public.club_cash_declarations, public.club_service_credit_accounts, public.club_service_credit_entries, public.club_membership_initial_charges, public.club_promotions, public.club_promotion_effects, public.club_promotion_redemptions from public, anon, authenticated;
grant select on table public.club_cash_declarations, public.club_service_credit_accounts, public.club_service_credit_entries, public.club_membership_initial_charges, public.club_promotions, public.club_promotion_effects, public.club_promotion_redemptions to authenticated;
create policy club_cash_declarations_self_or_staff on public.club_cash_declarations for select to authenticated using (user_id = auth.uid() or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create policy club_service_credit_self_or_staff on public.club_service_credit_accounts for select to authenticated using (user_id = auth.uid() or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create policy club_service_credit_entries_self_or_staff on public.club_service_credit_entries for select to authenticated using (exists (select 1 from public.club_service_credit_accounts a where a.id=account_id and (a.user_id=auth.uid() or public.club_has_active_role(a.organisation_id,array['gym_staff','gym_admin','owner']))));
create policy club_initial_charges_staff on public.club_membership_initial_charges for select to authenticated using (public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create policy club_promotions_member_read on public.club_promotions for select to authenticated using (status='active' and now() >= starts_at and (ends_at is null or now() < ends_at) and (cardinality(location_ids)=0 or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner'])));
create policy club_promotions_staff on public.club_promotions for select to authenticated using (public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create policy club_promotion_effects_staff on public.club_promotion_effects for select to authenticated using (exists(select 1 from public.club_promotions p where p.id=promotion_id and public.club_has_active_role(p.organisation_id,array['gym_staff','gym_admin','owner'])));
create policy club_redemptions_self_or_staff on public.club_promotion_redemptions for select to authenticated using (user_id=auth.uid() or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));

create or replace function public.club_declare_cash_payment(p_organisation_id uuid,p_location_id uuid,p_purpose text,p_user_id uuid,p_customer_id uuid,p_order_id uuid,p_membership_id uuid,p_amount_minor integer,p_currency text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_cash_declarations%rowtype; v_order public.club_orders%rowtype; v_item public.club_order_items%rowtype;
begin
  if auth.uid() is null or p_amount_minor <= 0 or p_currency !~ '^[A-Z]{3}$' or p_purpose not in ('commerce_order','membership','balance_top_up','other') then raise exception 'Invalid cash declaration' using errcode='22023'; end if;
  if p_user_id is distinct from auth.uid() then raise exception 'Cash declaration is not permitted' using errcode='42501'; end if;
  if p_idempotency_key is not null then select * into v_row from public.club_cash_declarations where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then if v_row.user_id is distinct from auth.uid() or v_row.declared_amount_minor<>p_amount_minor or v_row.order_id is distinct from p_order_id then raise exception 'Idempotency key conflict' using errcode='23505'; end if; return to_jsonb(v_row); end if; end if;
  if not public.club_has_active_role(p_organisation_id,array['member','trainer','gym_staff','gym_admin','owner']) then raise exception 'Organisation access is not permitted' using errcode='42501'; end if;
  if p_customer_id is not null and not exists(select 1 from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id and user_id=auth.uid()) then raise exception 'Customer is not associated with caller' using errcode='42501'; end if;
  if p_order_id is not null then select * into v_order from public.club_orders where id=p_order_id and organisation_id=p_organisation_id and user_id=auth.uid() for update; if not found or v_order.status<>'pending_payment' or v_order.total_minor<>p_amount_minor then raise exception 'Order is not eligible for cash declaration' using errcode='22023'; end if; end if;
  insert into public.club_cash_declarations(organisation_id,location_id,purpose,user_id,customer_id,order_id,membership_id,declared_amount_minor,currency,idempotency_key) values(p_organisation_id,p_location_id,p_purpose,auth.uid(),p_customer_id,p_order_id,p_membership_id,p_amount_minor,p_currency,p_idempotency_key) returning * into v_row;
  if p_order_id is not null then for v_item in select * from public.club_order_items where order_id=p_order_id and stock_tracked loop insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key) values(p_organisation_id,p_location_id,v_item.product_id,'sale',-v_item.quantity, p_order_id, auth.uid(), case when p_idempotency_key is null then 'cash-declaration:'||v_row.id::text||':'||v_item.id::text else 'cash-declaration:'||p_idempotency_key||':'||v_item.id::text end); end loop; end if;
  return to_jsonb(v_row);
end; $$;

create or replace function public.club_reconcile_cash_declaration(p_declaration_id uuid,p_status text,p_notes text,p_discrepancy_minor integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_cash_declarations%rowtype;
begin
  select * into v_row from public.club_cash_declarations where id=p_declaration_id for update; if not found or not public.club_has_active_role(v_row.organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Cash reconciliation is not permitted' using errcode='42501'; end if;
  if v_row.status<>'declared' or p_status not in ('confirmed','rejected','discrepancy') then raise exception 'Cash declaration is not reconcilable' using errcode='22023'; end if;
  update public.club_cash_declarations set status=p_status,confirmed_at=now(),confirmed_by=auth.uid(),notes=p_notes,discrepancy_minor=p_discrepancy_minor,updated_at=now() where id=v_row.id returning * into v_row; return to_jsonb(v_row);
end; $$;

create or replace function public.club_grant_service_credit(p_organisation_id uuid,p_user_id uuid,p_customer_id uuid,p_credit_key text,p_unit text,p_quantity integer,p_entry_type text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_account public.club_service_credit_accounts%rowtype; v_entry public.club_service_credit_entries%rowtype; v_existing public.club_service_credit_entries%rowtype; v_balance integer;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) or p_quantity<=0 or p_entry_type not in ('grant','purchase_grant','promotion_grant','manual_adjustment') then raise exception 'Service credit grant is not permitted' using errcode='42501'; end if;
  if p_user_id is not null and not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active) then raise exception 'Credit recipient is not in organisation' using errcode='22023'; end if;
  if p_customer_id is not null and not exists(select 1 from public.club_customers where organisation_id=p_organisation_id and id=p_customer_id) then raise exception 'Credit customer is not in organisation' using errcode='22023'; end if;
  if p_idempotency_key is not null then select * into v_existing from public.club_service_credit_entries where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return to_jsonb(v_existing); end if; end if;
  select * into v_account from public.club_service_credit_accounts where organisation_id=p_organisation_id and credit_key=p_credit_key and ((p_user_id is not null and user_id=p_user_id) or (p_customer_id is not null and customer_id=p_customer_id)) for update;
  if not found then insert into public.club_service_credit_accounts(organisation_id,user_id,customer_id,credit_key,unit) values(p_organisation_id,p_user_id,p_customer_id,p_credit_key,p_unit) returning * into v_account; end if;
  v_balance:=coalesce((select sum(quantity_delta) from public.club_service_credit_entries where account_id=v_account.id),0); insert into public.club_service_credit_entries(account_id,organisation_id,entry_type,quantity_delta,balance_after,actor_user_id,idempotency_key) values(v_account.id,p_organisation_id,p_entry_type,p_quantity,v_balance+p_quantity,auth.uid(),p_idempotency_key) returning * into v_entry; return to_jsonb(v_entry);
end; $$;

create or replace function public.club_spend_service_credit(p_account_id uuid,p_quantity integer,p_service_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_account public.club_service_credit_accounts%rowtype; v_existing public.club_service_credit_entries%rowtype; v_entry public.club_service_credit_entries%rowtype; v_balance integer;
begin
  select * into v_account from public.club_service_credit_accounts where id=p_account_id for update; if not found or auth.uid() is null or not (v_account.user_id=auth.uid() or exists(select 1 from public.club_customers c where c.id=v_account.customer_id and c.user_id=auth.uid())) then raise exception 'Service credit spend is not permitted' using errcode='42501'; end if;
  select * into v_existing from public.club_service_credit_entries where account_id=p_account_id and idempotency_key=p_idempotency_key; if found then return to_jsonb(v_existing); end if;
  v_balance:=coalesce((select sum(quantity_delta) from public.club_service_credit_entries where account_id=v_account.id),0); if p_quantity<=0 or v_balance<p_quantity then raise exception 'Insufficient service credit' using errcode='22023'; end if;
  insert into public.club_service_credit_entries(account_id,organisation_id,entry_type,quantity_delta,balance_after,service_id,actor_user_id,idempotency_key) values(v_account.id,v_account.organisation_id,'usage',-p_quantity,v_balance-p_quantity,p_service_id,auth.uid(),p_idempotency_key) returning * into v_entry; return to_jsonb(v_entry);
end; $$;

create or replace function public.club_save_membership_initial_charge(p_id uuid,p_organisation_id uuid,p_product_id uuid,p_charge_type text,p_amount_minor integer,p_currency text,p_required boolean,p_active boolean,p_position integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_membership_initial_charges%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Initial charge administration is not permitted' using errcode='42501'; end if;
  if p_amount_minor<0 or p_position<0 or p_currency !~ '^[A-Z]{3}$' then raise exception 'Invalid initial charge' using errcode='22023'; end if;
  if p_id is null then insert into public.club_membership_initial_charges(organisation_id,product_id,charge_type,amount_minor,currency,required,active,position) values(p_organisation_id,p_product_id,p_charge_type,p_amount_minor,p_currency,p_required,p_active,p_position) returning * into v_row; else update public.club_membership_initial_charges set amount_minor=p_amount_minor,currency=p_currency,required=p_required,active=p_active,position=p_position,updated_at=now() where id=p_id and organisation_id=p_organisation_id returning * into v_row; if not found then raise exception 'Initial charge not found' using errcode='P0002'; end if; end if; return to_jsonb(v_row);
end; $$;

create or replace function public.club_save_promotion(p_id uuid,p_organisation_id uuid,p_name text,p_description text,p_status text,p_starts_at timestamptz,p_ends_at timestamptz,p_location_ids uuid[],p_eligibility jsonb,p_effects jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_promotions%rowtype; v_effect jsonb;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Promotion administration is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_name),'') is null or p_status not in ('draft','active','paused','expired') or p_ends_at is not null and p_ends_at<=p_starts_at then raise exception 'Invalid promotion' using errcode='22023'; end if;
  if exists(select 1 from unnest(coalesce(p_location_ids,'{}')) location_id where not exists(select 1 from public.club_locations l where l.id=location_id and l.organisation_id=p_organisation_id)) then raise exception 'Promotion location is not in organisation' using errcode='22023'; end if;
  if p_id is null then insert into public.club_promotions(organisation_id,name,description,status,starts_at,ends_at,location_ids,eligibility,created_by) values(p_organisation_id,btrim(p_name),p_description,p_status,p_starts_at,p_ends_at,coalesce(p_location_ids,'{}'),coalesce(p_eligibility,'{}'),auth.uid()) returning * into v_row; else update public.club_promotions set name=btrim(p_name),description=p_description,status=p_status,starts_at=p_starts_at,ends_at=p_ends_at,location_ids=coalesce(p_location_ids,'{}'),eligibility=coalesce(p_eligibility,'{}'),updated_at=now() where id=p_id and organisation_id=p_organisation_id returning * into v_row; if not found then raise exception 'Promotion not found' using errcode='P0002'; end if; delete from public.club_promotion_effects where promotion_id=v_row.id; end if;
  if jsonb_typeof(coalesce(p_effects,'[]'))<>'array' then raise exception 'Invalid promotion effects' using errcode='22023'; end if;
  if p_status='active' and jsonb_array_length(coalesce(p_effects,'[]'))=0 then raise exception 'Active promotion requires an effect' using errcode='22023'; end if;
  for v_effect in select * from jsonb_array_elements(coalesce(p_effects,'[]')) loop
    if v_effect->>'effect_type'='percentage_discount' and ((v_effect->>'percentage_basis_points')::integer is null or (v_effect->>'percentage_basis_points')::integer not between 1 and 10000 or v_effect ?| array['amount_minor','charge_type','credit_key','credit_unit','credit_quantity']) then raise exception 'Invalid percentage effect' using errcode='22023'; end if;
    if v_effect->>'effect_type'='fixed_discount' and ((v_effect->>'amount_minor')::integer is null or (v_effect->>'amount_minor')::integer<=0 or v_effect ?| array['percentage_basis_points','charge_type','credit_key','credit_unit','credit_quantity']) then raise exception 'Invalid fixed effect' using errcode='22023'; end if;
    if v_effect->>'effect_type'='waive_charge' and (nullif(v_effect->>'charge_type','') is null or v_effect ?| array['percentage_basis_points','amount_minor','credit_key','credit_unit','credit_quantity']) then raise exception 'Invalid waiver effect' using errcode='22023'; end if;
    if v_effect->>'effect_type'='grant_service_units' and (nullif(v_effect->>'credit_key','') is null or nullif(v_effect->>'credit_unit','') is null or (v_effect->>'credit_quantity')::integer is null or (v_effect->>'credit_quantity')::integer<=0 or v_effect ?| array['percentage_basis_points','amount_minor','charge_type']) then raise exception 'Invalid service credit effect' using errcode='22023'; end if;
    insert into public.club_promotion_effects(promotion_id,effect_type,percentage_basis_points,amount_minor,charge_type,credit_key,credit_unit,credit_quantity) values(v_row.id,v_effect->>'effect_type',(v_effect->>'percentage_basis_points')::integer,(v_effect->>'amount_minor')::integer,v_effect->>'charge_type',v_effect->>'credit_key',v_effect->>'credit_unit',(v_effect->>'credit_quantity')::integer);
  end loop;
  return to_jsonb(v_row);
end; $$;

revoke all on function public.club_declare_cash_payment(uuid,uuid,text,uuid,uuid,uuid,uuid,integer,text,text),public.club_reconcile_cash_declaration(uuid,text,text,integer),public.club_grant_service_credit(uuid,uuid,uuid,text,text,integer,text,text),public.club_spend_service_credit(uuid,integer,uuid,text),public.club_save_membership_initial_charge(uuid,uuid,uuid,text,integer,text,boolean,boolean,integer),public.club_save_promotion(uuid,uuid,text,text,text,timestamptz,timestamptz,uuid[],jsonb,jsonb) from public;
grant execute on function public.club_declare_cash_payment(uuid,uuid,text,uuid,uuid,uuid,uuid,integer,text,text),public.club_reconcile_cash_declaration(uuid,text,text,integer),public.club_grant_service_credit(uuid,uuid,uuid,text,text,integer,text,text),public.club_spend_service_credit(uuid,integer,uuid,text),public.club_save_membership_initial_charge(uuid,uuid,uuid,text,integer,text,boolean,boolean,integer),public.club_save_promotion(uuid,uuid,text,text,text,timestamptz,timestamptz,uuid[],jsonb,jsonb) to authenticated;

comment on table public.club_service_credit_accounts is 'Organisation-scoped non-monetary units; never a cash balance and never transferable between organisations.';
comment on table public.club_cash_declarations is 'Member-declared cash is unverified until staff reconciliation; stock taken at declaration is not re-deducted on confirmation.';

-- Cash-box orders have a distinct payment-verification lifecycle. Physical stock truth
-- is recorded at declaration; payment truth is recorded only when staff confirms cash.
alter table public.club_orders drop constraint if exists club_orders_status_check;
alter table public.club_orders add constraint club_orders_status_check check (status in ('draft','pending_payment','awaiting_cash_verification','cash_disputed','paid','fulfilled','cancelled','refunded'));

create table public.club_promotion_targets (
  id uuid primary key default gen_random_uuid(), promotion_id uuid not null, organisation_id uuid not null,
  target_type text not null check (target_type in ('commerce_product','commerce_category','membership_product','membership_initial_charge','service','all_commerce')),
  commerce_product_id uuid, category_key text, membership_product_id uuid, service_id uuid, charge_type text check (charge_type is null or charge_type in ('joining_fee','first_period','setup_fee','other_initial')), target_key text,
  unique (id, promotion_id), foreign key (promotion_id, organisation_id) references public.club_promotions(id, organisation_id) on delete cascade,
  foreign key (commerce_product_id, organisation_id) references public.club_commerce_products(id, organisation_id), foreign key (membership_product_id, organisation_id) references public.club_products(id, organisation_id), foreign key (service_id, organisation_id) references public.club_services(id, organisation_id),
  check ((target_type='commerce_product' and commerce_product_id is not null and category_key is null and membership_product_id is null and service_id is null) or (target_type='commerce_category' and category_key is not null and commerce_product_id is null and membership_product_id is null and service_id is null) or (target_type='membership_product' and membership_product_id is not null and commerce_product_id is null and category_key is null and service_id is null) or (target_type='membership_initial_charge' and membership_product_id is not null and charge_type is not null and commerce_product_id is null and category_key is null and service_id is null) or (target_type='service' and service_id is not null and commerce_product_id is null and category_key is null and membership_product_id is null) or (target_type='all_commerce' and commerce_product_id is null and category_key is null and membership_product_id is null and service_id is null))
);
create index club_promotion_targets_promotion_idx on public.club_promotion_targets(promotion_id);
alter table public.club_promotion_targets enable row level security;
revoke all on table public.club_promotion_targets from public, anon, authenticated;
grant select on table public.club_promotion_targets to authenticated;
create policy club_promotion_targets_staff_select on public.club_promotion_targets for select to authenticated using (exists(select 1 from public.club_promotions p where p.id=promotion_id and public.club_has_active_role(p.organisation_id,array['gym_staff','gym_admin','owner'])));

create or replace function public.club_declare_cash_payment(p_organisation_id uuid,p_location_id uuid,p_purpose text,p_user_id uuid,p_customer_id uuid,p_order_id uuid,p_membership_id uuid,p_amount_minor integer,p_currency text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_cash_declarations%rowtype; v_order public.club_orders%rowtype; v_item public.club_order_items%rowtype;
begin
  if auth.uid() is null or p_amount_minor<=0 or p_currency !~ '^[A-Z]{3}$' or p_purpose not in ('commerce_order','membership','balance_top_up','other') or p_user_id is distinct from auth.uid() then raise exception 'Invalid cash declaration' using errcode='42501'; end if;
  if not public.club_has_active_role(p_organisation_id,array['member','trainer','gym_staff','gym_admin','owner']) then raise exception 'Organisation access is not permitted' using errcode='42501'; end if;
  if p_purpose='commerce_order' then
    if p_order_id is null or p_membership_id is not null then raise exception 'Cash declaration resource is invalid' using errcode='22023'; end if;
    select * into v_order from public.club_orders where id=p_order_id and organisation_id=p_organisation_id and user_id=auth.uid() for update;
    if not found or v_order.status<>'pending_payment' or v_order.total_minor<>p_amount_minor or v_order.currency<>p_currency or (p_location_id is distinct from v_order.location_id) then raise exception 'Order is not eligible for cash declaration' using errcode='22023'; end if;
  elsif p_purpose='membership' then
    if p_membership_id is null or p_order_id is not null or not exists(select 1 from public.club_membership_holders h join public.club_memberships m on m.id=h.membership_id and m.organisation_id=p_organisation_id where h.membership_id=p_membership_id and h.user_id=auth.uid()) then raise exception 'Membership is not associated with caller' using errcode='42501'; end if;
  elsif p_purpose='balance_top_up' then
    if p_order_id is not null or p_membership_id is not null then raise exception 'Cash declaration resource is invalid' using errcode='22023'; end if;
  elsif p_order_id is not null or p_membership_id is not null then raise exception 'Cash declaration resource is invalid' using errcode='22023'; end if;
  if p_customer_id is not null and not exists(select 1 from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id and user_id=auth.uid()) then raise exception 'Customer is not associated with caller' using errcode='42501'; end if;
  if p_idempotency_key is not null then select * into v_row from public.club_cash_declarations where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then if v_row.user_id is distinct from auth.uid() or v_row.customer_id is distinct from p_customer_id or v_row.purpose<>p_purpose or v_row.order_id is distinct from p_order_id or v_row.membership_id is distinct from p_membership_id or v_row.location_id is distinct from p_location_id or v_row.declared_amount_minor<>p_amount_minor or v_row.currency<>p_currency then raise exception 'Idempotency key conflict' using errcode='23505'; end if; return to_jsonb(v_row); end if; end if;
  insert into public.club_cash_declarations(organisation_id,location_id,purpose,user_id,customer_id,order_id,membership_id,declared_amount_minor,currency,idempotency_key) values(p_organisation_id,p_location_id,p_purpose,auth.uid(),p_customer_id,p_order_id,p_membership_id,p_amount_minor,p_currency,p_idempotency_key) returning * into v_row;
  if p_purpose='commerce_order' then update public.club_orders set status='awaiting_cash_verification',updated_at=now() where id=p_order_id; for v_item in select * from public.club_order_items where order_id=p_order_id and stock_tracked loop insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key) values(p_organisation_id,p_location_id,v_item.product_id,'sale',-v_item.quantity,p_order_id,auth.uid(),'cash-declaration:'||coalesce(p_idempotency_key,v_row.id::text)||':'||v_item.id::text); end loop; end if;
  return to_jsonb(v_row);
end; $$;

create or replace function public.club_reconcile_cash_declaration(p_declaration_id uuid,p_status text,p_notes text,p_discrepancy_minor integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_cash_declarations%rowtype; v_order public.club_orders%rowtype; v_payment public.club_payments%rowtype;
begin
  select * into v_row from public.club_cash_declarations where id=p_declaration_id for update; if not found or not public.club_has_active_role(v_row.organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Cash reconciliation is not permitted' using errcode='42501'; end if;
  if v_row.status<> 'declared' then if v_row.status=p_status then return to_jsonb(v_row); else raise exception 'Cash declaration decision conflicts' using errcode='23505'; end if; end if;
  if p_status not in ('confirmed','rejected','discrepancy') then raise exception 'Cash declaration is not reconcilable' using errcode='22023'; end if;
  if v_row.purpose='commerce_order' then select * into v_order from public.club_orders where id=v_row.order_id for update; if p_status='confirmed' then if v_order.status<>'awaiting_cash_verification' then raise exception 'Order is not awaiting cash confirmation' using errcode='22023'; end if; insert into public.club_payments(order_id,organisation_id,method,amount_minor,currency,status) values(v_order.id,v_order.organisation_id,'cash',v_order.total_minor,v_order.currency,'paid') returning * into v_payment; update public.club_orders set status='paid',updated_at=now() where id=v_order.id; elsif v_order.status='awaiting_cash_verification' then update public.club_orders set status='cash_disputed',updated_at=now() where id=v_order.id; end if; end if;
  update public.club_cash_declarations set status=p_status,confirmed_at=now(),confirmed_by=auth.uid(),notes=p_notes,discrepancy_minor=p_discrepancy_minor,updated_at=now() where id=v_row.id returning * into v_row; return to_jsonb(v_row);
end; $$;

-- Re-define existing settlement RPCs so cash-box verification orders cannot be newly settled.
create or replace function public.club_record_cash_payment(p_order_id uuid,p_amount_minor integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.club_orders%rowtype; v_payment public.club_payments%rowtype; v_existing public.club_payments%rowtype; v_order_item public.club_order_items%rowtype;
begin
  select * into v_order from public.club_orders where id=p_order_id for update; if not found then raise exception 'Order not found' using errcode='P0002'; end if;
  if v_order.status in ('awaiting_cash_verification','cash_disputed') then raise exception 'Order requires cash declaration resolution' using errcode='22023'; end if;
  if auth.uid() is null or not public.club_has_active_role(v_order.organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Cash settlement is not permitted' using errcode='42501'; end if;
  if p_amount_minor<0 or p_amount_minor<>v_order.total_minor then raise exception 'Payment amount must settle the order total' using errcode='22023'; end if;
  if p_idempotency_key is not null then select * into v_existing from public.club_payments where organisation_id=v_order.organisation_id and external_reference=p_idempotency_key; if found then if v_existing.order_id<>v_order.id then raise exception 'Idempotency key conflict' using errcode='23505'; end if; return to_jsonb(v_existing); end if; end if;
  if v_order.status<>'pending_payment' then raise exception 'Order is not awaiting settlement' using errcode='22023'; end if;
  insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status) values(v_order.id,v_order.organisation_id,'cash',p_idempotency_key,p_amount_minor,v_order.currency,'paid') returning * into v_payment;
  update public.club_orders set status='paid',updated_at=now() where id=v_order.id returning * into v_order;
  for v_order_item in select * from public.club_order_items where order_id=v_order.id and stock_tracked loop insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key) values(v_order.organisation_id,v_order.location_id,v_order_item.product_id,'sale',-v_order_item.quantity,v_order.id,auth.uid(),case when p_idempotency_key is null then null else p_idempotency_key||':'||v_order_item.product_id::text end); end loop;
  return to_jsonb(v_payment);
end; $$;
create or replace function public.club_spend_balance(p_order_id uuid,p_amount_minor integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.club_orders%rowtype; v_account public.club_balance_accounts%rowtype; v_balance integer; v_entry public.club_balance_entries%rowtype; v_existing public.club_balance_entries%rowtype; v_order_item public.club_order_items%rowtype;
begin
  select * into v_order from public.club_orders where id=p_order_id for update; if not found then raise exception 'Order not found' using errcode='P0002'; end if;
  if v_order.status in ('awaiting_cash_verification','cash_disputed') then raise exception 'Order requires cash declaration resolution' using errcode='22023'; end if;
  if auth.uid() is null or v_order.user_id is distinct from auth.uid() then raise exception 'Balance spend is not permitted' using errcode='42501'; end if;
  select * into v_account from public.club_balance_accounts where organisation_id=v_order.organisation_id and user_id=auth.uid() for update; if not found then raise exception 'Balance account not found' using errcode='P0002'; end if;
  if p_idempotency_key is not null then select * into v_existing from public.club_balance_entries where organisation_id=v_order.organisation_id and idempotency_key=p_idempotency_key; if found then if v_existing.order_id is distinct from v_order.id or v_existing.account_id<>v_account.id or v_existing.entry_type<>'purchase' then raise exception 'Idempotency key conflict' using errcode='23505'; end if; return to_jsonb(v_existing); end if; end if;
  if p_idempotency_key is not null and exists(select 1 from public.club_payments where organisation_id=v_order.organisation_id and external_reference=p_idempotency_key) then raise exception 'Idempotency key conflict' using errcode='23505'; end if;
  if p_amount_minor<=0 or p_idempotency_key is null or p_amount_minor<>v_order.total_minor then raise exception 'Balance settlement must equal the order total' using errcode='22023'; end if;
  if v_order.status<>'pending_payment' then raise exception 'Order is not awaiting settlement' using errcode='22023'; end if;
  v_balance:=coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=v_account.id),0); if v_balance<p_amount_minor then raise exception 'Insufficient organisation balance' using errcode='22023'; end if;
  insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,order_id,actor_user_id,idempotency_key) values(v_account.id,v_order.organisation_id,'purchase',-p_amount_minor,v_balance-p_amount_minor,v_order.id,auth.uid(),p_idempotency_key) returning * into v_entry;
  insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status) values(v_order.id,v_order.organisation_id,'balance',p_idempotency_key,p_amount_minor,v_order.currency,'paid');
  for v_order_item in select * from public.club_order_items where order_id=v_order.id and stock_tracked loop insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key) values(v_order.organisation_id,v_order.location_id,v_order_item.product_id,'sale',-v_order_item.quantity,v_order.id,auth.uid(),p_idempotency_key||':'||v_order_item.id::text); end loop;
  update public.club_orders set status='paid',updated_at=now() where id=v_order.id; return to_jsonb(v_entry);
end; $$;

create or replace function public.club_grant_service_credit(p_organisation_id uuid,p_user_id uuid,p_customer_id uuid,p_credit_key text,p_unit text,p_quantity integer,p_entry_type text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare v_account public.club_service_credit_accounts%rowtype; v_entry public.club_service_credit_entries%rowtype; v_existing public.club_service_credit_entries%rowtype; v_balance integer;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) or nullif(btrim(p_credit_key),'') is null or p_unit not in ('minute','session','class','credit','custom') or p_quantity<=0 or p_entry_type not in ('grant','purchase_grant','promotion_grant','manual_adjustment') then raise exception 'Service credit grant is not permitted' using errcode='42501'; end if;
  if p_user_id is not null and not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active) then raise exception 'Credit recipient is not in organisation' using errcode='22023'; end if;
  if p_customer_id is not null and not exists(select 1 from public.club_customers where organisation_id=p_organisation_id and id=p_customer_id) then raise exception 'Credit customer is not in organisation' using errcode='22023'; end if;
  if p_idempotency_key is not null then select * into v_existing from public.club_service_credit_entries where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then if not exists(select 1 from public.club_service_credit_accounts a where a.id=v_existing.account_id and a.organisation_id=p_organisation_id and a.credit_key=p_credit_key and a.unit=p_unit and ((p_user_id is not null and a.user_id=p_user_id) or (p_customer_id is not null and a.customer_id=p_customer_id))) or v_existing.quantity_delta<>p_quantity or v_existing.entry_type<>p_entry_type then raise exception 'Idempotency key conflict' using errcode='23505'; end if; return to_jsonb(v_existing); end if; end if;
  select * into v_account from public.club_service_credit_accounts where organisation_id=p_organisation_id and credit_key=p_credit_key and ((p_user_id is not null and user_id=p_user_id) or (p_customer_id is not null and customer_id=p_customer_id)) for update; if found and (v_account.unit<>p_unit or v_account.status<>'active') then raise exception 'Service credit account is incompatible' using errcode='22023'; end if; if not found then insert into public.club_service_credit_accounts(organisation_id,user_id,customer_id,credit_key,unit) values(p_organisation_id,p_user_id,p_customer_id,p_credit_key,p_unit) returning * into v_account; end if;
  v_balance:=coalesce((select sum(quantity_delta) from public.club_service_credit_entries where account_id=v_account.id),0); insert into public.club_service_credit_entries(account_id,organisation_id,entry_type,quantity_delta,balance_after,actor_user_id,idempotency_key) values(v_account.id,p_organisation_id,p_entry_type,p_quantity,v_balance+p_quantity,auth.uid(),p_idempotency_key) returning * into v_entry; return to_jsonb(v_entry);
end; $$;

create or replace function public.club_spend_service_credit(p_account_id uuid,p_quantity integer,p_service_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare v_account public.club_service_credit_accounts%rowtype; v_existing public.club_service_credit_entries%rowtype; v_entry public.club_service_credit_entries%rowtype; v_balance integer;
begin select * into v_account from public.club_service_credit_accounts where id=p_account_id for update; if not found or v_account.status<>'active' or auth.uid() is null or not (v_account.user_id=auth.uid() or exists(select 1 from public.club_customers c where c.id=v_account.customer_id and c.user_id=auth.uid())) then raise exception 'Service credit spend is not permitted' using errcode='42501'; end if; select * into v_existing from public.club_service_credit_entries where account_id=p_account_id and idempotency_key=p_idempotency_key; if found then if v_existing.entry_type<>'usage' or v_existing.quantity_delta<>-p_quantity or v_existing.service_id is distinct from p_service_id then raise exception 'Idempotency key conflict' using errcode='23505'; end if; return to_jsonb(v_existing); end if; v_balance:=coalesce((select sum(quantity_delta) from public.club_service_credit_entries where account_id=v_account.id),0); if p_quantity<=0 or v_balance<p_quantity then raise exception 'Insufficient service credit' using errcode='22023'; end if; insert into public.club_service_credit_entries(account_id,organisation_id,entry_type,quantity_delta,balance_after,service_id,actor_user_id,idempotency_key) values(v_account.id,v_account.organisation_id,'usage',-p_quantity,v_balance-p_quantity,p_service_id,auth.uid(),p_idempotency_key) returning * into v_entry; return to_jsonb(v_entry); end; $$;

create or replace function public.club_save_promotion_targets(p_promotion_id uuid,p_targets jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_org uuid; v_target jsonb; v_result jsonb:='[]'::jsonb;
begin
  select organisation_id into v_org from public.club_promotions where id=p_promotion_id; if v_org is null or auth.uid() is null or not public.club_has_active_role(v_org,array['gym_admin','owner']) then raise exception 'Promotion administration is not permitted' using errcode='42501'; end if;
  if jsonb_typeof(p_targets)<>'array' then raise exception 'Invalid promotion targets' using errcode='22023'; end if;
  delete from public.club_promotion_targets where promotion_id=p_promotion_id;
  for v_target in select * from jsonb_array_elements(p_targets) loop
    if v_target->>'target_type' not in ('commerce_product','commerce_category','membership_product','membership_initial_charge','service','all_commerce') then raise exception 'Invalid promotion target' using errcode='22023'; end if;
    insert into public.club_promotion_targets(promotion_id,organisation_id,target_type,commerce_product_id,category_key,membership_product_id,service_id,charge_type,target_key)
    values(p_promotion_id,v_org,v_target->>'target_type',(v_target->>'commerce_product_id')::uuid,nullif(v_target->>'category_key',''),(v_target->>'membership_product_id')::uuid,(v_target->>'service_id')::uuid,v_target->>'charge_type',nullif(v_target->>'target_key','')) returning to_jsonb(club_promotion_targets.*) into v_target;
    v_result:=v_result||jsonb_build_array(v_target);
  end loop;
  return v_result;
end; $$;

-- Narrow authoritative redemption primitive. Amounts and units come only from stored effects.
create or replace function public.club_redeem_promotion(p_promotion_id uuid,p_target_type text,p_target_id uuid,p_category_key text,p_charge_type text,p_location_id uuid,p_user_id uuid,p_customer_id uuid,p_order_id uuid,p_membership_id uuid,p_base_amount_minor integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_p public.club_promotions%rowtype; v_e public.club_promotion_effects%rowtype; v_r public.club_promotion_redemptions%rowtype; v_discount integer:=0; v_units integer:=0;
begin
  select * into v_p from public.club_promotions where id=p_promotion_id for update; if not found or auth.uid() is null or v_p.status<>'active' or now()<v_p.starts_at or (v_p.ends_at is not null and now()>=v_p.ends_at) then raise exception 'Promotion is not applicable' using errcode='22023'; end if;
  if p_user_id is not null and p_user_id is distinct from auth.uid() and not public.club_has_active_role(v_p.organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Promotion redemption is not permitted' using errcode='42501'; end if;
  if p_customer_id is not null and not exists(select 1 from public.club_customers c where c.id=p_customer_id and c.organisation_id=v_p.organisation_id and (c.user_id=auth.uid() or public.club_has_active_role(v_p.organisation_id,array['gym_staff','gym_admin','owner']))) then raise exception 'Promotion customer is not permitted' using errcode='42501'; end if;
  if p_location_id is not null and cardinality(v_p.location_ids)>0 and not p_location_id=any(v_p.location_ids) then raise exception 'Promotion is not applicable at location' using errcode='22023'; end if;
  if p_idempotency_key is not null then select * into v_r from public.club_promotion_redemptions where organisation_id=v_p.organisation_id and idempotency_key=p_idempotency_key; if found then if v_r.promotion_id<>p_promotion_id or v_r.user_id is distinct from p_user_id or v_r.order_id is distinct from p_order_id then raise exception 'Idempotency key conflict' using errcode='23505'; end if; return to_jsonb(v_r); end if; end if;
  if not exists(select 1 from public.club_promotion_targets t where t.promotion_id=v_p.id and (t.target_type=p_target_type or t.target_type='all_commerce') and (t.commerce_product_id is null or t.commerce_product_id=p_target_id) and (t.membership_product_id is null or t.membership_product_id=p_target_id) and (t.service_id is null or t.service_id=p_target_id) and (t.category_key is null or t.category_key=p_category_key) and (t.charge_type is null or t.charge_type=p_charge_type)) then raise exception 'Promotion target is not applicable' using errcode='22023'; end if;
  for v_e in select * from public.club_promotion_effects where promotion_id=v_p.id loop
    if v_e.effect_type='percentage_discount' then v_discount:=greatest(v_discount,(p_base_amount_minor*v_e.percentage_basis_points)/10000);
    elsif v_e.effect_type='fixed_discount' then v_discount:=greatest(v_discount,least(coalesce(v_e.amount_minor,0),p_base_amount_minor));
    elsif v_e.effect_type='waive_charge' then v_discount:=p_base_amount_minor;
    elsif v_e.effect_type='grant_service_units' then v_units:=v_units+coalesce(v_e.credit_quantity,0); end if;
  end loop;
  insert into public.club_promotion_redemptions(promotion_id,organisation_id,user_id,customer_id,order_id,membership_id,discount_minor,units_granted,location_id,idempotency_key) values(v_p.id,v_p.organisation_id,p_user_id,p_customer_id,p_order_id,p_membership_id,v_discount,v_units,p_location_id,p_idempotency_key) returning * into v_r; return to_jsonb(v_r);
end; $$;

revoke all on function public.club_save_promotion_targets(uuid,jsonb),public.club_redeem_promotion(uuid,text,uuid,text,text,uuid,uuid,uuid,uuid,uuid,integer,text) from public;
grant execute on function public.club_save_promotion_targets(uuid,jsonb),public.club_redeem_promotion(uuid,text,uuid,text,text,uuid,uuid,uuid,uuid,uuid,integer,text) to authenticated;
