-- Keep the two Scitec whey families separate while correcting their
-- reviewed Active Sports parent imagery.
update public.club_supplier_parent_products pp
set parent_image_url='https://www.activesportstrade.co.uk/images/XL/scitech-whey-isolate-2000g_4.jpg', updated_at=now()
from public.club_suppliers s
where pp.supplier_id=s.id
  and pp.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid
  and s.name='Active Sports'
  and pp.brand='Scitec Nutrition'
  and pp.name='100% Whey Isolate';

update public.club_supplier_parent_products pp
set parent_image_url='https://www.activesportstrade.co.uk/images/XL/scitec-100-whey-1816g.jpg', updated_at=now()
from public.club_suppliers s
where pp.supplier_id=s.id
  and pp.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid
  and s.name='Active Sports'
  and pp.brand='Scitec Nutrition'
  and pp.name='100% Whey Protein Professional';
