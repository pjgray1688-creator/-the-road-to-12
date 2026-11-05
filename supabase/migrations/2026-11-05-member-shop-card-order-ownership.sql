-- Card checkout started from the member shop must create a member-owned order,
-- including when that member also holds an R12 staff role. Staff-created
-- checkout channels continue to use their existing ownership behaviour.

create or replace function public.club_begin_stripe_commerce_attempt(
  p_organisation_id uuid,p_location_id uuid,p_items jsonb,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare order_result jsonb; o public.club_orders%rowtype; a jsonb; v_attempt public.club_payment_attempts%rowtype; item record; v_expected integer:=0;
begin
  if auth.uid() is null or nullif(btrim(p_idempotency_key),'') is null then raise exception 'Payment attempt is not valid' using errcode='42501'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Basket is empty' using errcode='22023'; end if;
  for item in select (value->>'product_id')::uuid product_id,(value->>'quantity')::integer quantity
    from jsonb_array_elements(p_items) loop
    if item.quantity is null or item.quantity<1 or item.quantity>50 or not exists(select 1 from public.club_commerce_products p
      where p.id=item.product_id and p.organisation_id=p_organisation_id and p.active
        and p.stripe_merchant_entity='madhouse_products_services'
        and p.stripe_product_id is not null and p.stripe_price_id is not null
        and 'online'=any(p.sales_channels)) then
      raise exception 'Every basket item needs one confirmed Products and Services Stripe route' using errcode='22023';
    end if;
    select v_expected+(p.sell_price_minor*item.quantity) into v_expected from public.club_commerce_products p where p.id=item.product_id and p.organisation_id=p_organisation_id;
  end loop;
  order_result:=public.club_create_commerce_order(p_organisation_id,p_location_id,null,'member_app','GBP',p_items,p_idempotency_key);
  select * into o from public.club_orders where id=(order_result->'order'->>'id')::uuid for update;

  -- club_create_commerce_order intentionally leaves staff-channel orders
  -- unowned. For this member_app RPC only, attach an unowned pending order to
  -- its authenticated creator; never claim another user's or another channel's
  -- order. This also makes same-key retries safe for staff who shop as members.
  if found and o.user_id is null and o.organisation_id=p_organisation_id and o.channel='member_app'
    and o.status='pending_payment' and o.created_by=auth.uid() then
    update public.club_orders set user_id=auth.uid(),updated_at=now()
      where id=o.id and organisation_id=p_organisation_id and user_id is null
        and created_by=auth.uid() and channel='member_app' and status='pending_payment'
      returning * into o;
  end if;
  if not found or o.organisation_id is distinct from p_organisation_id
    or o.user_id is distinct from auth.uid() or o.channel<>'member_app'
    or o.location_id is distinct from p_location_id or o.status<>'pending_payment' then
    raise exception 'Order is not available for payment' using errcode='42501';
  end if;
  if o.discount_minor<>0 or o.total_minor<>v_expected then raise exception 'Stripe checkout is unavailable for discounted or changed basket totals' using errcode='22023'; end if;
  perform public.club_reserve_order_stock(o.id);
  a:=public.club_create_payment_attempt(p_organisation_id,o.id,0,'card',o.total_minor,p_idempotency_key||':stripe');
  select * into v_attempt from public.club_payment_attempts where id=(a->'attempt'->>'id')::uuid for update;
  if v_attempt.stripe_merchant_entity is not null and v_attempt.stripe_merchant_entity<>'madhouse_products_services' then raise exception 'Payment attempt merchant mismatch' using errcode='22023'; end if;
  update public.club_payment_attempts set stripe_merchant_entity='madhouse_products_services' where id=v_attempt.id returning * into v_attempt;
  return jsonb_build_object('order',to_jsonb(o),'attempt',to_jsonb(v_attempt),
    'lines',(select coalesce(jsonb_agg(jsonb_build_object('product_id',p.id,'stripe_product_id',p.stripe_product_id,
      'stripe_price_id',p.stripe_price_id,'quantity',i.quantity,'unit_price_minor',i.unit_price_minor,
      'currency',o.currency) order by i.id),'[]'::jsonb) from public.club_order_items i
      join public.club_commerce_products p on p.id=i.product_id and p.organisation_id=i.organisation_id where i.order_id=o.id));
end; $$;

revoke all on function public.club_begin_stripe_commerce_attempt(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.club_begin_stripe_commerce_attempt(uuid,uuid,jsonb,text) to authenticated;
