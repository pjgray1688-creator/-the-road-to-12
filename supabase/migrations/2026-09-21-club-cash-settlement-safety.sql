-- Defer member cash-declaration stock effects until staff confirmation.
-- Review and execute in the target environment; do not run from the application.
create or replace function public.club_declare_cash_payment(p_organisation_id uuid,p_location_id uuid,p_purpose text,p_user_id uuid,p_customer_id uuid,p_order_id uuid,p_membership_id uuid,p_amount_minor integer,p_currency text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_cash_declarations%rowtype; v_order public.club_orders%rowtype;
begin
  if auth.uid() is null or p_amount_minor<=0 or p_currency !~ '^[A-Z]{3}$' or p_purpose not in ('commerce_order','membership','balance_top_up','other') or p_user_id is distinct from auth.uid() then raise exception 'Invalid cash declaration' using errcode='42501'; end if;
  if not public.club_has_active_role(p_organisation_id,array['member','trainer','gym_staff','gym_admin','owner']) then raise exception 'Organisation access is not permitted' using errcode='42501'; end if;
  if p_purpose='commerce_order' then
    if p_order_id is null or p_membership_id is not null then raise exception 'Cash declaration resource is invalid' using errcode='22023'; end if;
    select * into v_order from public.club_orders where id=p_order_id and organisation_id=p_organisation_id and user_id=auth.uid() for update;
    if not found or v_order.status<>'pending_payment' or v_order.total_minor<>p_amount_minor or v_order.currency<>p_currency or p_location_id is distinct from v_order.location_id then raise exception 'Order is not eligible for cash declaration' using errcode='22023'; end if;
  elsif p_purpose='membership' then
    if p_membership_id is null or p_order_id is not null or not exists(select 1 from public.club_membership_holders h join public.club_memberships m on m.id=h.membership_id and m.organisation_id=p_organisation_id where h.membership_id=p_membership_id and h.user_id=auth.uid()) then raise exception 'Membership is not associated with caller' using errcode='42501'; end if;
  elsif p_purpose='balance_top_up' then
    if p_order_id is not null or p_membership_id is not null then raise exception 'Cash declaration resource is invalid' using errcode='22023'; end if;
  elsif p_order_id is not null or p_membership_id is not null then raise exception 'Cash declaration resource is invalid' using errcode='22023'; end if;
  if p_customer_id is not null and not exists(select 1 from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id and user_id=auth.uid()) then raise exception 'Customer is not associated with caller' using errcode='42501'; end if;
  if p_idempotency_key is not null then select * into v_row from public.club_cash_declarations where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then if v_row.user_id is distinct from auth.uid() or v_row.order_id is distinct from p_order_id or v_row.declared_amount_minor<>p_amount_minor then raise exception 'Idempotency key conflict' using errcode='23505'; end if; return to_jsonb(v_row); end if; end if;
  insert into public.club_cash_declarations(organisation_id,location_id,purpose,user_id,customer_id,order_id,membership_id,declared_amount_minor,currency,idempotency_key) values(p_organisation_id,p_location_id,p_purpose,auth.uid(),p_customer_id,p_order_id,p_membership_id,p_amount_minor,p_currency,p_idempotency_key) returning * into v_row;
  if p_order_id is not null then update public.club_orders set status='awaiting_cash_verification',updated_at=now() where id=p_order_id; end if;
  return to_jsonb(v_row);
end; $$;

create or replace function public.club_reconcile_cash_declaration(p_declaration_id uuid,p_status text,p_notes text,p_discrepancy_minor integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_cash_declarations%rowtype; v_order public.club_orders%rowtype; v_payment public.club_payments%rowtype; v_item public.club_order_items%rowtype;
begin
  select * into v_row from public.club_cash_declarations where id=p_declaration_id for update; if not found or not public.club_has_active_role(v_row.organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Cash reconciliation is not permitted' using errcode='42501'; end if;
  if v_row.status<> 'declared' then if v_row.status=p_status then return to_jsonb(v_row); else raise exception 'Cash declaration decision conflicts' using errcode='23505'; end if; end if;
  if p_status not in ('confirmed','rejected','discrepancy') then raise exception 'Cash declaration is not reconcilable' using errcode='22023'; end if;
  if v_row.purpose='commerce_order' then
    select * into v_order from public.club_orders where id=v_row.order_id for update;
    if p_status='confirmed' then
      if v_order.status<>'awaiting_cash_verification' then raise exception 'Order is not awaiting cash confirmation' using errcode='22023'; end if;
      insert into public.club_payments(order_id,organisation_id,method,amount_minor,currency,status,external_reference) values(v_order.id,v_order.organisation_id,'cash',v_order.total_minor,v_order.currency,'paid',coalesce(v_row.idempotency_key,v_row.id::text)) returning * into v_payment;
      for v_item in select * from public.club_order_items where order_id=v_order.id and stock_tracked loop
        insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key) values(v_order.organisation_id,v_order.location_id,v_item.product_id,'sale',-v_item.quantity,v_order.id,auth.uid(),'cash-confirmed:'||v_row.id::text||':'||v_item.id::text) on conflict (organisation_id,idempotency_key) do nothing;
      end loop;
      update public.club_orders set status='paid',updated_at=now() where id=v_order.id;
    elsif v_order.status='awaiting_cash_verification' then update public.club_orders set status='cash_disputed',updated_at=now() where id=v_order.id; end if;
  end if;
  update public.club_cash_declarations set status=p_status,confirmed_at=now(),confirmed_by=auth.uid(),notes=p_notes,discrepancy_minor=p_discrepancy_minor,updated_at=now() where id=v_row.id returning * into v_row; return to_jsonb(v_row);
end; $$;
