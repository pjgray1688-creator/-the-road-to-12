-- Madhouse Website Shop controls: website-only size availability and family visibility.
-- Execute after 2026-11-04-madhouse-website-shop.sql. Never alters member-shop variants/prices.
begin;

alter table public.club_website_shop_publications
  add column if not exists website_available_sizes text[] not null
  default array['S','M','L','XL','2XL','3XL','4XL','5XL']::text[];

alter table public.club_website_shop_publications
  drop constraint if exists club_website_shop_publications_website_sizes_check;
alter table public.club_website_shop_publications
  add constraint club_website_shop_publications_website_sizes_check
  check (website_available_sizes <@ array['S','M','L','XL','2XL','3XL','4XL','5XL']::text[]);

create table if not exists public.club_website_shop_family_settings (
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  family_id uuid not null,
  visible boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (organisation_id, family_id),
  foreign key (family_id, organisation_id)
    references public.club_product_families(id, organisation_id) on delete cascade
);

alter table public.club_website_shop_family_settings enable row level security;
revoke all privileges on public.club_website_shop_family_settings from public, anon, authenticated;
grant select on public.club_website_shop_family_settings to authenticated;
drop policy if exists club_website_shop_family_settings_manager_select on public.club_website_shop_family_settings;
create policy club_website_shop_family_settings_manager_select
  on public.club_website_shop_family_settings for select to authenticated
  using (public.club_capability_allowed(organisation_id, auth.uid(), 'commerce.pricing_manage'));

create or replace function public.club_update_website_shop_product(
  p_organisation_id uuid,
  p_public_slug text,
  p_website_price_minor integer,
  p_available boolean,
  p_available_sizes text[]
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row public.club_website_shop_publications%rowtype;
  v_previous public.club_website_shop_publications%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id, auth.uid(), 'commerce.pricing_manage') then
    raise exception 'Website shop management is not permitted' using errcode = '42501';
  end if;
  if p_organisation_id <> 'fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid
     or p_public_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or (p_website_price_minor is not null and p_website_price_minor <= 0)
     or p_available is null or p_available_sizes is null
     or p_available_sizes <@ array['S','M','L','XL','2XL','3XL','4XL','5XL']::text[]
     or cardinality(p_available_sizes) <> (select count(distinct requested.size) from unnest(p_available_sizes) as requested(size)) then
    raise exception 'Website product settings are invalid' using errcode = '22023';
  end if;

  select * into v_row from public.club_website_shop_publications
    where organisation_id = p_organisation_id and public_slug = p_public_slug for update;
  if not found then raise exception 'Website product mapping is missing' using errcode = 'P0002'; end if;
  v_previous := v_row;

  if exists (
    select 1 from unnest(p_available_sizes) requested(size)
    where not exists (
      select 1 from public.club_commerce_products p
      where p.organisation_id = p_organisation_id and p.family_id = v_row.family_id
        and p.variant_options ->> 'colour' = v_row.variant_colour
        and p.variant_options ->> 'size' = requested.size and p.active
    )
  ) then
    raise exception 'A selected size is not an active catalogue variant' using errcode = '22023';
  end if;

  if cardinality(p_available_sizes) > 0 and p_website_price_minor is null and not exists (
    select 1 from public.club_commerce_products p
    where p.organisation_id = p_organisation_id and p.family_id = v_row.family_id
      and p.variant_options ->> 'colour' = v_row.variant_colour and p.active
      and p.variant_options ->> 'size' = any(p_available_sizes)
    having count(distinct p.variant_options ->> 'size') = cardinality(p_available_sizes)
      and count(p.sell_price_minor) = cardinality(p_available_sizes)
      and count(distinct p.sell_price_minor) = 1 and min(p.sell_price_minor) > 0
  ) then
    raise exception 'Set a website price because selected catalogue sizes do not share one valid price' using errcode = '22023';
  end if;

  update public.club_website_shop_publications
    set website_price_minor = p_website_price_minor,
        published = p_available,
        available = p_available,
        website_available_sizes = array(select requested.size from unnest(p_available_sizes) as requested(size)
          order by array_position(array['S','M','L','XL','2XL','3XL','4XL','5XL']::text[], requested.size)),
        updated_at = now()
    where id = v_row.id returning * into v_row;

  insert into public.club_audit_events(organisation_id, actor_user_id, action, target_type, target_id, metadata)
  values (p_organisation_id, auth.uid(), 'website_shop.settings_saved', 'website_shop_publication', v_row.id,
    jsonb_build_object('slug', v_row.public_slug, 'price_minor', v_row.website_price_minor,
      'available', v_row.available, 'available_sizes', v_row.website_available_sizes,
      'previous_price_minor', v_previous.website_price_minor,
      'previous_available', v_previous.available,
      'previous_available_sizes', v_previous.website_available_sizes));
  return jsonb_build_object('public_slug', v_row.public_slug, 'website_price_minor', v_row.website_price_minor,
    'available', v_row.available, 'available_sizes', to_jsonb(v_row.website_available_sizes));
end;
$$;
revoke all on function public.club_update_website_shop_product(uuid,text,integer,boolean,text[]) from public, anon, authenticated;
grant execute on function public.club_update_website_shop_product(uuid,text,integer,boolean,text[]) to authenticated;

create or replace function public.club_set_website_shop_family_visibility(
  p_organisation_id uuid, p_family_id uuid, p_visible boolean
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_previous boolean;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id, auth.uid(), 'commerce.pricing_manage') then
    raise exception 'Website shop management is not permitted' using errcode = '42501';
  end if;
  if p_organisation_id <> 'fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid
     or p_family_id not in ('fccc70d5-2db2-45ab-be4f-3cd728c28aa8'::uuid,
       '912a3ec3-c8cc-48c0-9d20-9223584d0714'::uuid, '7f1116bb-2d32-408b-ac66-ac7cde04170b'::uuid)
     or p_visible is null
     or not exists (select 1 from public.club_product_families f where f.id = p_family_id
       and f.organisation_id = p_organisation_id and f.brand ilike 'Madhouse Apparel') then
    raise exception 'Website product family is invalid' using errcode = '22023';
  end if;
  select visible into v_previous from public.club_website_shop_family_settings
    where organisation_id = p_organisation_id and family_id = p_family_id for update;
  insert into public.club_website_shop_family_settings(organisation_id, family_id, visible, updated_at)
  values (p_organisation_id, p_family_id, p_visible, now())
  on conflict (organisation_id, family_id) do update set visible = excluded.visible, updated_at = now();
  insert into public.club_audit_events(organisation_id, actor_user_id, action, target_type, target_id, metadata)
  values (p_organisation_id, auth.uid(), 'website_shop.family_visibility_saved', 'product_family', p_family_id,
    jsonb_build_object('visible', p_visible, 'previous_visible', coalesce(v_previous, true)));
  return jsonb_build_object('family_id', p_family_id, 'visible', p_visible);
end;
$$;
revoke all on function public.club_set_website_shop_family_visibility(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.club_set_website_shop_family_visibility(uuid,uuid,boolean) to authenticated;

-- The first-stage mapping-save RPC is retired: everyday Club users cannot change mappings.
revoke all on function public.club_save_website_shop_publication(uuid,text,uuid,text,text,text,integer,text,text,boolean,boolean,boolean) from public, anon, authenticated;

-- Reconcile only the 21 known publication identities and approved local photographs.
-- Existing per-colour price, visibility and size choices are kept on conflict.
insert into public.club_website_shop_publications as current_publication (
  organisation_id, public_slug, family_id, variant_colour, display_name, public_colour,
  website_price_minor, currency, front_image_url, back_image_url, published, available, mapping_verified
)
select 'fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid, m.slug, m.family_id::uuid, m.variant_colour,
  m.display_name, m.public_colour, null, 'GBP', m.front_image, m.back_image, true, true, true
from (values
  ('acid-black','fccc70d5-2db2-45ab-be4f-3cd728c28aa8','Black/Grey','Acid-Wash T-Shirt','Black','/apparel/53db9107-7b29-4a92-811b-573779bb8bf6.JPG','/apparel/cc03291e-9418-4d66-bb89-c9e86e658626.JPG'),
  ('acid-blue','fccc70d5-2db2-45ab-be4f-3cd728c28aa8','Blue','Acid-Wash T-Shirt','Blue','/apparel/f5dde856-20b6-4f96-b93c-bf8c5216b334.JPG','/apparel/bcd3baf3-96c3-4c11-b440-deb82947da34.JPG'),
  ('acid-brown','fccc70d5-2db2-45ab-be4f-3cd728c28aa8','Brown','Acid-Wash T-Shirt','Brown','/apparel/madhouse-acid-wash-brown-tee-rail.png','/apparel/437b35a6-9893-4f6f-9b2f-7a2833924fdb.JPG'),
  ('acid-forest-green','fccc70d5-2db2-45ab-be4f-3cd728c28aa8','Green','Acid-Wash T-Shirt','Forest Green','/apparel/978db15f-307a-460c-b767-f75d9ea84720.JPG','/apparel/f50fbb03-b1b6-41fc-94de-89c0a515b6d7.JPG'),
  ('acid-pink','fccc70d5-2db2-45ab-be4f-3cd728c28aa8','Pink','Acid-Wash T-Shirt','Pink','/apparel/e9c577b4-0d49-411b-88c0-c791c97afc00.JPG','/apparel/ac9e01db-4d00-46ff-b84e-5f6c00fc668f.JPG'),
  ('acid-purple','fccc70d5-2db2-45ab-be4f-3cd728c28aa8','Purple','Acid-Wash T-Shirt','Purple','/apparel/521ab31d-5daf-441b-8c80-c9aaa2f40bfa.JPG','/apparel/d0acaa80-8d7b-4236-b54a-691dc18b189b.JPG'),
  ('hoodie-beige','912a3ec3-c8cc-48c0-9d20-9223584d0714','Cream','Hoodie','Beige','/apparel/e2647e3c-9edb-4352-9266-0e12bc5f5d81.JPG',null),
  ('hoodie-forest-green','912a3ec3-c8cc-48c0-9d20-9223584d0714','Green','Hoodie','Forest Green','/apparel/dad30b60-1180-4d1b-b6c8-c207077b2b0d.JPG',null),
  ('hoodie-charcoal','912a3ec3-c8cc-48c0-9d20-9223584d0714','Charcoal','Hoodie','Charcoal','/apparel/e1ac282b-a15e-4654-b426-0955aee415a7.JPG',null),
  ('hoodie-white','912a3ec3-c8cc-48c0-9d20-9223584d0714','White','Hoodie','White','/apparel/053d94b7-baa7-4dac-a0b4-6da6467d550f.JPG',null),
  ('hoodie-light-blue','912a3ec3-c8cc-48c0-9d20-9223584d0714','Light Blue','Hoodie','Light Blue','/apparel/484705cc-1b82-4514-a809-8ee6791f5f1a.JPG',null),
  ('hoodie-pink','912a3ec3-c8cc-48c0-9d20-9223584d0714','Pink','Hoodie','Pink','/apparel/95450a65-5c95-42c0-9bbc-28067a31203f.JPG',null),
  ('hoodie-red','912a3ec3-c8cc-48c0-9d20-9223584d0714','Red','Hoodie','Red','/apparel/57243287-73e1-433d-a54c-fd4a66637209.JPG',null),
  ('hoodie-navy','912a3ec3-c8cc-48c0-9d20-9223584d0714','Navy','Hoodie','Navy','/apparel/31223c77-a079-4d76-b2e7-213381ae7cc3.JPG',null),
  ('hoodie-black','912a3ec3-c8cc-48c0-9d20-9223584d0714','Black','Hoodie','Black','/apparel/12d33968-7fe0-41f6-87ef-5297c075f639.JPG',null),
  ('sweatshirt-white','7f1116bb-2d32-408b-ac66-ac7cde04170b','White','Sweatshirt','White','/apparel/8a2a8cc7-57b1-4ade-b026-a73281c23153.JPG',null),
  ('sweatshirt-black','7f1116bb-2d32-408b-ac66-ac7cde04170b','Black','Sweatshirt','Black','/apparel/cf8e037c-b580-4cb9-9e4b-cce5bffcc3b0.JPG',null),
  ('sweatshirt-brown','7f1116bb-2d32-408b-ac66-ac7cde04170b','Brown','Sweatshirt','Chocolate Brown','/apparel/c5e96b59-286d-4553-a2cc-f3e431bd01dd.JPG',null),
  ('sweatshirt-grey','7f1116bb-2d32-408b-ac66-ac7cde04170b','Grey','Sweatshirt','Light Grey','/apparel/4626a8ca-5c9f-4ba4-b7d2-1447782e05f5.JPG',null),
  ('sweatshirt-tan','7f1116bb-2d32-408b-ac66-ac7cde04170b','Tan','Sweatshirt','Tan','/apparel/58b44fca-293c-42c8-88d8-5adefaada8a2.JPG',null),
  ('sweatshirt-cream','7f1116bb-2d32-408b-ac66-ac7cde04170b','Cream','Sweatshirt','Cream','/apparel/a2b08c26-1a49-4050-90a6-24deeb26a156.JPG',null)
) as m(slug,family_id,variant_colour,display_name,public_colour,front_image,back_image)
join public.club_product_families f on f.id = m.family_id::uuid
  and f.organisation_id = 'fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid
  and f.brand ilike 'Madhouse Apparel' and f.active and f.archived_at is null
where exists (
  select 1 from public.club_commerce_products p
  where p.organisation_id = f.organisation_id and p.family_id = f.id
    and p.variant_options ->> 'colour' = m.variant_colour
    and p.variant_options ->> 'size' = any(array['S','M','L','XL','2XL','3XL','4XL','5XL']::text[])
    and p.active
  having count(distinct p.variant_options ->> 'size') > 0
)
on conflict (organisation_id, public_slug) do update set
  family_id = excluded.family_id,
  variant_colour = excluded.variant_colour,
  display_name = excluded.display_name,
  public_colour = excluded.public_colour,
  currency = 'GBP',
  front_image_url = excluded.front_image_url,
  back_image_url = excluded.back_image_url,
  published = case when current_publication.mapping_verified then current_publication.published else excluded.published end,
  available = case when current_publication.mapping_verified then current_publication.available else excluded.available end,
  mapping_verified = true,
  updated_at = now();

create or replace function public.club_list_public_website_shop_catalogue(p_organisation_id uuid)
returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  with allowed_sizes as (
    select array['S','M','L','XL','2XL','3XL','4XL','5XL']::text[] as sizes
  ), eligible as (
    select w.public_slug, w.display_name, w.public_colour, w.currency,
      w.front_image_url, w.back_image_url, w.website_price_minor,
      (select array_agg(size order by array_position(a.sizes, size)) from (
        select distinct psize.variant_options ->> 'size' as size
        from public.club_commerce_products psize
        where psize.organisation_id = w.organisation_id and psize.family_id = w.family_id
          and psize.variant_options ->> 'colour' = w.variant_colour and psize.active
          and psize.variant_options ->> 'size' = any(w.website_available_sizes)
          and psize.variant_options ->> 'size' = any(a.sizes)
      ) actual_sizes) as sizes,
      count(p.sell_price_minor) as priced_sizes,
      count(distinct p.sell_price_minor) as distinct_prices,
      min(p.sell_price_minor) as catalogue_price
    from public.club_website_shop_publications w
    join public.club_product_families f on f.id = w.family_id and f.organisation_id = w.organisation_id
      and f.active and f.archived_at is null and f.brand ilike 'Madhouse Apparel'
    left join public.club_website_shop_family_settings fs on fs.organisation_id = w.organisation_id and fs.family_id = w.family_id
    cross join allowed_sizes a
    join public.club_commerce_products p on p.organisation_id = w.organisation_id and p.family_id = w.family_id
      and p.variant_options ->> 'colour' = w.variant_colour and p.active
      and p.variant_options ->> 'size' = any(w.website_available_sizes)
      and p.variant_options ->> 'size' = any(a.sizes)
    where w.organisation_id = p_organisation_id and w.published and w.available and w.mapping_verified
      and coalesce(fs.visible, true)
    group by w.id, w.organisation_id, w.family_id, w.variant_colour, w.website_available_sizes,
      w.public_slug, w.display_name, w.public_colour, w.currency,
      w.front_image_url, w.back_image_url, w.website_price_minor, a.sizes
  ), priced as (
    select *, coalesce(website_price_minor,
      case when priced_sizes = cardinality(sizes) and distinct_prices = 1 and catalogue_price > 0 then catalogue_price end) as public_price
    from eligible where cardinality(sizes) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', public_slug, 'name', display_name, 'colour', public_colour, 'price_minor', public_price,
    'currency', currency, 'sizes', to_jsonb(sizes), 'front_image', front_image_url,
    'back_image', back_image_url, 'published', true, 'available', true, 'made_to_order', true
  ) order by public_slug), '[]'::jsonb)
  from priced where public_price is not null and public_price > 0;
$$;
revoke all on function public.club_list_public_website_shop_catalogue(uuid) from public, authenticated;
grant execute on function public.club_list_public_website_shop_catalogue(uuid) to anon, authenticated;

commit;
