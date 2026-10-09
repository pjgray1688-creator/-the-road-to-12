-- Counted operational till closes and atomic reversal for POS service credits.

create table if not exists public.club_till_closes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  location_id uuid not null,
  business_date date not null,
  register_name text not null default 'Main till' check (length(btrim(register_name)) between 1 and 80),
  expected_cash_minor integer not null,
  counted_cash_minor integer not null check (counted_cash_minor >= 0),
  variance_minor integer generated always as (counted_cash_minor - expected_cash_minor) stored,
  notes text check (notes is null or length(notes) <= 500),
  closed_by uuid not null references auth.users(id) on delete restrict,
  closed_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (id, organisation_id),
  unique (organisation_id, location_id, business_date, register_name),
  unique (organisation_id, idempotency_key),
  foreign key (location_id, organisation_id) references public.club_locations(id, organisation_id) on delete restrict
);
create index if not exists club_till_closes_period_idx on public.club_till_closes(organisation_id,location_id,business_date desc);
alter table public.club_till_closes enable row level security;
revoke all on table public.club_till_closes from public,anon,authenticated;
grant select on table public.club_till_closes to authenticated;
drop policy if exists club_till_closes_reconcile_read on public.club_till_closes;
create policy club_till_closes_reconcile_read on public.club_till_closes for select to authenticated
using (public.club_capability_allowed(organisation_id,auth.uid(),'cash.reconcile') and public.club_location_authorized(organisation_id,location_id));

-- A close is a hard cut-off for further cash movements in that location/day.
-- Taking the same period lock as the close function avoids racing an in-flight sale.
create or replace function public.club_guard_closed_till_cash_movement() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare row_json jsonb; org_id uuid; loc_id uuid; order_id uuid; occurred timestamptz; day date; method text; status_value text; purpose text;
begin
  row_json:=to_jsonb(new);
  org_id:=(row_json->>'organisation_id')::uuid;
  status_value:=row_json->>'status';
  if tg_table_name='club_payments' then
    if row_json->>'method'<>'cash' or status_value not in ('paid','partially_refunded','refunded') then return new; end if;
    order_id:=(row_json->>'order_id')::uuid;
    select location_id into loc_id from public.club_orders where id=order_id and organisation_id=org_id;
    occurred:=coalesce((row_json->>'created_at')::timestamptz,now());
  elsif tg_table_name='club_refunds' then
    order_id:=(row_json->>'order_id')::uuid;
    select o.location_id,p.method into loc_id,method from public.club_orders o join public.club_payments p on p.id=(row_json->>'payment_id')::uuid and p.organisation_id=o.organisation_id where o.id=order_id and o.organisation_id=org_id;
    if method is distinct from 'cash' then return new; end if;
    occurred:=coalesce((row_json->>'created_at')::timestamptz,now());
  elsif tg_table_name='club_cash_declarations' then
    purpose:=row_json->>'purpose';
    if status_value<>'confirmed' or purpose='commerce_order' then return new; end if;
    loc_id:=(row_json->>'location_id')::uuid;
    occurred:=coalesce((row_json->>'confirmed_at')::timestamptz,now());
  else
    return new;
  end if;
  if loc_id is null then return new; end if;
  day:=(occurred at time zone 'Europe/London')::date;
  perform pg_advisory_xact_lock(hashtextextended(org_id::text||':'||loc_id::text||':'||day::text||':Main till',0));
  if exists(select 1 from public.club_till_closes c where c.organisation_id=org_id and c.location_id=loc_id and c.business_date=day and c.register_name='Main till') then
    raise exception 'This location and business date have already been closed' using errcode='23514';
  end if;
  return new;
end; $$;
drop trigger if exists club_payments_closed_till_guard on public.club_payments;
create trigger club_payments_closed_till_guard before insert on public.club_payments for each row execute function public.club_guard_closed_till_cash_movement();
drop trigger if exists club_refunds_closed_till_guard on public.club_refunds;
create trigger club_refunds_closed_till_guard before insert on public.club_refunds for each row execute function public.club_guard_closed_till_cash_movement();
drop trigger if exists club_cash_declarations_closed_till_insert_guard on public.club_cash_declarations;
create trigger club_cash_declarations_closed_till_insert_guard before insert on public.club_cash_declarations for each row execute function public.club_guard_closed_till_cash_movement();
drop trigger if exists club_cash_declarations_closed_till_update_guard on public.club_cash_declarations;
create trigger club_cash_declarations_closed_till_update_guard before update on public.club_cash_declarations for each row execute function public.club_guard_closed_till_cash_movement();

create or replace function public.club_calculate_till_expected_cash(p_organisation_id uuid,p_location_id uuid,p_business_date date)
returns integer language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare period_start timestamptz; period_end timestamptz; expected bigint;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'cash.reconcile')
    or not public.club_location_authorized(p_organisation_id,p_location_id) then
    raise exception 'Till reconciliation is not permitted' using errcode='42501';
  end if;
  if p_business_date is null or p_business_date>(now() at time zone 'Europe/London')::date
    or not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then
    raise exception 'Choose an active location and business date' using errcode='22023';
  end if;
  period_start:=p_business_date::timestamp at time zone 'Europe/London';
  period_end:=(p_business_date+1)::timestamp at time zone 'Europe/London';
  select coalesce(sum(x.amount),0)::bigint into expected from (
    select p.amount_minor::bigint as amount
      from public.club_payments p join public.club_orders o on o.id=p.order_id and o.organisation_id=p.organisation_id
      where p.organisation_id=p_organisation_id and o.location_id=p_location_id and p.method='cash'
        and p.status in ('paid','partially_refunded','refunded') and p.created_at>=period_start and p.created_at<period_end
    union all
    select -r.amount_minor::bigint
      from public.club_refunds r join public.club_payments p on p.id=r.payment_id and p.organisation_id=r.organisation_id
      join public.club_orders o on o.id=r.order_id and o.organisation_id=r.organisation_id
      where r.organisation_id=p_organisation_id and o.location_id=p_location_id and p.method='cash'
        and r.created_at>=period_start and r.created_at<period_end
    union all
    select d.declared_amount_minor::bigint
      from public.club_cash_declarations d
      where d.organisation_id=p_organisation_id and d.location_id=p_location_id and d.status='confirmed'
        and d.purpose in ('membership','balance_top_up','other') and d.confirmed_at>=period_start and d.confirmed_at<period_end
  ) x;
  if expected not between -2147483648 and 2147483647 then raise exception 'Expected cash is outside the supported range' using errcode='22003'; end if;
  return expected::integer;
end; $$;

create or replace function public.club_preview_till_close(p_organisation_id uuid,p_location_id uuid,p_business_date date,p_register_name text default 'Main till')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare expected integer; previous public.club_till_closes%rowtype;
begin
  if btrim(coalesce(p_register_name,''))<>'Main till' then raise exception 'Register name is invalid' using errcode='22023'; end if;
  expected:=public.club_calculate_till_expected_cash(p_organisation_id,p_location_id,p_business_date);
  select * into previous from public.club_till_closes where organisation_id=p_organisation_id and location_id=p_location_id
    and business_date=p_business_date and register_name=btrim(p_register_name);
  return jsonb_build_object('expected_cash_minor',expected,'already_closed',found,'close',case when found then to_jsonb(previous) else null end);
end; $$;

create or replace function public.club_complete_till_close(p_organisation_id uuid,p_location_id uuid,p_business_date date,p_register_name text,p_counted_cash_minor integer,p_notes text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_till_closes%rowtype; prior public.club_till_closes%rowtype; expected integer; role_name text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'cash.reconcile')
    or not public.club_location_authorized(p_organisation_id,p_location_id) then raise exception 'Till close is not permitted' using errcode='42501'; end if;
  if p_counted_cash_minor is null or p_counted_cash_minor<0 or p_business_date is null or p_business_date>(now() at time zone 'Europe/London')::date
    or btrim(coalesce(p_register_name,''))<>'Main till'
    or length(coalesce(p_notes,''))>500 or nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>200 then
    raise exception 'Till close details are invalid' using errcode='22023';
  end if;
  select * into prior from public.club_till_closes where organisation_id=p_organisation_id and idempotency_key=btrim(p_idempotency_key);
  if found then
    if prior.location_id<>p_location_id or prior.business_date<>p_business_date or prior.register_name<>btrim(p_register_name) or prior.counted_cash_minor<>p_counted_cash_minor then raise exception 'Till close retry does not match the original submission' using errcode='23505'; end if;
    return to_jsonb(prior);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':'||p_location_id::text||':'||p_business_date::text||':Main till',0));
  select * into prior from public.club_till_closes where organisation_id=p_organisation_id and location_id=p_location_id and business_date=p_business_date and register_name=btrim(p_register_name);
  if found then raise exception 'This register has already been closed for that date' using errcode='23505'; end if;
  expected:=public.club_calculate_till_expected_cash(p_organisation_id,p_location_id,p_business_date);
  select m.role into role_name from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active limit 1;
  insert into public.club_till_closes(organisation_id,location_id,business_date,register_name,expected_cash_minor,counted_cash_minor,notes,closed_by,idempotency_key)
  values(p_organisation_id,p_location_id,p_business_date,btrim(p_register_name),expected,p_counted_cash_minor,nullif(btrim(p_notes),''),auth.uid(),btrim(p_idempotency_key)) returning * into r;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata)
  values(p_organisation_id,auth.uid(),role_name,'cash.till_closed','till_close',r.id,p_location_id,nullif(btrim(p_notes),''),jsonb_build_object('business_date',p_business_date,'register_name',r.register_name,'expected_cash_minor',expected,'counted_cash_minor',p_counted_cash_minor,'variance_minor',r.variance_minor));
  return to_jsonb(r);
end; $$;

-- Keep money and service-credit reversals in the same transaction. A refund
-- for a service order must map exactly to whole unused credit units.
create table if not exists public.club_refund_service_credit_reversals (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  refund_id uuid not null,
  order_item_id uuid not null,
  credit_lot_id uuid not null references public.club_service_credit_lots(id) on delete restrict,
  quantity integer not null check (quantity>0),
  amount_minor integer not null check (amount_minor>=0),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (refund_id,organisation_id) references public.club_refunds(id,organisation_id) on delete restrict,
  foreign key (order_item_id,organisation_id) references public.club_order_items(id,organisation_id) on delete restrict,
  unique (refund_id,credit_lot_id)
);
alter table public.club_refund_service_credit_reversals enable row level security;
revoke all on table public.club_refund_service_credit_reversals from public,anon,authenticated;

create or replace function public.club_get_staff_service_refund_preview(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare o public.club_orders%rowtype; i public.club_order_items%rowtype; total_units bigint; remaining_units bigint; refundable integer; credit_keys integer; units integer;
begin
  select * into o from public.club_orders where id=p_order_id;
  if not found or auth.uid() is null or not public.club_capability_allowed(o.organisation_id,auth.uid(),'refunds.issue')
    or o.channel not in ('staff_checkout','quick_sale') or not public.club_location_authorized(o.organisation_id,o.location_id) then
    raise exception 'Service refund preview is not available' using errcode='42501';
  end if;
  if (select count(*) from public.club_order_items x where x.order_id=o.id and x.organisation_id=o.organisation_id and not x.stock_tracked)<>1
    or exists(select 1 from public.club_order_items x where x.order_id=o.id and x.organisation_id=o.organisation_id and x.stock_tracked) then
    return jsonb_build_object('eligible',false,'reason','This receipt combines services or retail items; it cannot be safely refunded as one service purchase.');
  end if;
  select * into i from public.club_order_items x where x.order_id=o.id and x.organisation_id=o.organisation_id and not x.stock_tracked;
  select coalesce(sum(l.original_quantity),0),coalesce(sum(l.remaining_quantity),0),count(distinct l.credit_key),count(distinct l.unit)
    into total_units,remaining_units,credit_keys,units from public.club_service_credit_lots l
    where l.organisation_id=o.organisation_id and l.source_type='purchased' and l.source_reference=i.id::text;
  if total_units<=0 or credit_keys<>1 or units<>1 then return jsonb_build_object('eligible',false,'reason','This service purchase has no safely linked refundable credits.'); end if;
  refundable:=floor(i.line_total_minor::numeric*remaining_units/total_units)::integer;
  return jsonb_build_object('eligible',refundable>0,'reason',case when refundable>0 then null else 'No unused credits remain to refund.' end,
    'refundable_minor',refundable,'remaining_units',remaining_units,'unit',coalesce((select l.unit from public.club_service_credit_lots l where l.organisation_id=o.organisation_id and l.source_type='purchased' and l.source_reference=i.id::text limit 1),'credit'),
    'product_name',i.product_name);
end; $$;

create or replace function public.club_issue_staff_refund(
  p_payment_id uuid,p_amount_minor integer,p_reason text,p_external_reference text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  p public.club_payments%rowtype; o public.club_orders%rowtype; r public.club_refunds%rowtype;
  existing_refund public.club_refunds%rowtype; account public.club_balance_accounts%rowtype;
  item public.club_order_items%rowtype; lot public.club_service_credit_lots%rowtype;
  already_refunded integer; available_balance integer; service_count integer; retail_count integer;
  original_units bigint; remaining_units bigint; reverse_units integer; units_left integer; credit_keys integer; credit_units integer;
  per_lot integer; allocation_amount integer; units_before bigint; refundable integer; candidate_units integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_amount_minor is null or p_amount_minor<=0 or nullif(btrim(p_reason),'') is null or length(btrim(p_reason))>240
    or nullif(btrim(p_idempotency_key),'') is null or length(btrim(p_idempotency_key))>200 or length(coalesce(p_external_reference,''))>200 then
    raise exception 'Invalid refund details' using errcode='22023';
  end if;
  select * into p from public.club_payments where id=p_payment_id for update;
  if not found then raise exception 'Payment not found' using errcode='P0002'; end if;
  if not public.club_capability_allowed(p.organisation_id,auth.uid(),'refunds.issue') then raise exception 'Refund permission required' using errcode='42501'; end if;
  select * into o from public.club_orders where id=p.order_id and organisation_id=p.organisation_id for update;
  if not found then raise exception 'Order not found' using errcode='P0002'; end if;
  if o.channel not in ('staff_checkout','quick_sale') or o.location_id is null then raise exception 'Only located POS sales can be refunded here' using errcode='22023'; end if;
  if not public.club_location_authorized(o.organisation_id,o.location_id) then raise exception 'Refund is outside your assigned location' using errcode='42501'; end if;
  select * into existing_refund from public.club_refunds where organisation_id=p.organisation_id and idempotency_key=btrim(p_idempotency_key);
  if found then
    if existing_refund.payment_id<>p.id or existing_refund.amount_minor<>p_amount_minor or existing_refund.reason is distinct from btrim(p_reason)
      or existing_refund.external_reference is distinct from nullif(btrim(p_external_reference),'') then raise exception 'Refund idempotency key conflict' using errcode='23505'; end if;
    return to_jsonb(existing_refund);
  end if;
  if p.status not in ('paid','partially_refunded') or o.status not in ('paid','fulfilled','refunded') then raise exception 'Only settled orders can be refunded' using errcode='22023'; end if;
  if p.method not in ('cash','balance') and nullif(btrim(p_external_reference),'') is null then raise exception 'Complete the provider refund first and enter its reference' using errcode='22023'; end if;
  select coalesce(sum(amount_minor),0)::integer into already_refunded from public.club_refunds where payment_id=p.id and organisation_id=p.organisation_id;
  if p_amount_minor>p.amount_minor-already_refunded then raise exception 'Refund exceeds the remaining paid amount' using errcode='22023'; end if;
  select count(*) filter(where not stock_tracked),count(*) filter(where stock_tracked) into service_count,retail_count
    from public.club_order_items where order_id=o.id and organisation_id=o.organisation_id;
  insert into public.club_refunds(payment_id,order_id,organisation_id,amount_minor,reason,external_reference,created_by,idempotency_key)
  values(p.id,o.id,p.organisation_id,p_amount_minor,btrim(p_reason),nullif(btrim(p_external_reference),''),auth.uid(),btrim(p_idempotency_key)) returning * into r;
  if service_count>0 then
    if service_count<>1 or retail_count<>0 then raise exception 'Service and retail items must be refunded on separate receipts' using errcode='22023'; end if;
    select * into item from public.club_order_items where order_id=o.id and organisation_id=o.organisation_id and not stock_tracked for update;
    perform pg_advisory_xact_lock(hashtextextended(o.organisation_id::text||':service-refund:'||item.id::text,0));
    select coalesce(sum(original_quantity),0),coalesce(sum(remaining_quantity),0),count(distinct credit_key),count(distinct unit) into original_units,remaining_units,credit_keys,credit_units
      from public.club_service_credit_lots where organisation_id=o.organisation_id and source_type='purchased' and source_reference=item.id::text;
    if original_units<=0 or credit_keys<>1 or credit_units<>1 or item.line_total_minor<=0 or remaining_units>2147483647 then raise exception 'Service purchase credits cannot be safely linked' using errcode='22023'; end if;
    refundable:=floor(item.line_total_minor::numeric*remaining_units/original_units)::integer;
    if p_amount_minor>refundable then raise exception 'Refund is above the value of unused service units' using errcode='22023'; end if;
    reverse_units:=0;
    for candidate_units in 1..remaining_units::integer loop
      if floor(item.line_total_minor::numeric*remaining_units/original_units)
        - floor(item.line_total_minor::numeric*(remaining_units-candidate_units)/original_units)=p_amount_minor then reverse_units:=candidate_units; end if;
    end loop;
    if reverse_units<=0 or reverse_units>remaining_units then raise exception 'No unused service units remain to reverse' using errcode='22023'; end if;
    units_left:=reverse_units; units_before:=0;
    for lot in select * from public.club_service_credit_lots where organisation_id=o.organisation_id and source_type='purchased' and source_reference=item.id::text and remaining_quantity>0 order by expires_at nulls last,granted_at,id for update loop
      exit when units_left=0;
      per_lot:=least(units_left,lot.remaining_quantity);
      allocation_amount:=floor(p_amount_minor::numeric*(units_before+per_lot)/reverse_units)::integer-floor(p_amount_minor::numeric*units_before/reverse_units)::integer;
      update public.club_service_credit_lots set remaining_quantity=remaining_quantity-per_lot where id=lot.id and organisation_id=o.organisation_id;
      insert into public.club_refund_service_credit_reversals(organisation_id,refund_id,order_item_id,credit_lot_id,quantity,amount_minor,actor_user_id)
      values(o.organisation_id,r.id,item.id,lot.id,per_lot,allocation_amount,auth.uid());
      units_before:=units_before+per_lot; units_left:=units_left-per_lot;
    end loop;
    if units_left<>0 then raise exception 'Service unit balance changed; retry the refund' using errcode='40001'; end if;
  end if;
  if p.method='balance' then
    select * into account from public.club_balance_accounts a where a.organisation_id=o.organisation_id and a.status='active'
      and (a.customer_id=o.customer_id or (o.customer_id is null and a.user_id=o.user_id)) order by case when a.customer_id=o.customer_id then 0 else 1 end limit 1 for update;
    if not found or account.currency<>p.currency then raise exception 'Madhouse Balance account is unavailable' using errcode='P0002'; end if;
    select coalesce(sum(amount_delta_minor),0)::integer into available_balance from public.club_balance_entries where organisation_id=o.organisation_id and account_id=account.id;
    insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,order_id,payment_id,actor_user_id,reason,idempotency_key)
    values(account.id,o.organisation_id,'refund',p_amount_minor,available_balance+p_amount_minor,o.id,p.id,auth.uid(),btrim(p_reason),'refund:'||r.id::text);
  end if;
  update public.club_payments set status=case when already_refunded+p_amount_minor>=p.amount_minor then 'refunded' else 'partially_refunded' end,updated_at=now() where id=p.id and organisation_id=p.organisation_id;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata)
    select o.organisation_id,auth.uid(),m.role,'payment.refund_issued','refund',r.id,o.location_id,btrim(p_reason),
      jsonb_build_object('payment_id',p.id,'order_id',o.id,'amount_minor',p_amount_minor,'payment_method',p.method,'external_reference',nullif(btrim(p_external_reference),''),'service_units_reversed',reverse_units)
    from public.club_members m where m.organisation_id=o.organisation_id and m.user_id=auth.uid() and m.active;
  if not exists(select 1 from public.club_payments x where x.order_id=o.id and x.organisation_id=o.organisation_id and x.status in ('paid','partially_refunded','pending'))
    and exists(select 1 from public.club_refunds x where x.order_id=o.id and x.organisation_id=o.organisation_id) then update public.club_orders set status='refunded',updated_at=now() where id=o.id and organisation_id=o.organisation_id; end if;
  return to_jsonb(r);
end; $$;

revoke all on function public.club_calculate_till_expected_cash(uuid,uuid,date),public.club_preview_till_close(uuid,uuid,date,text),public.club_complete_till_close(uuid,uuid,date,text,integer,text,text),public.club_get_staff_service_refund_preview(uuid) from public,anon;
grant execute on function public.club_calculate_till_expected_cash(uuid,uuid,date),public.club_preview_till_close(uuid,uuid,date,text),public.club_complete_till_close(uuid,uuid,date,text,integer,text,text),public.club_get_staff_service_refund_preview(uuid) to authenticated;
revoke all on function public.club_guard_closed_till_cash_movement() from public,anon,authenticated;
revoke all on function public.club_issue_staff_refund(uuid,integer,text,text,text) from public,anon;
grant execute on function public.club_issue_staff_refund(uuid,integer,text,text,text) to authenticated;
