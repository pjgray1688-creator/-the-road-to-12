-- Secure read projection for Glow Zone sales in Finance & Sales.
-- This avoids relying on direct client SELECT grants for the Glow ledger.
begin;

do $$
begin
  if to_regclass('public.club_glow_sales') is null
     or to_regprocedure('public.club_capability_allowed(uuid,uuid,text)') is null then
    raise exception 'Glow finance report prerequisites are missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='club_glow_sales'
      and column_name in ('id','organisation_id','location_id','amount_minor','status','created_at','tender_type','minutes')
    group by table_schema,table_name
    having count(*)=8
  ) then
    raise exception 'Glow sales report columns are incomplete';
  end if;
end;
$$;

create or replace function public.club_list_glow_finance_report(
  p_organisation_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_location_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if auth.uid() is null
     or not public.club_capability_allowed(p_organisation_id,auth.uid(),'finance.view') then
    raise exception 'Glow finance access is not permitted' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_from>p_to or p_to-p_from>interval '367 days' then
    raise exception 'Glow finance date range is invalid' using errcode='22023';
  end if;
  if p_location_id is not null and not exists(
    select 1 from public.club_locations l
    where l.id=p_location_id and l.organisation_id=p_organisation_id and l.active
  ) then
    raise exception 'Glow finance location is outside this organisation' using errcode='42501';
  end if;

  select jsonb_build_object(
    'records',coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,'amount_minor',s.amount_minor,'location_id',s.location_id,
      'status',s.status,'created_at',s.created_at,'tender_type',s.tender_type,
      'minutes',s.minutes
    ) order by s.created_at desc),'[]'::jsonb),
    'total_minor',coalesce(sum(s.amount_minor),0),
    'completed_count',count(s.id),
    'minutes_sold',coalesce(sum(s.minutes),0)
  ) into result
  from public.club_glow_sales s
  where s.organisation_id=p_organisation_id
    and s.status='completed'
    and s.created_at>=p_from and s.created_at<=p_to
    and (p_location_id is null or s.location_id=p_location_id);
  return result;
end;
$$;

revoke all on function public.club_list_glow_finance_report(uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.club_list_glow_finance_report(uuid,timestamptz,timestamptz,uuid) to authenticated;
commit;
