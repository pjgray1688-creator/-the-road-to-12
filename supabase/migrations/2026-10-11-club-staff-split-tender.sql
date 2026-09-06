-- Atomic staff Balance + Cash settlement.  This is a pending migration and
-- must be applied after the existing Club commerce and Balance migrations.
create or replace function public.club_ensure_balance_account(p_organisation_id uuid,p_customer_id uuid,p_currency text)
returns public.club_balance_accounts language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_balance_accounts%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then raise exception 'Balance access denied' using errcode='42501'; end if;
  select * into r from public.club_balance_accounts where organisation_id=p_organisation_id and customer_id=p_customer_id for update;
  if not found then insert into public.club_balance_accounts(organisation_id,customer_id,currency) values(p_organisation_id,p_customer_id,p_currency) returning * into r; end if;
  return r;
end; $$;
revoke all on function public.club_ensure_balance_account(uuid,uuid,text) from public,anon;
grant execute on function public.club_ensure_balance_account(uuid,uuid,text) to authenticated;

create or replace function public.club_staff_settle_split_payment(
  p_order_id uuid,
  p_balance_minor integer,
  p_cash_minor integer,
  p_idempotency_key text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_order public.club_orders%rowtype;
  v_account public.club_balance_accounts%rowtype;
  v_entry public.club_balance_entries%rowtype;
  v_balance integer;
  v_item public.club_order_items%rowtype;
  v_existing_balance public.club_payments%rowtype;
  v_existing_cash public.club_payments%rowtype;
begin
  select * into v_order from public.club_orders where id=p_order_id for update;
  if not found then raise exception 'Order not found' using errcode='P0002'; end if;
  if auth.uid() is null or not public.club_capability_allowed(v_order.organisation_id,auth.uid(),'payments.record_cash') then
    raise exception 'Split settlement is not permitted' using errcode='42501';
  end if;
  if p_balance_minor < 0 or p_cash_minor < 0 or p_balance_minor + p_cash_minor <> v_order.total_minor
     or v_order.total_minor <= 0 or coalesce(length(btrim(p_idempotency_key)),0)=0 then
    raise exception 'Split payment amount is invalid' using errcode='22023';
  end if;
  select * into v_existing_balance from public.club_payments
    where order_id=v_order.id and organisation_id=v_order.organisation_id
      and external_reference=p_idempotency_key||':balance';
  select * into v_existing_cash from public.club_payments
    where order_id=v_order.id and organisation_id=v_order.organisation_id
      and external_reference=p_idempotency_key||':cash';
  if v_existing_balance.id is not null or v_existing_cash.id is not null then
    if v_order.status='paid' and ((p_balance_minor=0 and v_existing_balance.id is null) or (p_balance_minor>0 and v_existing_balance.id is null) or (p_cash_minor=0 and v_existing_cash.id is null) or (p_cash_minor>0 and v_existing_cash.id is null)) then
      raise exception 'Split payment idempotency conflict' using errcode='23505';
    end if;
    if v_order.status='paid' then return jsonb_build_object('status','paid','order_id',v_order.id,'replayed',true); end if;
    raise exception 'Split payment is not awaiting settlement' using errcode='22023';
  end if;
  if v_order.status<>'pending_payment' or v_order.customer_id is null then
    raise exception 'Order is not eligible for split payment' using errcode='22023';
  end if;
  if p_balance_minor > 0 then
    select * into v_account from public.club_balance_accounts where organisation_id=v_order.organisation_id and customer_id=v_order.customer_id for update;
    if not found then raise exception 'Balance account not found' using errcode='P0002'; end if;
    v_balance:=coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=v_account.id),0);
    if v_balance < p_balance_minor then raise exception 'Insufficient organisation balance' using errcode='22023'; end if;
    insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,order_id,actor_user_id,idempotency_key)
      values(v_account.id,v_order.organisation_id,'purchase',-p_balance_minor,v_balance-p_balance_minor,v_order.id,auth.uid(),p_idempotency_key||':balance') returning * into v_entry;
    insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status)
      values(v_order.id,v_order.organisation_id,'balance',p_idempotency_key||':balance',p_balance_minor,v_order.currency,'paid');
  end if;
  if p_cash_minor > 0 then
    insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status)
      values(v_order.id,v_order.organisation_id,'cash',p_idempotency_key||':cash',p_cash_minor,v_order.currency,'paid');
  end if;
  update public.club_orders set status='paid',updated_at=now() where id=v_order.id;
  for v_item in select * from public.club_order_items where order_id=v_order.id and stock_tracked loop
    insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key)
      values(v_order.organisation_id,v_order.location_id,v_item.product_id,'sale',-v_item.quantity,v_order.id,auth.uid(),p_idempotency_key||':'||v_item.id)
      on conflict (organisation_id,idempotency_key) where idempotency_key is not null do nothing;
  end loop;
  perform public.club_finalize_paid_order(v_order.id,auth.uid());
  return jsonb_build_object('status','paid','order_id',v_order.id,'balance_minor',p_balance_minor,'cash_minor',p_cash_minor);
end; $$;

revoke all on function public.club_staff_settle_split_payment(uuid,integer,integer,text) from public,anon;
grant execute on function public.club_staff_settle_split_payment(uuid,integer,integer,text) to authenticated;
