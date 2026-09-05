-- R12 Promotions Engine: durable configuration, historical evidence and Golden Ticket concurrency.
-- Review/install manually; this migration seeds no offers and makes no provider calls.

create table if not exists public.club_promotion_applied_orders (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  order_id uuid not null references public.club_orders(id) on delete cascade,
  promotion_id uuid not null references public.club_promotions(id) on delete restrict,
  promotion_name text not null,
  gross_minor integer not null check (gross_minor >= 0),
  saving_minor integer not null check (saving_minor >= 0),
  net_minor integer not null check (net_minor >= 0),
  applied_snapshot jsonb not null default '{}' check (jsonb_typeof(applied_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (organisation_id, order_id, promotion_id)
);
create index if not exists club_promotion_applied_orders_order_idx on public.club_promotion_applied_orders(organisation_id, order_id);

create table if not exists public.club_golden_ticket_redemptions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  promotion_id uuid not null references public.club_promotions(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  customer_id uuid,
  calendar_month date not null,
  order_id uuid not null references public.club_orders(id) on delete restrict,
  candidate_snapshot jsonb not null check (jsonb_typeof(candidate_snapshot) = 'object'),
  saving_minor integer not null check (saving_minor > 0),
  consumed_at timestamptz not null default now(),
  unique (organisation_id, promotion_id, user_id, calendar_month),
  unique (organisation_id, promotion_id, customer_id, calendar_month)
);
create index if not exists club_golden_ticket_redemptions_order_idx on public.club_golden_ticket_redemptions(organisation_id, order_id);

alter table public.club_promotion_applied_orders enable row level security;
alter table public.club_golden_ticket_redemptions enable row level security;
revoke all on table public.club_promotion_applied_orders, public.club_golden_ticket_redemptions from public, anon, authenticated;
grant select on table public.club_promotion_applied_orders, public.club_golden_ticket_redemptions to authenticated;
create policy club_promotion_applied_orders_staff on public.club_promotion_applied_orders for select to authenticated using (public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create policy club_golden_ticket_redemptions_staff on public.club_golden_ticket_redemptions for select to authenticated using (public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']) or user_id=auth.uid());

-- Lifecycle is configuration plus time; a future-dated row is never economically active.
create or replace function public.club_promotion_lifecycle(p_status text, p_starts_at timestamptz, p_ends_at timestamptz, p_now timestamptz default now())
returns text language sql immutable as $$
  select case when p_status in ('paused','expired','draft') then p_status
    when p_ends_at is not null and p_now >= p_ends_at then 'expired'
    when p_now < p_starts_at then 'scheduled'
    else 'active' end
$$;

-- Authoritative promotion evaluation for checkout. Inputs are intent only; product prices are read from canonical catalogue rows.
create or replace function public.club_evaluate_commerce_promotions(p_organisation_id uuid, p_location_id uuid, p_user_id uuid, p_customer_id uuid, p_items jsonb, p_payment_method text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_item jsonb; v_product public.club_commerce_products%rowtype; v_gross integer:=0; v_discount integer:=0; v_effect public.club_promotion_effects%rowtype; v_p public.club_promotions%rowtype; v_line integer; v_applied jsonb:='[]'::jsonb;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['member','trainer','gym_staff','gym_admin','owner']) then raise exception 'Promotion evaluation is not permitted' using errcode='42501'; end if;
  if p_user_id is not null and p_user_id is distinct from auth.uid() and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Customer is not associated with caller' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_items,'[]')) <> 'array' then raise exception 'Invalid basket' using errcode='22023'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from public.club_commerce_products where id=(v_item->>'product_id')::uuid and organisation_id=p_organisation_id and active;
    if not found or coalesce((v_item->>'quantity')::integer,0) <= 0 then raise exception 'Product is not sellable' using errcode='22023'; end if;
    v_line := v_product.sell_price_minor * (v_item->>'quantity')::integer; v_gross := v_gross + v_line;
  end loop;
  for v_p in select * from public.club_promotions where organisation_id=p_organisation_id and status='active' and now() >= starts_at and (ends_at is null or now() < ends_at) and (cardinality(location_ids)=0 or p_location_id = any(location_ids)) order by coalesce((eligibility->>'priority')::integer,0) desc, id loop
    select * into v_effect from public.club_promotion_effects where promotion_id=v_p.id order by id limit 1;
    if v_effect.effect_type='percentage_discount' then v_line := floor(v_gross * v_effect.percentage_basis_points / 10000); elsif v_effect.effect_type='fixed_discount' then v_line := v_effect.amount_minor; elsif v_effect.effect_type='waive_charge' then v_line := 0; else v_line := 0; end if;
    v_line := least(v_gross, greatest(0, coalesce(v_line,0))); if v_line > v_discount then v_discount := v_line; v_applied := jsonb_build_array(jsonb_build_object('promotion_id',v_p.id,'promotion_name',v_p.name,'saving_minor',v_line,'effect_type',v_effect.effect_type)); end if;
  end loop;
  return jsonb_build_object('gross_minor',v_gross,'discount_minor',v_discount,'total_minor',greatest(0,v_gross-v_discount),'applied',v_applied,'payment_method',p_payment_method);
end; $$;
revoke all on function public.club_evaluate_commerce_promotions(uuid,uuid,uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.club_evaluate_commerce_promotions(uuid,uuid,uuid,uuid,jsonb,text) to authenticated;

-- Golden Ticket consumption is intentionally callable only by trusted finalisation code (service role).
create or replace function public.club_consume_golden_ticket(p_organisation_id uuid,p_promotion_id uuid,p_user_id uuid,p_customer_id uuid,p_order_id uuid,p_candidate jsonb,p_saving_minor integer,p_calendar_month date default date_trunc('month',now())::date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_golden_ticket_redemptions%rowtype;
begin
  if auth.uid() is not null then raise exception 'Trusted finalisation required' using errcode='42501'; end if;
  if p_saving_minor <= 0 or p_candidate is null or p_order_id is null then raise exception 'Invalid Golden Ticket redemption' using errcode='22023'; end if;
  if not exists(select 1 from public.club_orders where id=p_order_id and organisation_id=p_organisation_id and status in ('paid','fulfilled') and total_minor >= 0) then raise exception 'Order is not complete' using errcode='22023'; end if;
  insert into public.club_golden_ticket_redemptions(organisation_id,promotion_id,user_id,customer_id,calendar_month,order_id,candidate_snapshot,saving_minor) values(p_organisation_id,p_promotion_id,p_user_id,p_customer_id,p_calendar_month,p_order_id,p_candidate,p_saving_minor) on conflict do nothing returning * into v_row;
  if not found then select * into v_row from public.club_golden_ticket_redemptions where organisation_id=p_organisation_id and promotion_id=p_promotion_id and calendar_month=p_calendar_month and ((p_user_id is not null and user_id=p_user_id) or (p_customer_id is not null and customer_id=p_customer_id)) limit 1; end if;
  return to_jsonb(v_row);
end; $$;
revoke all on function public.club_consume_golden_ticket(uuid,uuid,uuid,uuid,uuid,jsonb,integer,date) from public,anon,authenticated;
