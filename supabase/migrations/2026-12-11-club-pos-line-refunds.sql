-- Line-scoped, quantity-based POS refunds. Tender-level refund rows remain the
-- financial source for till accounting; this table records line/unit allocation.
create table if not exists public.club_refund_line_allocations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  refund_id uuid not null,
  order_item_id uuid not null,
  line_kind text not null check(line_kind in ('retail','service')),
  quantity integer not null check(quantity >= 0),
  amount_minor integer not null check(amount_minor > 0),
  actor_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(refund_id,organisation_id) references public.club_refunds(id,organisation_id) on delete restrict,
  foreign key(order_item_id,organisation_id) references public.club_order_items(id,organisation_id) on delete restrict,
  unique(refund_id,order_item_id)
);
create index if not exists club_refund_line_allocations_item_idx
  on public.club_refund_line_allocations(organisation_id,order_item_id,created_at);
alter table public.club_refund_line_allocations enable row level security;
revoke all on table public.club_refund_line_allocations from public,anon,authenticated;
grant select on table public.club_refund_line_allocations to authenticated;
drop policy if exists club_refund_line_allocations_staff_read on public.club_refund_line_allocations;
create policy club_refund_line_allocations_staff_read on public.club_refund_line_allocations for select to authenticated
using(public.club_capability_allowed(organisation_id,auth.uid(),'refunds.issue') and exists(
  select 1 from public.club_refunds r join public.club_orders o on o.id=r.order_id and o.organisation_id=r.organisation_id
  where r.id=club_refund_line_allocations.refund_id and r.organisation_id=club_refund_line_allocations.organisation_id
    and public.club_location_authorized(o.organisation_id,o.location_id)));

-- Preserve line history for service refunds already recorded by the live 12-10 RPC.
insert into public.club_refund_line_allocations(organisation_id,refund_id,order_item_id,line_kind,quantity,amount_minor,actor_user_id,created_at)
select r.organisation_id,r.id,x.order_item_id,'service',sum(x.quantity)::integer,sum(x.amount_minor)::integer,
  coalesce(r.created_by,auth.uid()),r.created_at
from public.club_refund_service_credit_reversals x
join public.club_refunds r on r.id=x.refund_id and r.organisation_id=x.organisation_id
group by r.organisation_id,r.id,x.order_item_id,r.created_by,r.created_at
on conflict(refund_id,order_item_id) do nothing;

-- Historical 12-09 retail refunds were amount-only. Attribute their money in a
-- stable line order with quantity zero so later quantity refunds remain bounded.
do $$
declare r record; i record; pending_minor integer; already_minor integer; part_minor integer;
begin
 for r in select x.* from public.club_refunds x
   where not exists(select 1 from public.club_refund_line_allocations a where a.refund_id=x.id)
   order by x.created_at,x.id
 loop
   pending_minor:=r.amount_minor;
   for i in select oi.* from public.club_order_items oi
     where oi.order_id=r.order_id and oi.organisation_id=r.organisation_id and oi.stock_tracked order by oi.created_at,oi.id
   loop
     exit when pending_minor<=0;
     select coalesce(sum(a.amount_minor),0)::integer into already_minor from public.club_refund_line_allocations a
       where a.order_item_id=i.id and a.organisation_id=i.organisation_id;
     part_minor:=least(pending_minor,greatest(0,i.line_total_minor-already_minor));
     if part_minor>0 then
       insert into public.club_refund_line_allocations(organisation_id,refund_id,order_item_id,line_kind,quantity,amount_minor,actor_user_id,created_at)
       values(r.organisation_id,r.id,i.id,'retail',0,part_minor,coalesce(r.created_by,auth.uid()),r.created_at);
       pending_minor:=pending_minor-part_minor;
     end if;
   end loop;
 end loop;
end $$;

-- Disable the old arbitrary-amount endpoint; only the allocation-based RPC below
-- may issue future staff refunds.
revoke all on function public.club_issue_staff_refund(uuid,integer,text,text,text) from public,anon,authenticated;

create or replace function public.club_refund_line_net_value(p_order_item_id uuid)
returns integer language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare i public.club_order_items%rowtype; o public.club_orders%rowtype; gross bigint; before_gross bigint; discount_before bigint; discount_through bigint;
begin
 select * into i from public.club_order_items where id=p_order_item_id;
 if not found then return 0; end if;
 select * into o from public.club_orders where id=i.order_id and organisation_id=i.organisation_id;
 if not found then return 0; end if;
 select coalesce(sum(x.line_total_minor),0),coalesce(sum(x.line_total_minor) filter(where row(x.created_at,x.id)<row(i.created_at,i.id)),0)
   into gross,before_gross from public.club_order_items x where x.order_id=o.id and x.organisation_id=o.organisation_id;
 if gross<=0 or o.discount_minor<=0 then return i.line_total_minor; end if;
 discount_before:=floor(o.discount_minor::numeric*before_gross/gross)::bigint;
 discount_through:=floor(o.discount_minor::numeric*(before_gross+i.line_total_minor)/gross)::bigint;
 return greatest(0,i.line_total_minor-(discount_through-discount_before)::integer);
end $$;

create or replace function public.club_list_staff_refundable_order_lines(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare o public.club_orders%rowtype; i public.club_order_items%rowtype; result jsonb:='[]'::jsonb;
  prior_qty bigint; prior_minor bigint; original_units bigint; remaining_units bigint; key_count integer; unit_count integer; label text; net_minor integer;
  can_refund bigint; max_minor bigint;
begin
 select * into o from public.club_orders where id=p_order_id;
 if not found or auth.uid() is null or not public.club_capability_allowed(o.organisation_id,auth.uid(),'refunds.issue')
   or o.channel not in ('staff_checkout','quick_sale') or not public.club_location_authorized(o.organisation_id,o.location_id) then
   raise exception 'Refund preview is not available' using errcode='42501';
 end if;
 for i in select * from public.club_order_items where order_id=o.id and organisation_id=o.organisation_id order by created_at,id loop
   net_minor:=public.club_refund_line_net_value(i.id);
   select coalesce(sum(a.quantity),0),coalesce(sum(a.amount_minor),0) into prior_qty,prior_minor
     from public.club_refund_line_allocations a where a.organisation_id=o.organisation_id and a.order_item_id=i.id;
   if i.stock_tracked then
     can_refund:=case when exists(select 1 from public.club_refund_line_allocations a where a.order_item_id=i.id and a.organisation_id=o.organisation_id and a.quantity=0) then 0 else greatest(0,i.quantity-prior_qty) end;
     while can_refund>0 and floor(net_minor::numeric*(prior_qty+can_refund)/i.quantity)-floor(net_minor::numeric*prior_qty/i.quantity)>greatest(0,net_minor-prior_minor) loop
       can_refund:=can_refund-1;
     end loop;
     max_minor:=floor(net_minor::numeric*(prior_qty+can_refund)/i.quantity)-floor(net_minor::numeric*prior_qty/i.quantity);
     label:='item';
     original_units:=i.quantity;
   else
     select coalesce(sum(l.original_quantity),0),coalesce(sum(l.remaining_quantity),0),count(distinct l.credit_key),count(distinct l.unit),min(l.unit)
       into original_units,remaining_units,key_count,unit_count,label
       from public.club_service_credit_lots l where l.organisation_id=o.organisation_id and l.source_type='purchased' and l.source_reference=i.id::text;
     if original_units<=0 or key_count<>1 or unit_count<>1 then can_refund:=0; max_minor:=0; label:='unit';
     else
       can_refund:=least(remaining_units,greatest(0,original_units-prior_qty));
       -- A pre-migration service refund may have been recorded against the
       -- gross amount. Never permit any later refund beyond net paid value.
       while can_refund>0 and floor(net_minor::numeric*remaining_units/original_units)
         -floor(net_minor::numeric*(remaining_units-can_refund)/original_units)>greatest(0,net_minor-prior_minor) loop
         can_refund:=can_refund-1;
       end loop;
       max_minor:=floor(net_minor::numeric*remaining_units/original_units)::bigint
         -floor(net_minor::numeric*(remaining_units-can_refund)/original_units)::bigint;
       label:=coalesce(label,'unit');
     end if;
   end if;
   result:=result||jsonb_build_array(jsonb_build_object('order_item_id',i.id,'product_name',i.product_name,
     'line_kind',case when i.stock_tracked then 'retail' else 'service' end,'quantity',i.quantity,
     'line_total_minor',i.line_total_minor,'sale_value_minor',net_minor,'refunded_quantity',prior_qty,'refunded_minor',prior_minor,
     'refundable_quantity',can_refund,'refundable_minor',max_minor,'unit',label,'original_units',original_units,
     'available_units',case when i.stock_tracked then can_refund else remaining_units end));
 end loop;
 return result;
end $$;

create or replace function public.club_issue_staff_line_refund(
 p_payment_id uuid,p_allocations jsonb,p_reason text,p_external_reference text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.club_payments%rowtype; o public.club_orders%rowtype; r public.club_refunds%rowtype;
 existing public.club_refunds%rowtype; account public.club_balance_accounts%rowtype;
 a jsonb; item public.club_order_items%rowtype; lot public.club_service_credit_lots%rowtype;
 line_id uuid; units integer; already_qty bigint; already_minor bigint; original_units bigint; remaining_units bigint;
  key_count integer; unit_count integer; line_minor integer; net_minor integer; total_minor bigint:=0; prior_paid integer; balance_minor integer;
 units_left integer; units_before integer; take_units integer; role_name text;
 requested jsonb:='[]'::jsonb; recorded jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if jsonb_typeof(p_allocations)<>'array' or jsonb_array_length(p_allocations)<1 or jsonb_array_length(p_allocations)>30
   or nullif(btrim(p_reason),'') is null or length(btrim(p_reason))>240
   or nullif(btrim(p_idempotency_key),'') is null or length(btrim(p_idempotency_key))>200 or length(coalesce(p_external_reference,''))>200 then
   raise exception 'Invalid refund details' using errcode='22023'; end if;
 select * into p from public.club_payments where id=p_payment_id for update;
 if not found then raise exception 'Payment not found' using errcode='P0002'; end if;
 if not public.club_capability_allowed(p.organisation_id,auth.uid(),'refunds.issue') then raise exception 'Refund permission required' using errcode='42501'; end if;
 select * into o from public.club_orders where id=p.order_id and organisation_id=p.organisation_id for update;
 if not found or o.channel not in ('staff_checkout','quick_sale') or o.location_id is null then raise exception 'Only located POS sales can be refunded here' using errcode='22023'; end if;
 if not public.club_location_authorized(o.organisation_id,o.location_id) then raise exception 'Refund is outside your assigned location' using errcode='42501'; end if;
 for a in select value from jsonb_array_elements(p_allocations) order by value->>'order_item_id' loop
   if coalesce(a->>'order_item_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(a->>'quantity','') !~ '^[1-9][0-9]*$' then raise exception 'Refund line selection is invalid' using errcode='22023'; end if;
   line_id:=(a->>'order_item_id')::uuid; units:=(a->>'quantity')::integer;
   if requested @> jsonb_build_array(jsonb_build_object('order_item_id',line_id,'quantity',units)) then raise exception 'A receipt line was selected twice' using errcode='22023'; end if;
   requested:=requested||jsonb_build_array(jsonb_build_object('order_item_id',line_id,'quantity',units));
 end loop;
 select * into existing from public.club_refunds where organisation_id=p.organisation_id and idempotency_key=btrim(p_idempotency_key);
 if found then
   select coalesce(jsonb_agg(jsonb_build_object('order_item_id',x.order_item_id,'quantity',x.quantity) order by x.order_item_id),'[]'::jsonb)
     into recorded from public.club_refund_line_allocations x where x.refund_id=existing.id;
   if existing.payment_id<>p.id or existing.reason is distinct from btrim(p_reason)
     or existing.external_reference is distinct from nullif(btrim(p_external_reference),'') or recorded<>requested then
     raise exception 'Refund idempotency key conflict' using errcode='23505'; end if;
   return to_jsonb(existing);
 end if;
 if p.status not in ('paid','partially_refunded') or o.status not in ('paid','fulfilled','refunded') then raise exception 'Only settled orders can be refunded' using errcode='22023'; end if;
 if p.method not in ('cash','balance') and nullif(btrim(p_external_reference),'') is null then raise exception 'Complete the provider refund first and enter its reference' using errcode='22023'; end if;
 -- The order lock serializes line allocation across separate tender rows too.
 for a in select value from jsonb_array_elements(requested) order by value->>'order_item_id' loop
   line_id:=(a->>'order_item_id')::uuid; units:=(a->>'quantity')::integer;
   select * into item from public.club_order_items where id=line_id and order_id=o.id and organisation_id=o.organisation_id for update;
   if not found then raise exception 'Selected receipt line is unavailable' using errcode='22023'; end if;
   net_minor:=public.club_refund_line_net_value(item.id);
   select coalesce(sum(x.quantity),0),coalesce(sum(x.amount_minor),0) into already_qty,already_minor from public.club_refund_line_allocations x
     where x.organisation_id=o.organisation_id and x.order_item_id=item.id;
   if item.stock_tracked then
     if exists(select 1 from public.club_refund_line_allocations x where x.organisation_id=o.organisation_id and x.order_item_id=item.id and x.quantity=0) then raise exception 'This receipt line has a legacy refund that cannot be safely split further' using errcode='22023'; end if;
     if units>item.quantity-already_qty then raise exception 'Selected item quantity is no longer refundable' using errcode='22023'; end if;
     line_minor:=(floor(net_minor::numeric*(already_qty+units)/item.quantity)-floor(net_minor::numeric*already_qty/item.quantity))::integer;
   else
     perform 1 from public.club_service_credit_lots l where l.organisation_id=o.organisation_id
       and l.source_type='purchased' and l.source_reference=item.id::text order by l.expires_at nulls last,l.granted_at,l.id for update;
     select coalesce(sum(l.original_quantity),0),coalesce(sum(l.remaining_quantity),0),count(distinct l.credit_key),count(distinct l.unit)
       into original_units,remaining_units,key_count,unit_count from public.club_service_credit_lots l
       where l.organisation_id=o.organisation_id and l.source_type='purchased' and l.source_reference=item.id::text;
     if original_units<=0 or key_count<>1 or unit_count<>1 or units>remaining_units or units>original_units-already_qty then
       raise exception 'Selected service units are no longer refundable' using errcode='22023'; end if;
     line_minor:=(floor(net_minor::numeric*remaining_units/original_units)-floor(net_minor::numeric*(remaining_units-units)/original_units))::integer;
   end if;
   if line_minor<=0 or already_minor+line_minor>net_minor then raise exception 'Selected line value is no longer refundable' using errcode='22023'; end if;
   total_minor:=total_minor+line_minor;
 end loop;
 if total_minor<=0 or total_minor>2147483647 then raise exception 'Refund total is invalid' using errcode='22023'; end if;
 select coalesce(sum(amount_minor),0)::integer into prior_paid from public.club_refunds where payment_id=p.id and organisation_id=p.organisation_id;
 if total_minor>p.amount_minor-prior_paid then raise exception 'Refund exceeds the remaining paid amount' using errcode='22023'; end if;
 insert into public.club_refunds(payment_id,order_id,organisation_id,amount_minor,reason,external_reference,created_by,idempotency_key)
 values(p.id,o.id,p.organisation_id,total_minor::integer,btrim(p_reason),nullif(btrim(p_external_reference),''),auth.uid(),btrim(p_idempotency_key)) returning * into r;
 for a in select value from jsonb_array_elements(requested) order by value->>'order_item_id' loop
   line_id:=(a->>'order_item_id')::uuid; units:=(a->>'quantity')::integer;
   select * into item from public.club_order_items where id=line_id and order_id=o.id and organisation_id=o.organisation_id;
   net_minor:=public.club_refund_line_net_value(item.id);
   select coalesce(sum(x.quantity),0),coalesce(sum(x.amount_minor),0) into already_qty,already_minor from public.club_refund_line_allocations x
     where x.organisation_id=o.organisation_id and x.order_item_id=item.id and x.refund_id<>r.id;
   if item.stock_tracked then
     line_minor:=(floor(net_minor::numeric*(already_qty+units)/item.quantity)-floor(net_minor::numeric*already_qty/item.quantity))::integer;
     insert into public.club_refund_line_allocations(organisation_id,refund_id,order_item_id,line_kind,quantity,amount_minor,actor_user_id)
       values(o.organisation_id,r.id,item.id,'retail',units,line_minor,auth.uid());
   else
     select coalesce(sum(l.original_quantity),0),coalesce(sum(l.remaining_quantity),0) into original_units,remaining_units from public.club_service_credit_lots l
       where l.organisation_id=o.organisation_id and l.source_type='purchased' and l.source_reference=item.id::text;
     line_minor:=(floor(net_minor::numeric*remaining_units/original_units)-floor(net_minor::numeric*(remaining_units-units)/original_units))::integer;
     insert into public.club_refund_line_allocations(organisation_id,refund_id,order_item_id,line_kind,quantity,amount_minor,actor_user_id)
       values(o.organisation_id,r.id,item.id,'service',units,line_minor,auth.uid());
     units_left:=units; units_before:=0;
     for lot in select * from public.club_service_credit_lots where organisation_id=o.organisation_id and source_type='purchased'
       and source_reference=item.id::text and remaining_quantity>0 order by expires_at nulls last,granted_at,id for update loop
       exit when units_left=0;
       take_units:=least(units_left,lot.remaining_quantity);
       update public.club_service_credit_lots set remaining_quantity=remaining_quantity-take_units where id=lot.id and organisation_id=o.organisation_id;
       insert into public.club_refund_service_credit_reversals(organisation_id,refund_id,order_item_id,credit_lot_id,quantity,amount_minor,actor_user_id)
       values(o.organisation_id,r.id,item.id,lot.id,take_units,
         (floor(line_minor::numeric*(units_before+take_units)/units)-floor(line_minor::numeric*units_before/units))::integer,auth.uid());
       units_before:=units_before+take_units; units_left:=units_left-take_units;
     end loop;
     if units_left<>0 then raise exception 'Service unit balance changed; retry the refund' using errcode='40001'; end if;
   end if;
 end loop;
 if p.method='balance' then
   select * into account from public.club_balance_accounts b where b.organisation_id=o.organisation_id and b.status='active'
     and (b.customer_id=o.customer_id or (o.customer_id is null and b.user_id=o.user_id)) order by case when b.customer_id=o.customer_id then 0 else 1 end limit 1 for update;
   if not found or account.currency<>p.currency then raise exception 'Madhouse Balance account is unavailable' using errcode='P0002'; end if;
   select coalesce(sum(amount_delta_minor),0)::integer into balance_minor from public.club_balance_entries where organisation_id=o.organisation_id and account_id=account.id;
   insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,order_id,payment_id,actor_user_id,reason,idempotency_key)
   values(account.id,o.organisation_id,'refund',total_minor::integer,balance_minor+total_minor,o.id,p.id,auth.uid(),btrim(p_reason),'refund:'||r.id::text);
 end if;
 update public.club_payments set status=case when prior_paid+total_minor>=p.amount_minor then 'refunded' else 'partially_refunded' end,updated_at=now()
   where id=p.id and organisation_id=p.organisation_id;
 select m.role into role_name from public.club_members m where m.organisation_id=o.organisation_id and m.user_id=auth.uid() and m.active limit 1;
 insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata)
 values(o.organisation_id,auth.uid(),role_name,'payment.refund_issued','refund',r.id,o.location_id,btrim(p_reason),
   jsonb_build_object('payment_id',p.id,'order_id',o.id,'amount_minor',total_minor,'payment_method',p.method,
     'external_reference',nullif(btrim(p_external_reference),''),'allocations',requested));
 if not exists(select 1 from public.club_payments x where x.order_id=o.id and x.organisation_id=o.organisation_id and x.status in ('paid','partially_refunded','pending'))
   and exists(select 1 from public.club_refunds x where x.order_id=o.id and x.organisation_id=o.organisation_id) then
   update public.club_orders set status='refunded',updated_at=now() where id=o.id and organisation_id=o.organisation_id;
 end if;
 return to_jsonb(r);
end $$;
revoke all on function public.club_refund_line_net_value(uuid),public.club_list_staff_refundable_order_lines(uuid),public.club_issue_staff_line_refund(uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.club_list_staff_refundable_order_lines(uuid),public.club_issue_staff_line_refund(uuid,jsonb,text,text,text) to authenticated;

