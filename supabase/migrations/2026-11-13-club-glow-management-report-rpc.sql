-- Secure read projection for the authorised Carlton Glow Zone management view.
-- Existing ledgers remain authoritative; this adds no balance or transaction data.
begin;

do $$
begin
  if to_regclass('public.club_glow_sales') is null
     or to_regclass('public.club_service_credit_usage') is null
     or to_regclass('public.club_glow_adjustments') is null
     or to_regclass('public.club_service_credit_lots') is null
     or to_regprocedure('public.club_capability_allowed(uuid,uuid,text)') is null
     or to_regprocedure('public.club_location_authorized(uuid,uuid)') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception 'Glow Zone management report prerequisites are missing';
  end if;
  if exists (
    select 1 from (values
      ('club_glow_sales','id'),('club_glow_sales','organisation_id'),('club_glow_sales','location_id'),('club_glow_sales','user_id'),('club_glow_sales','actor_user_id'),('club_glow_sales','minutes'),('club_glow_sales','amount_minor'),('club_glow_sales','tender_type'),('club_glow_sales','status'),('club_glow_sales','created_at'),
      ('club_service_credit_usage','id'),('club_service_credit_usage','organisation_id'),('club_service_credit_usage','location_id'),('club_service_credit_usage','user_id'),('club_service_credit_usage','actor_user_id'),('club_service_credit_usage','minutes'),('club_service_credit_usage','created_at'),
      ('club_glow_adjustments','id'),('club_glow_adjustments','organisation_id'),('club_glow_adjustments','location_id'),('club_glow_adjustments','user_id'),('club_glow_adjustments','actor_user_id'),('club_glow_adjustments','minutes'),('club_glow_adjustments','direction'),('club_glow_adjustments','reason'),('club_glow_adjustments','created_at'),
      ('club_service_credit_lots','organisation_id'),('club_service_credit_lots','user_id'),('club_service_credit_lots','credit_key'),('club_service_credit_lots','remaining_quantity'),('club_service_credit_lots','expires_at')
    ) required(table_name,column_name)
    where not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=required.table_name and c.column_name=required.column_name)
  ) then
    raise exception 'Glow Zone management report columns are incomplete';
  end if;
end;
$$;

create or replace function public.club_glow_management_report_secure(p_organisation_id uuid,p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if auth.uid() is null
     or not public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.view')
     or not public.club_location_authorized(p_organisation_id,p_location_id)
     or not exists(select 1 from public.club_locations l where l.id=p_location_id and l.organisation_id=p_organisation_id and l.active and lower(l.name) like '%carlton%') then
    raise exception 'Glow Zone management report access is not permitted' using errcode='42501';
  end if;

  select jsonb_build_object(
    'sales',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'user_id',x.user_id,'actor_user_id',x.actor_user_id,'minutes',x.minutes,'amount_minor',x.amount_minor,'tender_type',x.tender_type,'status',x.status,'created_at',x.created_at) order by x.created_at desc) from (select id,user_id,actor_user_id,minutes,amount_minor,tender_type,status,created_at from public.club_glow_sales where organisation_id=p_organisation_id and location_id=p_location_id order by created_at desc limit 100) x),'[]'::jsonb),
    'usage',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'user_id',x.user_id,'actor_user_id',x.actor_user_id,'minutes',x.minutes,'created_at',x.created_at) order by x.created_at desc) from (select id,user_id,actor_user_id,minutes,created_at from public.club_service_credit_usage where organisation_id=p_organisation_id and location_id=p_location_id order by created_at desc limit 100) x),'[]'::jsonb),
    'adjustments',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'user_id',x.user_id,'actor_user_id',x.actor_user_id,'minutes',x.minutes,'direction',x.direction,'reason',x.reason,'created_at',x.created_at) order by x.created_at desc) from (select id,user_id,actor_user_id,minutes,direction,reason,created_at from public.club_glow_adjustments where organisation_id=p_organisation_id and location_id=p_location_id order by created_at desc limit 100) x),'[]'::jsonb),
    'minute_balances',coalesce((select jsonb_agg(jsonb_build_object('user_id',b.user_id,'minutes',b.minutes) order by b.minutes desc) from (select user_id,sum(remaining_quantity)::integer as minutes from public.club_service_credit_lots where organisation_id=p_organisation_id and credit_key='sunbed_minutes' and user_id is not null and (expires_at is null or expires_at>now()) group by user_id having sum(remaining_quantity)>0) b),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.club_glow_management_report_secure(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_glow_management_report_secure(uuid,uuid) to authenticated;
commit;
