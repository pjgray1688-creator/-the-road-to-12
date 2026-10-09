-- Staff refund recording for paid retail POS orders. Provider refunds are never
-- simulated: external tenders must already have been returned by their provider.
alter table public.club_refunds add column if not exists idempotency_key text;
create unique index if not exists club_refunds_org_idempotency_uq
  on public.club_refunds(organisation_id,idempotency_key) where idempotency_key is not null;

create or replace function public.club_issue_staff_refund(
  p_payment_id uuid,
  p_amount_minor integer,
  p_reason text,
  p_external_reference text,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  p public.club_payments%rowtype;
  o public.club_orders%rowtype;
  r public.club_refunds%rowtype;
  existing_refund public.club_refunds%rowtype;
  account public.club_balance_accounts%rowtype;
  already_refunded integer;
  available_balance integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_amount_minor is null or p_amount_minor<=0
    or nullif(btrim(p_reason),'') is null or length(btrim(p_reason))>240
    or nullif(btrim(p_idempotency_key),'') is null or length(btrim(p_idempotency_key))>200
    or length(coalesce(p_external_reference,''))>200 then
    raise exception 'Invalid refund details' using errcode='22023';
  end if;

  select * into p from public.club_payments where id=p_payment_id for update;
  if not found then raise exception 'Payment not found' using errcode='P0002'; end if;
  if not public.club_capability_allowed(p.organisation_id,auth.uid(),'refunds.issue') then
    raise exception 'Refund permission required' using errcode='42501';
  end if;
  select * into o from public.club_orders where id=p.order_id and organisation_id=p.organisation_id for update;
  if not found then raise exception 'Order not found' using errcode='P0002'; end if;
  if o.channel not in ('staff_checkout','quick_sale') or o.location_id is null then
    raise exception 'Only located POS sales can be refunded here' using errcode='22023';
  end if;
  if not public.club_location_authorized(o.organisation_id,o.location_id) then
    raise exception 'Refund is outside your assigned location' using errcode='42501';
  end if;

  select * into existing_refund from public.club_refunds
    where organisation_id=p.organisation_id and idempotency_key=btrim(p_idempotency_key);
  if found then
    if existing_refund.payment_id<>p.id or existing_refund.amount_minor<>p_amount_minor
      or existing_refund.reason is distinct from btrim(p_reason)
      or existing_refund.external_reference is distinct from nullif(btrim(p_external_reference),'') then
      raise exception 'Refund idempotency key conflict' using errcode='23505';
    end if;
    return to_jsonb(existing_refund);
  end if;

  if p.status not in ('paid','partially_refunded') or o.status not in ('paid','fulfilled','refunded') then
    raise exception 'Only settled orders can be refunded' using errcode='22023';
  end if;
  -- Do not refund non-stock service/package orders until their service-credit
  -- reversal is part of the same transaction.
  if exists(select 1 from public.club_order_items i where i.order_id=o.id and i.organisation_id=o.organisation_id and not i.stock_tracked) then
    raise exception 'Service refunds require a linked credit adjustment' using errcode='22023';
  end if;
  if p.method not in ('cash','balance') and nullif(btrim(p_external_reference),'') is null then
    raise exception 'Complete the provider refund first and enter its reference' using errcode='22023';
  end if;
  select coalesce(sum(amount_minor),0)::integer into already_refunded
    from public.club_refunds where payment_id=p.id and organisation_id=p.organisation_id;
  if p_amount_minor>p.amount_minor-already_refunded then
    raise exception 'Refund exceeds the remaining paid amount' using errcode='22023';
  end if;

  insert into public.club_refunds(payment_id,order_id,organisation_id,amount_minor,reason,external_reference,created_by,idempotency_key)
  values(p.id,o.id,p.organisation_id,p_amount_minor,btrim(p_reason),nullif(btrim(p_external_reference),''),auth.uid(),btrim(p_idempotency_key))
  returning * into r;

  if p.method='balance' then
    select * into account from public.club_balance_accounts a
      where a.organisation_id=o.organisation_id and a.status='active'
        and (a.customer_id=o.customer_id or (o.customer_id is null and a.user_id=o.user_id))
      order by case when a.customer_id=o.customer_id then 0 else 1 end
      limit 1 for update;
    if not found or account.currency<>p.currency then raise exception 'Madhouse Balance account is unavailable' using errcode='P0002'; end if;
    select coalesce(sum(amount_delta_minor),0)::integer into available_balance
      from public.club_balance_entries where organisation_id=o.organisation_id and account_id=account.id;
    insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,order_id,payment_id,actor_user_id,reason,idempotency_key)
    values(account.id,o.organisation_id,'refund',p_amount_minor,available_balance+p_amount_minor,o.id,p.id,auth.uid(),btrim(p_reason),'refund:'||r.id::text);
  end if;

  update public.club_payments set status=case when already_refunded+p_amount_minor>=p.amount_minor then 'refunded' else 'partially_refunded' end,updated_at=now()
    where id=p.id and organisation_id=p.organisation_id;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata)
    select o.organisation_id,auth.uid(),m.role,'payment.refund_issued','refund',r.id,o.location_id,btrim(p_reason),
      jsonb_build_object('payment_id',p.id,'order_id',o.id,'amount_minor',p_amount_minor,'payment_method',p.method,'external_reference',nullif(btrim(p_external_reference),''))
    from public.club_members m where m.organisation_id=o.organisation_id and m.user_id=auth.uid() and m.active;
  if not exists(select 1 from public.club_payments x where x.order_id=o.id and x.organisation_id=o.organisation_id and x.status in ('paid','partially_refunded','pending'))
    and exists(select 1 from public.club_refunds x where x.order_id=o.id and x.organisation_id=o.organisation_id) then
    update public.club_orders set status='refunded',updated_at=now() where id=o.id and organisation_id=o.organisation_id;
  end if;
  return to_jsonb(r);
end; $$;
revoke all on function public.club_issue_staff_refund(uuid,integer,text,text,text) from public,anon;
grant execute on function public.club_issue_staff_refund(uuid,integer,text,text,text) to authenticated;
