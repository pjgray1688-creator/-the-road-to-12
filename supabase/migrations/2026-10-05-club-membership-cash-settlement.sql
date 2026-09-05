-- Cash membership settlement.  Cash is a billing arrangement/channel, never a shop product.
-- This migration is forward-only and provider-neutral.

alter table public.club_membership_billing_arrangements
  drop constraint if exists club_membership_billing_arrangements_payment_method_family_check;
alter table public.club_membership_billing_arrangements
  add constraint club_membership_billing_arrangements_payment_method_family_check
  check (payment_method_family in ('direct_debit','recurring_card','cash','other'));
alter table public.club_membership_billing_arrangements
  add column if not exists cash_channel text;
alter table public.club_membership_billing_arrangements
  add constraint club_membership_billing_arrangements_cash_channel_check
  check (cash_channel is null or cash_channel in ('staff_counter','member_drop_box'));

alter table public.club_membership_billing_obligations
  drop constraint if exists club_membership_billing_obligations_payment_method_family_check;
alter table public.club_membership_billing_obligations
  add constraint club_membership_billing_obligations_payment_method_family_check
  check (payment_method_family in ('direct_debit','recurring_card','cash','other'));
alter table public.club_membership_billing_obligations
  add column if not exists cash_channel text;
alter table public.club_membership_billing_obligations
  add constraint club_membership_billing_obligations_cash_channel_check
  check (cash_channel is null or cash_channel in ('staff_counter','member_drop_box'));

alter table public.club_cash_declarations add column if not exists obligation_id uuid;
alter table public.club_cash_declarations add column if not exists cash_channel text;
alter table public.club_cash_declarations
  add constraint club_cash_declarations_obligation_fk
  foreign key (obligation_id, organisation_id)
  references public.club_membership_billing_obligations(id, organisation_id);
alter table public.club_cash_declarations
  add constraint club_cash_declarations_cash_channel_check
  check (cash_channel is null or cash_channel in ('staff_counter','member_drop_box'));
create index if not exists club_cash_declarations_obligation_idx on public.club_cash_declarations(organisation_id, obligation_id);

create or replace function public.club_bind_membership_cash_declaration()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.purpose='membership' and new.obligation_id is null then
    select o.id into new.obligation_id
    from public.club_membership_billing_obligations o
    where o.organisation_id=new.organisation_id and o.membership_id=new.membership_id
      and (o.user_id=new.user_id or (new.customer_id is not null and o.customer_id=new.customer_id))
      and o.payment_method_family='cash' and o.state not in ('paid','recovered','cancelled','waived')
      and o.amount_minor=new.declared_amount_minor and o.currency=new.currency
    order by o.next_due_at limit 1;
    if new.obligation_id is null then raise exception 'Membership cash declaration requires an outstanding cash obligation' using errcode='22023'; end if;
  end if;
  if new.purpose='membership' then new.cash_channel:=coalesce(new.cash_channel,'member_drop_box'); end if;
  return new;
end; $$;
drop trigger if exists club_bind_membership_cash_declaration_trigger on public.club_cash_declarations;
create trigger club_bind_membership_cash_declaration_trigger before insert on public.club_cash_declarations for each row execute function public.club_bind_membership_cash_declaration();

-- Keep enrolment provider-neutral while allowing a cash arrangement and its explicit channel.
create or replace function public.club_enrol_membership_billing(p_organisation_id uuid,p_membership_id uuid,p_user_id uuid,p_customer_id uuid,p_provider_type text,p_payment_method_family text,p_amount_minor integer,p_currency text,p_frequency text,p_next_due_at timestamptz,p_provider_customer_reference text,p_provider_subscription_reference text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.club_memberships%rowtype; a public.club_membership_billing_arrangements%rowtype; o public.club_membership_billing_obligations%rowtype; period text; channel text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then raise exception 'Billing administration is not permitted' using errcode='42501'; end if;
  select * into m from public.club_memberships where id=p_membership_id and organisation_id=p_organisation_id for share;
  if not found or not exists(select 1 from public.club_membership_holders where membership_id=m.id and user_id=p_user_id) then raise exception 'Membership billing identity is invalid' using errcode='22023'; end if;
  if p_amount_minor<=0 or p_currency !~ '^[A-Z]{3}$' or p_payment_method_family not in ('direct_debit','recurring_card','cash','other') or p_frequency not in ('weekly','monthly','quarterly','annual','other') or p_next_due_at is null then raise exception 'Invalid billing obligation' using errcode='22023'; end if;
  channel:=case when p_payment_method_family='cash' then 'staff_counter' else null end;
  insert into public.club_membership_billing_arrangements(organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,cash_channel,amount_minor,currency,frequency,next_due_at,provider_customer_reference,provider_subscription_reference)
  values(p_organisation_id,p_membership_id,p_user_id,p_customer_id,p_provider_type,p_payment_method_family,channel,p_amount_minor,p_currency,p_frequency,p_next_due_at,p_provider_customer_reference,p_provider_subscription_reference)
  on conflict (organisation_id,membership_id) do update set user_id=excluded.user_id,customer_id=excluded.customer_id,provider_type=excluded.provider_type,payment_method_family=excluded.payment_method_family,cash_channel=excluded.cash_channel,amount_minor=excluded.amount_minor,currency=excluded.currency,frequency=excluded.frequency,next_due_at=excluded.next_due_at,provider_customer_reference=excluded.provider_customer_reference,provider_subscription_reference=excluded.provider_subscription_reference,state='active',updated_at=now()
  returning * into a;
  period:=to_char(p_next_due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,cash_channel,amount_minor,currency,frequency,next_due_at,period_key)
  values(p_organisation_id,a.id,p_membership_id,p_user_id,p_customer_id,p_provider_type,p_payment_method_family,a.cash_channel,p_amount_minor,p_currency,p_frequency,p_next_due_at,period)
  on conflict (arrangement_id,period_key) do nothing returning * into o;
  if o.id is null then select * into o from public.club_membership_billing_obligations where arrangement_id=a.id and period_key=period; end if;
  return jsonb_build_object('arrangement',to_jsonb(a),'obligation',to_jsonb(o));
end; $$;

-- Shared exact-obligation settlement used by staff counter cash and verification.
create or replace function public.club_record_membership_cash_payment(p_organisation_id uuid,p_obligation_id uuid,p_location_id uuid,p_amount_minor integer,p_currency text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_membership_billing_obligations%rowtype; a public.club_membership_billing_arrangements%rowtype; pay public.club_membership_billing_payments%rowtype; next_due timestamptz; next_period text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.record_cash') then raise exception 'Membership cash payment is not permitted' using errcode='42501'; end if;
  if p_location_id is null or not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) or not public.club_location_authorized(p_organisation_id,p_location_id) then raise exception 'A physical authorised location is required' using errcode='42501'; end if;
  if nullif(btrim(p_idempotency_key),'') is null or p_amount_minor<=0 or p_currency !~ '^[A-Z]{3}$' then raise exception 'Invalid membership cash payment' using errcode='22023'; end if;
  select * into pay from public.club_membership_billing_payments where organisation_id=p_organisation_id and provider_event_key=p_idempotency_key;
  if found then return to_jsonb(pay); end if;
  select * into o from public.club_membership_billing_obligations where id=p_obligation_id and organisation_id=p_organisation_id for update;
  if not found or o.payment_method_family<>'cash' or o.state in ('paid','recovered','cancelled','waived') or p_amount_minor<>o.amount_minor or p_currency<>o.currency then raise exception 'Cash amount does not match an outstanding membership obligation' using errcode='22023'; end if;
  insert into public.club_membership_billing_payments(organisation_id,obligation_id,amount_minor,currency,provider_reference,provider_event_key) values(p_organisation_id,o.id,p_amount_minor,p_currency,'staff-cash:'||p_idempotency_key,p_idempotency_key) returning * into pay;
  update public.club_membership_billing_obligations set state=case when state in ('failed','grace','retry_scheduled','overdue') then 'recovered' else 'paid' end,last_paid_at=now(),last_payment_reference=pay.id::text,failure_reason=null,updated_at=now() where id=o.id;
  select * into a from public.club_membership_billing_arrangements where id=o.arrangement_id and organisation_id=o.organisation_id for update;
  next_due:=public.club_next_membership_billing_due(a.next_due_at,a.frequency);
  if next_due is not null and a.next_due_at<=o.next_due_at then
    next_period:=to_char(next_due at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,cash_channel,amount_minor,currency,frequency,next_due_at,period_key) values(a.organisation_id,a.id,a.membership_id,a.user_id,a.customer_id,a.provider_type,a.payment_method_family,a.cash_channel,a.amount_minor,a.currency,a.frequency,next_due,next_period) on conflict (arrangement_id,period_key) do nothing;
    update public.club_membership_billing_arrangements set next_due_at=next_due,last_successful_payment_at=now(),updated_at=now() where id=a.id;
  end if;
  return jsonb_build_object('payment',to_jsonb(pay),'obligation',(select to_jsonb(x) from public.club_membership_billing_obligations x where x.id=o.id));
end; $$;

-- Explicit member drop-box declaration: it records intent only and never settles.
create or replace function public.club_declare_membership_cash_drop(p_organisation_id uuid,p_obligation_id uuid,p_location_id uuid,p_amount_minor integer,p_currency text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_membership_billing_obligations%rowtype; d public.club_cash_declarations%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['member','trainer','gym_staff','gym_admin','owner']) then raise exception 'Cash declaration is not permitted' using errcode='42501'; end if;
  if p_location_id is null or not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'A physical deposit location is required' using errcode='22023'; end if;
  select * into o from public.club_membership_billing_obligations where id=p_obligation_id and organisation_id=p_organisation_id and user_id=auth.uid() for share;
  if not found or o.payment_method_family<>'cash' or o.state in ('paid','recovered','cancelled','waived') or p_amount_minor<>o.amount_minor or p_currency<>o.currency then raise exception 'Cash declaration does not match an outstanding obligation' using errcode='22023'; end if;
  select * into d from public.club_cash_declarations where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key;
  if found then return to_jsonb(d); end if;
  insert into public.club_cash_declarations(organisation_id,location_id,purpose,user_id,customer_id,membership_id,obligation_id,declared_amount_minor,currency,cash_channel,idempotency_key) values(p_organisation_id,p_location_id,'membership',auth.uid(),o.customer_id,o.membership_id,o.id,p_amount_minor,p_currency,'member_drop_box',p_idempotency_key) returning * into d;
  return to_jsonb(d);
end; $$;

create or replace function public.club_list_customer_billing(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'membership_id',o.membership_id,'amount_minor',o.amount_minor,'currency',o.currency,'next_due_at',o.next_due_at,'state',o.state,'payment_method_family',o.payment_method_family,'cash_channel',o.cash_channel,'failure_reason',o.failure_reason) order by o.next_due_at),'[]'::jsonb)
from public.club_membership_billing_obligations o where o.organisation_id=p_organisation_id and (o.customer_id=p_customer_id or exists(select 1 from public.club_customers c where c.id=p_customer_id and c.organisation_id=o.organisation_id and c.user_id=o.user_id)) and public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take');
$$;

-- Replace the generic reconciliation boundary so a confirmed membership
-- declaration creates a billing payment, while commerce declarations retain
-- their existing order reconciliation behaviour.
create or replace function public.club_reconcile_cash_declaration(p_declaration_id uuid,p_status text,p_notes text,p_discrepancy_minor integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.club_cash_declarations%rowtype; o public.club_membership_billing_obligations%rowtype; pay public.club_membership_billing_payments%rowtype; ord public.club_orders%rowtype; item public.club_order_items%rowtype;
begin
  select * into d from public.club_cash_declarations where id=p_declaration_id for update;
  if not found or not public.club_has_active_role(d.organisation_id,array['gym_staff','gym_admin','owner']) or not public.club_capability_allowed(d.organisation_id,auth.uid(),'cash.reconcile') then raise exception 'Cash reconciliation is not permitted' using errcode='42501'; end if;
  if d.status<>'declared' then if d.status=p_status then return to_jsonb(d); else raise exception 'Cash declaration decision conflicts' using errcode='23505'; end if; end if;
  if p_status not in ('confirmed','rejected','discrepancy') then raise exception 'Cash declaration is not reconcilable' using errcode='22023'; end if;
  if d.purpose='membership' then
    if p_status='confirmed' then
      select * into o from public.club_membership_billing_obligations where id=d.obligation_id and organisation_id=d.organisation_id for update;
      if not found or o.payment_method_family<>'cash' or o.state in ('paid','recovered','cancelled','waived') or o.amount_minor<>d.declared_amount_minor then raise exception 'Membership obligation is not eligible for cash confirmation' using errcode='22023'; end if;
      insert into public.club_membership_billing_payments(organisation_id,obligation_id,amount_minor,currency,provider_reference,provider_event_key) values(d.organisation_id,o.id,d.declared_amount_minor,d.currency,'drop-box:'||d.id,'cash-declaration:'||d.id) on conflict (organisation_id,provider_event_key) do nothing returning * into pay;
      update public.club_membership_billing_obligations set state=case when state in ('failed','grace','retry_scheduled','overdue') then 'recovered' else 'paid' end,last_paid_at=now(),last_payment_reference=coalesce(pay.id::text,'cash-declaration:'||d.id),updated_at=now() where id=o.id;
    end if;
  elsif d.purpose='commerce_order' and p_status='confirmed' then
    select * into ord from public.club_orders where id=d.order_id and organisation_id=d.organisation_id for update;
    if not found or ord.status<>'awaiting_cash_verification' then raise exception 'Order is not awaiting cash confirmation' using errcode='22023'; end if;
    insert into public.club_payments(order_id,organisation_id,method,amount_minor,currency,status,external_reference) values(ord.id,ord.organisation_id,'cash',ord.total_minor,ord.currency,'paid',coalesce(d.idempotency_key,d.id::text)) on conflict do nothing;
    for item in select * from public.club_order_items where order_id=ord.id and stock_tracked loop
      insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key) values(ord.organisation_id,ord.location_id,item.product_id,'sale',-item.quantity,ord.id,auth.uid(),'cash-confirmed:'||d.id::text||':'||item.id::text) on conflict (organisation_id,idempotency_key) do nothing;
    end loop;
    update public.club_orders set status='paid',updated_at=now() where id=ord.id;
  elsif d.purpose='commerce_order' and p_status in ('rejected','discrepancy') then
    update public.club_orders set status='cash_disputed',updated_at=now() where id=d.order_id and organisation_id=d.organisation_id and status='awaiting_cash_verification';
  end if;
  update public.club_cash_declarations set status=p_status,confirmed_at=now(),confirmed_by=auth.uid(),notes=p_notes,discrepancy_minor=p_discrepancy_minor,updated_at=now() where id=d.id returning * into d;
  return to_jsonb(d);
end; $$;

revoke all on function public.club_record_membership_cash_payment(uuid,uuid,uuid,integer,text,text),public.club_declare_membership_cash_drop(uuid,uuid,uuid,integer,text,text),public.club_list_customer_billing(uuid,uuid) from public,anon;
grant execute on function public.club_record_membership_cash_payment(uuid,uuid,uuid,integer,text,text) to authenticated;
grant execute on function public.club_declare_membership_cash_drop(uuid,uuid,uuid,integer,text,text) to authenticated;
grant execute on function public.club_list_customer_billing(uuid,uuid) to authenticated;

comment on table public.club_membership_billing_obligations is 'Provider-neutral obligations; cash arrangements remain due until staff counter settlement or verified drop-box cash.';
