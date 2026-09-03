-- Delivery receipts and commercial history. Review-only; never execute from the app.
create table if not exists public.club_inventory_receipts (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null, supplier_name text, supplier_reference text, received_at timestamptz not null default now(), received_by uuid not null references auth.users(id), notes text, idempotency_key text, created_at timestamptz not null default now(),
  unique (id, organisation_id), foreign key (location_id, organisation_id) references public.club_locations(id, organisation_id)
);
alter table public.club_inventory_receipts add column if not exists idempotency_key text;
create unique index if not exists club_inventory_receipts_org_idempotency_uidx on public.club_inventory_receipts(organisation_id, idempotency_key) where idempotency_key is not null;
create table if not exists public.club_inventory_receipt_lines (
  id uuid primary key default gen_random_uuid(), receipt_id uuid not null, organisation_id uuid not null, product_id uuid not null, quantity_received integer not null check (quantity_received > 0), unit_cost_minor integer check (unit_cost_minor is null or unit_cost_minor >= 0), vat_rate_percent numeric check (vat_rate_percent is null or vat_rate_percent >= 0), notes text, created_at timestamptz not null default now(), unique (id, organisation_id), foreign key (receipt_id, organisation_id) references public.club_inventory_receipts(id, organisation_id) on delete cascade, foreign key (product_id, organisation_id) references public.club_commerce_products(id, organisation_id)
);
create table if not exists public.club_product_cost_history (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade, product_id uuid not null, unit_cost_minor integer not null check (unit_cost_minor >= 0), effective_at timestamptz not null default now(), source_type text not null check (source_type in ('delivery','invoice','manual')), source_id uuid, supplier_name text, supplier_reference text, recorded_by uuid not null references auth.users(id), created_at timestamptz not null default now(), foreign key (product_id, organisation_id) references public.club_commerce_products(id, organisation_id)
);
create table if not exists public.club_product_price_history (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade, product_id uuid not null, old_price_minor integer not null check (old_price_minor >= 0), new_price_minor integer not null check (new_price_minor >= 0), changed_by uuid not null references auth.users(id), changed_at timestamptz not null default now(), reason text, foreign key (product_id, organisation_id) references public.club_commerce_products(id, organisation_id)
);
create index if not exists club_inventory_receipts_org_date_idx on public.club_inventory_receipts(organisation_id, received_at desc);
create index if not exists club_inventory_receipt_lines_receipt_idx on public.club_inventory_receipt_lines(receipt_id);
create index if not exists club_product_cost_history_product_idx on public.club_product_cost_history(organisation_id, product_id, effective_at desc);
alter table public.club_inventory_receipts enable row level security; alter table public.club_inventory_receipt_lines enable row level security; alter table public.club_product_cost_history enable row level security; alter table public.club_product_price_history enable row level security;
revoke all on table public.club_inventory_receipts, public.club_inventory_receipt_lines, public.club_product_cost_history, public.club_product_price_history from public, anon, authenticated;

create or replace function public.club_receive_inventory_delivery(p_organisation_id uuid, p_location_id uuid, p_supplier_name text, p_supplier_reference text, p_received_at timestamptz, p_notes text, p_lines jsonb, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_receipt public.club_inventory_receipts%rowtype; v_line jsonb; v_product public.club_commerce_products%rowtype; v_qty integer; v_cost integer; v_vat numeric; v_key text; v_idempotency text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id, auth.uid(), 'inventory.adjust') then raise exception 'Inventory permission required' using errcode='42501'; end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'Location does not belong to organisation' using errcode='22023'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0 then raise exception 'At least one delivery line is required' using errcode='22023'; end if;
  v_idempotency := nullif(btrim(p_idempotency_key),'');
  if v_idempotency is not null then select * into v_receipt from public.club_inventory_receipts where organisation_id=p_organisation_id and idempotency_key=v_idempotency limit 1; if found then return to_jsonb(v_receipt); end if; end if;
  begin
    insert into public.club_inventory_receipts(organisation_id,location_id,supplier_name,supplier_reference,received_at,received_by,notes,idempotency_key) values(p_organisation_id,p_location_id,nullif(btrim(p_supplier_name),''),nullif(btrim(p_supplier_reference),''),coalesce(p_received_at,now()),auth.uid(),p_notes,v_idempotency) returning * into v_receipt;
  exception when unique_violation then
    if v_idempotency is not null then select * into v_receipt from public.club_inventory_receipts where organisation_id=p_organisation_id and idempotency_key=v_idempotency limit 1; if found then return to_jsonb(v_receipt); end if; end if;
    raise;
  end;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_key := nullif(v_line->>'product_id','');
    if v_key is null or v_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'Delivery product is invalid' using errcode='22023'; end if;
    if coalesce(v_line->>'quantity','') !~ '^[0-9]+$' then raise exception 'Delivery quantity must be a positive integer' using errcode='22023'; end if;
    v_qty := (v_line->>'quantity')::integer;
    if v_qty <= 0 then raise exception 'Delivery quantity must be a positive integer' using errcode='22023'; end if;
    if v_line ? 'unit_cost_minor' and v_line->>'unit_cost_minor' is not null and v_line->>'unit_cost_minor' <> '' then
      if (v_line->>'unit_cost_minor') !~ '^[0-9]+$' then raise exception 'Unit cost must be a nonnegative integer' using errcode='22023'; end if;
      v_cost := (v_line->>'unit_cost_minor')::integer;
    else v_cost := null;
    end if;
    if v_line ? 'vat_rate_percent' and v_line->>'vat_rate_percent' is not null and v_line->>'vat_rate_percent' <> '' then
      begin v_vat := (v_line->>'vat_rate_percent')::numeric; exception when others then raise exception 'VAT rate is invalid' using errcode='22023'; end;
      if v_vat < 0 or v_vat >= 100 then raise exception 'VAT rate is invalid' using errcode='22023'; end if;
    else v_vat := null;
    end if;
    select * into v_product from public.club_commerce_products where id=v_key::uuid and organisation_id=p_organisation_id and active for update;
    if not found or not v_product.stock_tracked then raise exception 'Delivery product is invalid' using errcode='22023'; end if;
    insert into public.club_inventory_receipt_lines(receipt_id,organisation_id,product_id,quantity_received,unit_cost_minor,vat_rate_percent,notes) values(v_receipt.id,p_organisation_id,v_product.id,v_qty,v_cost,v_vat,v_line->>'notes');
    insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,actor_user_id,reason) values(p_organisation_id,p_location_id,v_product.id,'delivery',v_qty,auth.uid(),concat('Delivery receipt ',v_receipt.id));
    if v_cost is not null then insert into public.club_product_cost_history(organisation_id,product_id,unit_cost_minor,source_type,source_id,supplier_name,supplier_reference,recorded_by) values(p_organisation_id,v_product.id,v_cost,'delivery',v_receipt.id,v_receipt.supplier_name,v_receipt.supplier_reference,auth.uid()); update public.club_commerce_products set cost_price_minor=v_cost,updated_at=now() where id=v_product.id and organisation_id=p_organisation_id; end if;
  end loop;
  perform public.club_append_audit_event(p_organisation_id,'inventory.delivery_received','inventory_receipt',v_receipt.id,p_location_id,null,jsonb_build_object('supplier',v_receipt.supplier_name,'reference',v_receipt.supplier_reference));
  return to_jsonb(v_receipt);
end; $$;
revoke all on function public.club_receive_inventory_delivery(uuid,uuid,text,text,timestamptz,text,jsonb,text) from public,anon;
grant execute on function public.club_receive_inventory_delivery(uuid,uuid,text,text,timestamptz,text,jsonb,text) to authenticated;

create or replace function public.club_list_inventory_receipts(p_organisation_id uuid, p_location_id uuid default null)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.received_at desc), '[]'::jsonb)
  from public.club_inventory_receipts r
  where r.organisation_id = p_organisation_id and (p_location_id is null or r.location_id = p_location_id)
    and exists (select 1 from public.club_members m where m.organisation_id = r.organisation_id and m.user_id = auth.uid() and m.active and m.role in ('gym_staff','gym_admin','owner'));
$$;
revoke all on function public.club_list_inventory_receipts(uuid,uuid) from public,anon;
grant execute on function public.club_list_inventory_receipts(uuid,uuid) to authenticated;

create or replace function public.club_record_commerce_price_history()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is not null and old.sell_price_minor is distinct from new.sell_price_minor then
    insert into public.club_product_price_history(organisation_id, product_id, old_price_minor, new_price_minor, changed_by, reason)
    values(new.organisation_id, new.id, old.sell_price_minor, new.sell_price_minor, auth.uid(), 'manual');
  end if;
  return new;
end; $$;
drop trigger if exists club_commerce_product_price_history on public.club_commerce_products;
create trigger club_commerce_product_price_history after update of sell_price_minor on public.club_commerce_products
for each row execute function public.club_record_commerce_price_history();
