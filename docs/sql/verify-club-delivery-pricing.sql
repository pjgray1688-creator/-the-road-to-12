-- Read-only post-migration checks. Do not run any write/RPC statements from this file.
select table_name, 'present' as status
from information_schema.tables
where table_schema = 'public' and table_name in ('club_inventory_receipts','club_inventory_receipt_lines','club_product_cost_history','club_product_price_history')
order by table_name;

select column_name, data_type, 'present' as status
from information_schema.columns
where table_schema = 'public' and table_name = 'club_inventory_receipts' and column_name = 'idempotency_key';

select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'club_inventory_receipts' and indexname = 'club_inventory_receipts_org_idempotency_uidx';

select routine_name, 'present' as status
from information_schema.routines
where routine_schema = 'public' and routine_name in ('club_receive_inventory_delivery','club_list_inventory_receipts');

select tg.tgname as trigger_name, 'present' as status
from pg_trigger tg
join pg_class rel on rel.oid = tg.tgrelid
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public' and rel.relname = 'club_commerce_products' and tg.tgname = 'club_commerce_product_price_history' and not tg.tgisinternal;

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('club_inventory_receipts','club_inventory_receipt_lines','club_product_cost_history','club_product_price_history')
order by c.relname;

select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where specific_schema = 'public' and routine_name in ('club_receive_inventory_delivery','club_list_inventory_receipts')
order by routine_name, grantee, privilege_type;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('club_inventory_receipts','club_inventory_receipt_lines','club_product_cost_history','club_product_price_history')
order by table_name, grantee, privilege_type;
