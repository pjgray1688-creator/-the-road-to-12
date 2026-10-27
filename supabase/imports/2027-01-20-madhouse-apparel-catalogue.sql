-- Run only after the reviewed foundation migration, as an authenticated owner
-- or admin with supplier.catalogue_manage and commerce.pricing_manage.
-- Repeatable: existing staff price and enabled choices are preserved.
select public.club_import_madhouse_apparel('fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid);
