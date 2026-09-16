-- Active Sports supplier imagery is catalogue-owned.  A valid image supplied
-- by the current import replaces stale supplier media; blank input is ignored.
create or replace function public.club_sync_supplier_commerce_media()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_parent_image text; v_url text;
begin
  if new.club_product_id is null then return new; end if;
  select pp.parent_image_url into v_parent_image
  from public.club_supplier_parent_products pp
  where pp.id=new.parent_product_id and pp.organisation_id=new.organisation_id;
  v_url:=case when new.variant_image_url ~* '^https?://' then btrim(new.variant_image_url)
              when v_parent_image ~* '^https?://' then btrim(v_parent_image) end;
  if v_url is not null then
    update public.club_commerce_products cp
    set media=jsonb_build_object('url',v_url), updated_at=now()
    where cp.id=new.club_product_id and cp.organisation_id=new.organisation_id;
  end if;
  return new;
end; $$;

create or replace function public.club_sync_parent_commerce_media()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.parent_image_url ~* '^https?://' then
    update public.club_commerce_products cp
    set media=jsonb_build_object('url',btrim(new.parent_image_url)), updated_at=now()
    from public.club_supplier_products sp
    where sp.parent_product_id=new.id and sp.organisation_id=new.organisation_id
      and sp.club_product_id=cp.id and cp.organisation_id=new.organisation_id;
  end if;
  return new;
end; $$;

-- Refresh existing linked rows immediately when this migration is applied.
update public.club_commerce_products cp
set media=jsonb_build_object('url',btrim(coalesce(nullif(sp.variant_image_url,''),nullif(pp.parent_image_url,'')))), updated_at=now()
from public.club_supplier_products sp
join public.club_supplier_parent_products pp on pp.id=sp.parent_product_id and pp.organisation_id=sp.organisation_id
join public.club_suppliers s on s.id=sp.supplier_id and s.organisation_id=sp.organisation_id
where s.name='Active Sports' and sp.organisation_id=cp.organisation_id and sp.club_product_id=cp.id
  and coalesce(nullif(sp.variant_image_url,''),nullif(pp.parent_image_url,'')) ~* '^https?://';

revoke all on function public.club_sync_supplier_commerce_media() from public,anon,authenticated;
revoke all on function public.club_sync_parent_commerce_media() from public,anon,authenticated;
