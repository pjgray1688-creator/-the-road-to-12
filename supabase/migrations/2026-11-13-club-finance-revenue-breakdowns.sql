begin;

-- Explicit product reporting taxonomy. Existing products are intentionally
-- assigned to Uncategorised; no product name inference or historical backfill.
do $$ begin
  if to_regclass('public.club_commerce_products') is null
     or to_regclass('public.club_order_items') is null
     or to_regclass('public.club_orders') is null
     or to_regclass('public.club_balance_accounts') is null
     or to_regclass('public.club_balance_entries') is null
     or to_regclass('public.club_refund_line_allocations') is null
     or to_regclass('public.club_audit_events') is null
     or to_regprocedure('public.club_capability_allowed(uuid,uuid,text)') is null
     or to_regprocedure('public.club_location_authorized(uuid,uuid)') is null
     or to_regprocedure('public.club_has_active_role(uuid,text[])') is null then
    raise exception 'Finance breakdown prerequisites are missing; no objects were changed';
  end if;
end $$;

alter table public.club_commerce_products
  add column if not exists reporting_category text not null default 'uncategorized';
alter table public.club_order_items
  add column if not exists reporting_category text;
do $$ begin
  alter table public.club_commerce_products add constraint club_commerce_products_reporting_category_ck
    check(reporting_category in ('pt_transformation','apparel','supplements','food_drink_consumables','classes','other_products_services','uncategorized'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.club_order_items add constraint club_order_items_reporting_category_ck
    check(reporting_category is null or reporting_category in ('pt_transformation','apparel','supplements','food_drink_consumables','classes','other_products_services','uncategorized'));
exception when duplicate_object then null; end $$;

create or replace function public.club_snapshot_commerce_reporting_category()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.reporting_category is null then
    select p.reporting_category into new.reporting_category from public.club_commerce_products p
      where p.id=new.product_id and p.organisation_id=new.organisation_id;
    new.reporting_category:=coalesce(new.reporting_category,'uncategorized');
  end if;
  return new;
end $$;
drop trigger if exists club_order_item_reporting_category_snapshot on public.club_order_items;
create trigger club_order_item_reporting_category_snapshot before insert on public.club_order_items
for each row execute function public.club_snapshot_commerce_reporting_category();
revoke all on function public.club_snapshot_commerce_reporting_category() from public,anon,authenticated;

create or replace function public.club_set_product_reporting_category_secure(
  p_organisation_id uuid,p_product_id uuid,p_reporting_category text,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_role text; v_old text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then
    raise exception 'Product reporting classification is not permitted' using errcode='42501';
  end if;
  if p_reporting_category not in ('pt_transformation','apparel','supplements','food_drink_consumables','classes','other_products_services','uncategorized')
     or nullif(btrim(p_reason),'') is null or length(p_reason)>240 then
    raise exception 'Product reporting classification is invalid' using errcode='22023';
  end if;
  select reporting_category into v_old from public.club_commerce_products where id=p_product_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Product does not belong to this organisation' using errcode='42501'; end if;
  update public.club_commerce_products set reporting_category=p_reporting_category,updated_at=now()
    where id=p_product_id and organisation_id=p_organisation_id;
  select role into v_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active limit 1;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,reason,metadata)
    values(p_organisation_id,auth.uid(),v_role,'commerce.reporting_category_changed','commerce_product',p_product_id,left(btrim(p_reason),240),jsonb_build_object('from',v_old,'to',p_reporting_category));
  return jsonb_build_object('product_id',p_product_id,'reporting_category',p_reporting_category);
end $$;

create or replace function public.club_list_finance_commerce_category_report_secure(
  p_organisation_id uuid,p_from timestamptz,p_to timestamptz,p_location_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_rows jsonb; v_unallocated_minor bigint; v_unallocated_count bigint; v_excluded_non_gbp bigint;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.view') then
    raise exception 'Finance category report access is not permitted' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_from>p_to then raise exception 'Finance report period is invalid' using errcode='22023'; end if;
  if p_location_id is not null and (not exists(select 1 from public.club_locations l where l.id=p_location_id and l.organisation_id=p_organisation_id) or not public.club_location_authorized(p_organisation_id,p_location_id)) then
    raise exception 'Finance location is outside authorised scope' using errcode='42501';
  end if;
  select count(*) into v_excluded_non_gbp from public.club_orders o where o.organisation_id=p_organisation_id and o.created_at>=p_from and o.created_at<=p_to and o.status in ('paid','fulfilled','refunded') and o.currency<>'GBP' and (p_location_id is null or o.location_id=p_location_id) and (public.club_location_authorized(p_organisation_id,o.location_id) or public.club_has_active_role(p_organisation_id,array['gym_admin','owner']));
  select coalesce(sum(greatest(0,r.amount_minor-coalesce(a.allocated_minor,0))),0),count(*) filter(where r.amount_minor>coalesce(a.allocated_minor,0)) into v_unallocated_minor,v_unallocated_count from public.club_refunds r join public.club_orders o on o.id=r.order_id and o.organisation_id=r.organisation_id left join lateral (select sum(x.amount_minor)::bigint allocated_minor from public.club_refund_line_allocations x where x.refund_id=r.id and x.organisation_id=r.organisation_id) a on true where r.organisation_id=p_organisation_id and r.created_at>=p_from and r.created_at<=p_to and (p_location_id is null or o.location_id=p_location_id) and (public.club_location_authorized(p_organisation_id,o.location_id) or public.club_has_active_role(p_organisation_id,array['gym_admin','owner']));
  with eligible_orders as (
    select o.id,o.organisation_id,o.location_id,o.subtotal_minor,o.total_minor,o.created_at
    from public.club_orders o
    where o.organisation_id=p_organisation_id and o.created_at>=p_from and o.created_at<=p_to
      and o.status in ('paid','fulfilled','refunded') and o.currency='GBP' and (p_location_id is null or o.location_id=p_location_id)
      and (public.club_location_authorized(p_organisation_id,o.location_id) or public.club_has_active_role(p_organisation_id,array['gym_admin','owner']))
  ), line_values as (
    select i.id item_id,i.organisation_id,i.order_id,coalesce(i.reporting_category,'uncategorized') category,
      case when o.subtotal_minor=0 then 0 else floor(i.line_total_minor::numeric*o.total_minor/o.subtotal_minor)::integer end allocated_minor,
      o.total_minor,i.created_at,
      row_number() over(partition by o.id order by i.created_at,i.id) line_no,
      count(*) over(partition by o.id) line_count,
      sum(case when o.subtotal_minor=0 then 0 else floor(i.line_total_minor::numeric*o.total_minor/o.subtotal_minor)::integer end) over(partition by o.id) allocated_sum
    from eligible_orders o join public.club_order_items i on i.order_id=o.id and i.organisation_id=o.organisation_id
  ), category_sales as (
    select category,sum(allocated_minor + case when line_no=line_count then total_minor-allocated_sum else 0 end)::bigint sales_minor
    from line_values group by category
  ), category_refunds as (
    select coalesce(i.reporting_category,'uncategorized') category,sum(a.amount_minor)::bigint refund_minor
    from public.club_refund_line_allocations a
    join public.club_refunds r on r.id=a.refund_id and r.organisation_id=a.organisation_id
    join public.club_order_items i on i.id=a.order_item_id and i.organisation_id=a.organisation_id
    join public.club_orders o on o.id=r.order_id and o.organisation_id=r.organisation_id
    where r.organisation_id=p_organisation_id and r.created_at>=p_from and r.created_at<=p_to
      and (p_location_id is null or o.location_id=p_location_id)
      and (public.club_location_authorized(p_organisation_id,o.location_id) or public.club_has_active_role(p_organisation_id,array['gym_admin','owner']))
    group by coalesce(i.reporting_category,'uncategorized')
  ), categories as (
    select category from category_sales union select category from category_refunds
  )
  select coalesce(jsonb_agg(jsonb_build_object('category',c.category,'sales_minor',coalesce(s.sales_minor,0),'refund_minor',coalesce(r.refund_minor,0),'net_minor',coalesce(s.sales_minor,0)-coalesce(r.refund_minor,0)) order by c.category),'[]'::jsonb)
    into v_rows from categories c left join category_sales s using(category) left join category_refunds r using(category);
  return jsonb_build_object('from',p_from,'to',p_to,'location_id',p_location_id,'currency','GBP','basis','paid order sales by order creation time; line refunds by refund time','categories',v_rows,'unallocated_refunds_minor',v_unallocated_minor,'unallocated_refunds_count',v_unallocated_count,'excluded_non_gbp_orders',v_excluded_non_gbp,'historical_uncategorised_remains_uncategorised',true);
end $$;

create or replace function public.club_list_finance_madhouse_balance_secure(
  p_organisation_id uuid,p_from timestamptz,p_to timestamptz
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.view') then
    raise exception 'Madhouse Balance reporting access is not permitted' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_from>p_to then raise exception 'Finance report period is invalid' using errcode='22023'; end if;
  with ledger as (
    select e.account_id,e.entry_type,e.amount_delta_minor,e.created_at,a.currency,a.status
    from public.club_balance_entries e join public.club_balance_accounts a on a.id=e.account_id and a.organisation_id=e.organisation_id
    where e.organisation_id=p_organisation_id and a.currency='GBP'
  ), liability as (
    select a.id account_id,coalesce(sum(e.amount_delta_minor) filter(where e.created_at<=p_to),0)::bigint amount_minor
    from public.club_balance_accounts a left join ledger e on e.account_id=a.id
    where a.organisation_id=p_organisation_id and a.currency='GBP'
    group by a.id
  )
  select jsonb_build_object(
    'spent_minor',coalesce((select -sum(amount_delta_minor)::bigint from ledger where entry_type='purchase' and amount_delta_minor<0 and created_at between p_from and p_to),0),
    'topups_minor',coalesce((select sum(amount_delta_minor)::bigint from ledger where entry_type='top_up' and amount_delta_minor>0 and created_at between p_from and p_to),0),
    'expired_adjusted_minor',coalesce((select sum(amount_delta_minor)::bigint from ledger where entry_type in ('expiry','adjustment','manual_credit','manual_debit') and created_at between p_from and p_to),0),
    'unspent_minor',coalesce((select sum(greatest(amount_minor,0))::bigint from liability),0),
    'currency','GBP','as_of',p_to,'venue_scoped',false,
    'other_currency_accounts',(select count(*) from public.club_balance_accounts a where a.organisation_id=p_organisation_id and a.currency<>'GBP')
  ) into v_result;
  return v_result;
end $$;

create or replace function public.club_management_list_reporting_products_secure(p_organisation_id uuid,p_search text default null,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_rows jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then
    raise exception 'Product classification management is not permitted' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'sku',p.sku,'reporting_category',p.reporting_category) order by p.name),'[]'::jsonb)
    into v_rows from (select id,name,sku,reporting_category from public.club_commerce_products
      where organisation_id=p_organisation_id and active and (nullif(btrim(p_search),'') is null or name ilike '%'||left(btrim(p_search),80)||'%' or sku ilike '%'||left(btrim(p_search),80)||'%')
      order by name limit greatest(1,least(coalesce(p_limit,100),200))) p;
  return v_rows;
end $$;

revoke all on function public.club_set_product_reporting_category_secure(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.club_management_list_reporting_products_secure(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.club_list_finance_commerce_category_report_secure(uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.club_list_finance_madhouse_balance_secure(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.club_set_product_reporting_category_secure(uuid,uuid,text,text) to authenticated;
grant execute on function public.club_management_list_reporting_products_secure(uuid,text,integer) to authenticated;
grant execute on function public.club_list_finance_commerce_category_report_secure(uuid,timestamptz,timestamptz,uuid) to authenticated;
grant execute on function public.club_list_finance_madhouse_balance_secure(uuid,timestamptz,timestamptz) to authenticated;

commit;
