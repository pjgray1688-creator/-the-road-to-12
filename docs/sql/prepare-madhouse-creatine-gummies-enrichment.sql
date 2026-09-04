-- Review-only preparation; do not execute automatically.
-- Official source: https://appliednutrition.uk/products/pure-creatine-gummies
-- Exact row guard prevents touching another product or variant.
update public.club_commerce_products
set brand='Applied Nutrition',
    description='Creatine Monohydrate Gummies · Millions Blackcurrant · 80 gummies / 20 servings · 3g creatine per serving',
    media=jsonb_build_object('url','https://appliednutrition.uk/cdn/shop/files/Creatine_Gummies_400g_-_Millions_Blackcurrant.webp?v=1781408048&width=416','source','manufacturer','reviewed',true),
    updated_at=now()
where organisation_id=:organisation_id
  and sku='R12-MAD-CREATINE-GUMMIES'
  and barcode='5056555207376'
  and name='Creatine Gummies';
