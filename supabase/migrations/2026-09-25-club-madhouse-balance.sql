-- Madhouse Balance operational top-ups and staff checkout settlement.
-- Execute only after the already-live Club commerce migrations.

create or replace function public.club_record_balance_cash_top_up(
  p_organisation_id uuid, p_location_id uuid, p_customer_id uuid,
  p_amount_minor integer, p_currency text, p_idempotency_key text, p_notes text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_customer public.club_customers%rowtype; v_account public.club_balance_accounts%rowtype; v_entry public.club_balance_entries%rowtype; v_existing public.club_balance_entries%rowtype;
begin
  -- The cash declaration is the top-up payment event; club_payments requires an order and is intentionally not used for non-order credit.
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id, auth.uid(), 'payments.record_cash') then raise exception 'Cash top-up is not permitted' using errcode='42501'; end if;
  if p_amount_minor <= 0 or p_currency !~ '^[A-Z]{3}$' or p_customer_id is null or p_location_id is null or coalesce(length(btrim(p_idempotency_key)),0)=0 then raise exception 'Invalid balance top-up' using errcode='22023'; end if;
  select * into v_customer from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id for share;
  if not found then raise exception 'Member not found' using errcode='P0002'; end if;
  if exists(select 1 from public.club_cash_declarations where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key) then
    select to_jsonb(e) into v_existing from public.club_balance_entries e where e.organisation_id=p_organisation_id and e.idempotency_key=p_idempotency_key;
    if v_existing is not null then return v_existing; end if;
  end if;
  select * into v_account from public.club_balance_accounts where organisation_id=p_organisation_id and customer_id=p_customer_id for update;
  if not found then insert into public.club_balance_accounts(organisation_id,customer_id,user_id,currency) values(p_organisation_id,p_customer_id,v_customer.user_id,p_currency) returning * into v_account; end if;
  if v_account.currency<>p_currency or v_account.status<>'active' then raise exception 'Balance account is unavailable' using errcode='22023'; end if;
  insert into public.club_cash_declarations(organisation_id,location_id,purpose,user_id,customer_id,declared_amount_minor,currency,status,confirmed_at,confirmed_by,notes,idempotency_key)
    values(p_organisation_id,p_location_id,'balance_top_up',v_customer.user_id,p_customer_id,p_amount_minor,p_currency,'confirmed',now(),auth.uid(),p_notes,p_idempotency_key);
  insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,actor_user_id,reason,idempotency_key)
    values(v_account.id,p_organisation_id,'top_up',p_amount_minor,(select coalesce(sum(amount_delta_minor),0) from public.club_balance_entries where account_id=v_account.id)+p_amount_minor,auth.uid(),coalesce(p_notes,'Cash top-up'),p_idempotency_key) returning * into v_entry;
  return to_jsonb(v_entry);
end; $$;

create or replace function public.club_staff_spend_balance(p_order_id uuid,p_amount_minor integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.club_orders%rowtype; v_account public.club_balance_accounts%rowtype; v_entry public.club_balance_entries%rowtype; v_existing public.club_balance_entries%rowtype; v_balance integer; v_item public.club_order_items%rowtype;
begin
  select * into v_order from public.club_orders where id=p_order_id for update; if not found then raise exception 'Order not found' using errcode='P0002'; end if;
  if auth.uid() is null or not public.club_capability_allowed(v_order.organisation_id,auth.uid(),'payments.record_cash') then raise exception 'Balance sale is not permitted' using errcode='42501'; end if;
  if v_order.customer_id is null or v_order.status<>'pending_payment' or p_amount_minor<>v_order.total_minor or p_amount_minor<=0 or coalesce(length(btrim(p_idempotency_key)),0)=0 then raise exception 'Order is not eligible for balance payment' using errcode='22023'; end if;
  select * into v_account from public.club_balance_accounts where organisation_id=v_order.organisation_id and customer_id=v_order.customer_id for update; if not found then raise exception 'Balance account not found' using errcode='P0002'; end if;
  select * into v_existing from public.club_balance_entries where organisation_id=v_order.organisation_id and idempotency_key=p_idempotency_key; if found then return to_jsonb(v_existing); end if;
  v_balance:=coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=v_account.id),0); if v_balance<p_amount_minor then raise exception 'Insufficient organisation balance' using errcode='22023'; end if;
  insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,order_id,actor_user_id,idempotency_key) values(v_account.id,v_order.organisation_id,'purchase',-p_amount_minor,v_balance-p_amount_minor,v_order.id,auth.uid(),p_idempotency_key) returning * into v_entry;
  insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status) values(v_order.id,v_order.organisation_id,'balance',p_idempotency_key,p_amount_minor,v_order.currency,'paid');
  for v_item in select * from public.club_order_items where order_id=v_order.id and stock_tracked loop
    insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key) values(v_order.organisation_id,v_order.location_id,v_item.product_id,'sale',-v_item.quantity,v_order.id,auth.uid(),p_idempotency_key||':'||v_item.id) on conflict (organisation_id,idempotency_key) do nothing;
  end loop;
  update public.club_orders set status='paid',updated_at=now() where id=v_order.id;
  return to_jsonb(v_entry);
end; $$;

revoke all on function public.club_record_balance_cash_top_up(uuid,uuid,uuid,integer,text,text,text) from public,anon;
revoke all on function public.club_staff_spend_balance(uuid,integer,text) from public,anon;
grant execute on function public.club_record_balance_cash_top_up(uuid,uuid,uuid,integer,text,text,text) to authenticated;
grant execute on function public.club_staff_spend_balance(uuid,integer,text) to authenticated;
