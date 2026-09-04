-- Read-only checks for the optional commerce product brand migration.
select c.table_name, c.column_name, c.data_type
from information_schema.columns c
where c.table_schema='public' and c.table_name='club_commerce_products' and c.column_name='brand';
select routine_name, routine_type
from information_schema.routines
where routine_schema='public' and routine_name='club_save_commerce_product';
select relname, relrowsecurity from pg_class where oid='public.club_commerce_products'::regclass;
select has_function_privilege('authenticated','public.club_save_commerce_product(uuid,uuid,text,text,text,text,text,text,boolean,boolean,integer,integer,text,text,text,jsonb)','EXECUTE') as authenticated_can_save;
