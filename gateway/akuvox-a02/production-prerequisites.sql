-- Read-only Supabase SQL Editor check. Returns schema/policy prerequisites,
-- location mode and aggregate Off-Peak rule counts; it reads no customer rows.
with required_columns(table_name, column_name) as (
  values
    ('club_organisations','id'),('club_organisations','slug'),
    ('club_locations','id'),('club_locations','organisation_id'),('club_locations','name'),('club_locations','active'),('club_locations','access_mode'),
    ('club_members','organisation_id'),('club_members','user_id'),('club_members','role'),('club_members','active'),
    ('club_products','id'),('club_products','organisation_id'),('club_products','kind'),('club_products','sellable'),('club_products','archived_at'),
    ('club_membership_product_rules','organisation_id'),('club_membership_product_rules','product_id'),('club_membership_product_rules','catalogue_code'),('club_membership_product_rules','access_timezone'),('club_membership_product_rules','access_weekdays'),('club_membership_product_rules','access_opens_at'),('club_membership_product_rules','access_closes_at'),('club_membership_product_rules','updated_at'),
    ('club_memberships','id'),('club_memberships','organisation_id'),('club_memberships','product_id'),
    ('club_entitlement_grants','organisation_id'),('club_entitlement_grants','membership_id'),('club_entitlement_grants','entitlement_key'),('club_entitlement_grants','starts_at'),('club_entitlement_grants','ends_at'),
    ('club_access_decisions','membership_id'),('club_access_decisions','decision'),('club_access_decisions','decided_at'),
    ('club_audit_events','organisation_id'),('club_audit_events','actor_user_id'),('club_audit_events','actor_role'),('club_audit_events','action'),('club_audit_events','target_type'),('club_audit_events','target_id'),('club_audit_events','location_id'),('club_audit_events','metadata')
), checks(check_name, ok, observed) as (
  select 'required public columns: ' || table_name || '.' || column_name,
    exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=required_columns.table_name and c.column_name=required_columns.column_name),
    coalesce((select c.data_type from information_schema.columns c where c.table_schema='public' and c.table_name=required_columns.table_name and c.column_name=required_columns.column_name),'missing')
  from required_columns
  union all
  select 'auth.users available for actor references', to_regclass('auth.users') is not null, coalesce(to_regclass('auth.users')::text,'missing')
  union all
  select 'club_has_active_role(uuid,text[]) returns boolean', to_regprocedure('public.club_has_active_role(uuid,text[])') is not null and pg_get_function_result(to_regprocedure('public.club_has_active_role(uuid,text[])'))='boolean', coalesce(pg_get_function_result(to_regprocedure('public.club_has_active_role(uuid,text[])')),'missing')
  union all
  select 'club_access_decide_customer signature returns jsonb', to_regprocedure('public.club_access_decide_customer(uuid,uuid,uuid,text,text,uuid,text)') is not null and pg_get_function_result(to_regprocedure('public.club_access_decide_customer(uuid,uuid,uuid,text,text,uuid,text)'))='jsonb', coalesce(pg_get_function_result(to_regprocedure('public.club_access_decide_customer(uuid,uuid,uuid,text,text,uuid,text)')),'missing')
  union all
  select 'organisation-scoped club_products unique key', exists(select 1 from pg_constraint c where c.conrelid=to_regclass('public.club_products') and c.contype='u' and pg_get_constraintdef(c.oid)='UNIQUE (id, organisation_id)'), coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid=to_regclass('public.club_products') and c.contype='u' and pg_get_constraintdef(c.oid)='UNIQUE (id, organisation_id)' limit 1),'missing')
  union all
  select 'organisation-scoped club_locations unique key', exists(select 1 from pg_constraint c where c.conrelid=to_regclass('public.club_locations') and c.contype='u' and pg_get_constraintdef(c.oid)='UNIQUE (id, organisation_id)'), coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid=to_regclass('public.club_locations') and c.contype='u' and pg_get_constraintdef(c.oid)='UNIQUE (id, organisation_id)' limit 1),'missing')
  union all
  select 'exactly one Madhouse Off-Peak rule, and exactly one sellable membership product',
    count(*)=1 and count(*) filter(where p.kind='membership' and p.sellable and p.archived_at is null)=1,
    jsonb_build_object('rules',count(*),'sellableMembershipProducts',count(*) filter(where p.kind='membership' and p.sellable and p.archived_at is null))::text
  from public.club_membership_product_rules r
  join public.club_organisations o on o.id=r.organisation_id
  left join public.club_products p on p.id=r.product_id and p.organisation_id=r.organisation_id
  where o.slug='madhouse-gym' and r.catalogue_code='madhouse.membership.off-peak.v1'
  union all
  select 'Rotherham location: exactly one active row; current mode shown, not changed',
    count(*) filter(where l.active)=1,
    jsonb_agg(jsonb_build_object('id',l.id,'active',l.active,'accessMode',l.access_mode))::text
  from public.club_locations l join public.club_organisations o on o.id=l.organisation_id
  where o.slug='madhouse-gym' and lower(btrim(l.name))='rotherham'
)
select check_name, ok, observed from checks order by check_name;
