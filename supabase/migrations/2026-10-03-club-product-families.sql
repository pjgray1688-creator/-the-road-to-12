-- Product families are presentation groupings; club_commerce_products remain exact SKUs.
create table public.club_product_families (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  brand text, name text not null check (length(btrim(name)) > 0), description text, category text, media jsonb,
  active boolean not null default true, archived_at timestamptz, sort_position integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, organisation_id), unique (organisation_id, name), check (media is null or jsonb_typeof(media) = 'object')
);
alter table public.club_commerce_products add column if not exists family_id uuid;
alter table public.club_commerce_products add column if not exists variant_options jsonb not null default '{}'::jsonb;
alter table public.club_commerce_products add constraint club_commerce_products_family_fk foreign key (family_id, organisation_id) references public.club_product_families(id, organisation_id) on delete set null;
alter table public.club_commerce_products add constraint club_commerce_products_variant_options_check check (jsonb_typeof(variant_options) = 'object');
create index club_product_families_org_idx on public.club_product_families(organisation_id, active, sort_position, name);
create index club_commerce_products_family_idx on public.club_commerce_products(organisation_id, family_id, active);

alter table public.club_product_families enable row level security;
create policy club_product_families_select on public.club_product_families for select to authenticated using (
  public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']) or (active and archived_at is null and public.club_has_customer_access(organisation_id))
);
revoke all privileges on table public.club_product_families from public, anon, authenticated;
grant select on table public.club_product_families to authenticated;

create or replace function public.club_save_product_family(p_id uuid, p_organisation_id uuid, p_name text, p_brand text, p_description text, p_category text, p_media jsonb, p_active boolean, p_sort_position integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_product_families%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Product family administration is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_name),'') is null or (p_media is not null and jsonb_typeof(p_media) <> 'object') then raise exception 'Invalid product family input' using errcode='22023'; end if;
  if p_id is null then insert into public.club_product_families(organisation_id,name,brand,description,category,media,active,sort_position) values (p_organisation_id,btrim(p_name),nullif(btrim(p_brand),''),p_description,nullif(btrim(p_category),''),p_media,coalesce(p_active,true),coalesce(p_sort_position,0)) returning * into v_row;
  else update public.club_product_families set name=btrim(p_name),brand=nullif(btrim(p_brand),''),description=p_description,category=nullif(btrim(p_category),''),media=p_media,active=p_active,sort_position=coalesce(p_sort_position,0),updated_at=now() where id=p_id and organisation_id=p_organisation_id returning * into v_row; if not found then raise exception 'Product family not found' using errcode='P0002'; end if; end if;
  return to_jsonb(v_row);
end; $$;
revoke all on function public.club_save_product_family(uuid,uuid,text,text,text,text,jsonb,boolean,integer) from public,anon,authenticated;
grant execute on function public.club_save_product_family(uuid,uuid,text,text,text,text,jsonb,boolean,integer) to authenticated;

create or replace function public.club_assign_product_family(p_organisation_id uuid, p_product_id uuid, p_family_id uuid, p_variant_options jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_commerce_products%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Product family administration is not permitted' using errcode='42501'; end if;
  if p_variant_options is null or jsonb_typeof(p_variant_options) <> 'object' then raise exception 'Variant options must be an object' using errcode='22023'; end if;
  if p_family_id is not null and not exists(select 1 from public.club_product_families where id=p_family_id and organisation_id=p_organisation_id) then raise exception 'Product family not found' using errcode='P0002'; end if;
  update public.club_commerce_products set family_id=p_family_id, variant_options=p_variant_options, updated_at=now() where id=p_product_id and organisation_id=p_organisation_id returning * into v_row;
  if not found then raise exception 'Commerce product not found' using errcode='P0002'; end if;
  return to_jsonb(v_row);
end; $$;
revoke all on function public.club_assign_product_family(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.club_assign_product_family(uuid,uuid,uuid,jsonb) to authenticated;
