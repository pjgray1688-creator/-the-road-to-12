-- Public Madhouse Apparel catalogue publication layer.
-- Review/apply through the normal database release process; this migration is
-- intentionally not executed by the application or local validation.

create table if not exists public.club_website_shop_publications (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  public_slug text not null check (public_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  family_id uuid not null,
  variant_colour text not null check (length(btrim(variant_colour)) > 0),
  display_name text not null check (length(btrim(display_name)) > 0),
  public_colour text not null check (length(btrim(public_colour)) > 0),
  website_price_minor integer check (website_price_minor is null or website_price_minor > 0),
  currency text not null default 'GBP' check (currency = 'GBP'),
  front_image_url text not null check (front_image_url ~ '^/apparel/[A-Za-z0-9._/-]+$'),
  back_image_url text check (back_image_url is null or back_image_url ~ '^/apparel/[A-Za-z0-9._/-]+$'),
  published boolean not null default false,
  available boolean not null default false,
  mapping_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, public_slug),
  unique (organisation_id, family_id, variant_colour),
  foreign key (family_id, organisation_id)
    references public.club_product_families(id, organisation_id) on delete cascade
);

create index if not exists club_website_shop_publications_scope_idx
  on public.club_website_shop_publications(organisation_id, published, available, public_slug);

alter table public.club_website_shop_publications enable row level security;
revoke all privileges on public.club_website_shop_publications from public, anon, authenticated;
grant select on public.club_website_shop_publications to authenticated;
drop policy if exists club_website_shop_publications_manager_select on public.club_website_shop_publications;
create policy club_website_shop_publications_manager_select
  on public.club_website_shop_publications for select to authenticated
  using (public.club_capability_allowed(organisation_id, auth.uid(), 'commerce.pricing_manage'));

create or replace function public.club_save_website_shop_publication(
  p_organisation_id uuid,
  p_public_slug text,
  p_family_id uuid,
  p_variant_colour text,
  p_display_name text,
  p_public_colour text,
  p_website_price_minor integer,
  p_front_image_url text,
  p_back_image_url text,
  p_published boolean,
  p_available boolean,
  p_mapping_verified boolean
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row public.club_website_shop_publications%rowtype;
  v_previous public.club_website_shop_publications%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id, auth.uid(), 'commerce.pricing_manage') then
    raise exception 'Website shop management is not permitted' using errcode = '42501';
  end if;
  if p_public_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or p_website_price_minor is not null and p_website_price_minor <= 0
     or p_front_image_url !~ '^/apparel/[A-Za-z0-9._/-]+$'
     or position('..' in p_front_image_url) > 0
     or (p_back_image_url is not null and (p_back_image_url !~ '^/apparel/[A-Za-z0-9._/-]+$' or position('..' in p_back_image_url) > 0)) then
    raise exception 'Website product details are invalid' using errcode = '22023';
  end if;
  select * into v_previous from public.club_website_shop_publications
  where organisation_id = p_organisation_id and public_slug = p_public_slug for update;

  if not exists (
    select 1 from public.club_product_families f
    where f.id = p_family_id and f.organisation_id = p_organisation_id
      and f.brand ilike 'Madhouse Apparel'
  ) or not exists (
    select 1 from public.club_commerce_products p
    where p.organisation_id = p_organisation_id and p.family_id = p_family_id
      and p.variant_options ->> 'colour' = p_variant_colour
  ) then
    raise exception 'Select an existing Madhouse Apparel colour from the catalogue' using errcode = '22023';
  end if;
  if p_published and p_available and (not exists (
    select 1 from public.club_product_families f
    where f.id = p_family_id and f.organisation_id = p_organisation_id
      and f.active and f.archived_at is null
  ) or not exists (
    select 1 from public.club_commerce_products p
    where p.organisation_id = p_organisation_id and p.family_id = p_family_id
      and p.variant_options ->> 'colour' = p_variant_colour and p.active
  )) then
    raise exception 'An inactive or archived product can only remain unpublished' using errcode = '22023';
  end if;
  if p_published and p_available and not coalesce(p_mapping_verified, false) then
    raise exception 'Confirm the product, colour and image mapping before publication' using errcode = '22023';
  end if;
  if p_published and p_available and not exists (
    select 1 from public.club_commerce_products p
    where p.organisation_id = p_organisation_id and p.family_id = p_family_id
      and p.variant_options ->> 'colour' = p_variant_colour and p.active
    having count(*) = 8
      and count(distinct p.variant_options ->> 'size') = 8
      and array_agg(distinct p.variant_options ->> 'size') @> array['S','M','L','XL','2XL','3XL','4XL','5XL']::text[]
      and (p_website_price_minor is not null or (
        count(p.sell_price_minor) = 8 and count(distinct p.sell_price_minor) = 1
        and min(p.sell_price_minor) > 0
      ))
  ) then
    raise exception 'Product needs all eight active sizes and a valid website or uniform catalogue price' using errcode = '22023';
  end if;

  insert into public.club_website_shop_publications (
    organisation_id, public_slug, family_id, variant_colour, display_name,
    public_colour, website_price_minor, front_image_url, back_image_url,
    published, available, mapping_verified, updated_at
  ) values (
    p_organisation_id, p_public_slug, p_family_id, btrim(p_variant_colour),
    btrim(p_display_name), btrim(p_public_colour), p_website_price_minor,
    p_front_image_url, p_back_image_url, coalesce(p_published, false),
    coalesce(p_available, false), coalesce(p_mapping_verified, false), now()
  ) on conflict (organisation_id, public_slug) do update set
    family_id = excluded.family_id,
    variant_colour = excluded.variant_colour,
    display_name = excluded.display_name,
    public_colour = excluded.public_colour,
    website_price_minor = excluded.website_price_minor,
    currency = 'GBP',
    front_image_url = excluded.front_image_url,
    back_image_url = excluded.back_image_url,
    published = excluded.published,
    available = excluded.available,
    mapping_verified = excluded.mapping_verified,
    updated_at = now()
  returning * into v_row;

  insert into public.club_audit_events(organisation_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_organisation_id, auth.uid(), 'website_shop.product_saved', 'website_shop_publication', v_row.id,
    jsonb_build_object('slug', v_row.public_slug, 'price_minor', v_row.website_price_minor,
      'published', v_row.published, 'available', v_row.available,
      'mapping_verified', v_row.mapping_verified,
      'previous_price_minor', v_previous.website_price_minor,
      'previous_published', v_previous.published, 'previous_available', v_previous.available,
      'previous_mapping_verified', v_previous.mapping_verified)
  );
  return jsonb_build_object('id', v_row.id, 'public_slug', v_row.public_slug,
    'website_price_minor', v_row.website_price_minor, 'published', v_row.published,
    'available', v_row.available, 'mapping_verified', v_row.mapping_verified);
end;
$$;
revoke all on function public.club_save_website_shop_publication(uuid,text,uuid,text,text,text,integer,text,text,boolean,boolean,boolean) from public, anon, authenticated;
grant execute on function public.club_save_website_shop_publication(uuid,text,uuid,text,text,text,integer,text,text,boolean,boolean,boolean) to authenticated;

-- Public callers can retrieve only explicitly published product fields.
-- Product/family IDs, organisation metadata, costs and customer data never
-- leave the database. No stock count is exposed; apparel is made to order.
create or replace function public.club_list_public_website_shop_catalogue(p_organisation_id uuid)
returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  with eligible as (
    select w.public_slug, w.display_name, w.public_colour, w.currency,
      w.front_image_url, w.back_image_url, w.website_price_minor,
      count(distinct p.sell_price_minor) as distinct_catalogue_prices,
      count(*) as active_variant_count,
      count(*) = count(p.sell_price_minor) as all_sizes_priced,
      min(p.sell_price_minor) as catalogue_price_minor,
      coalesce(array_agg(distinct p.variant_options ->> 'size' order by p.variant_options ->> 'size')
        filter (where p.variant_options ->> 'size' is not null), '{}'::text[]) as sizes
    from public.club_website_shop_publications w
    join public.club_product_families f
      on f.id = w.family_id and f.organisation_id = w.organisation_id and f.active and f.archived_at is null
    join public.club_commerce_products p
      on p.organisation_id = w.organisation_id and p.family_id = w.family_id
      and p.variant_options ->> 'colour' = w.variant_colour and p.active
    where w.organisation_id = p_organisation_id and w.published and w.available and w.mapping_verified
      and f.brand ilike 'Madhouse Apparel'
    group by w.id
  ), priced as (
    select *, coalesce(website_price_minor,
      case when all_sizes_priced and distinct_catalogue_prices = 1 then catalogue_price_minor end) as public_price
    from eligible
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', public_slug, 'name', display_name, 'colour', public_colour,
    'price_minor', public_price, 'currency', currency, 'sizes', to_jsonb(sizes),
    'front_image', front_image_url, 'back_image', back_image_url,
    'published', true, 'available', true, 'made_to_order', true
  ) order by public_slug), '[]'::jsonb)
  from priced
  where public_price is not null and public_price > 0
    and active_variant_count = 8
    and cardinality(sizes) = 8
    and sizes @> array['S','M','L','XL','2XL','3XL','4XL','5XL']::text[];
$$;
revoke all on function public.club_list_public_website_shop_catalogue(uuid) from public, authenticated;
grant execute on function public.club_list_public_website_shop_catalogue(uuid) to anon, authenticated;

comment on table public.club_website_shop_publications is
  'Website-specific Madhouse publication, price override and availability; member-shop catalogue pricing is not modified.';
