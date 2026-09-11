-- Worker entrypoints for the generic supplier import job engine.
create or replace function public.club_run_supplier_import_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.club_import_jobs%rowtype; started timestamptz:=clock_timestamp(); stage text; payload jsonb; outcome jsonb;
begin
  select * into j from public.club_import_jobs where id=p_job_id for update;
  if not found then raise exception 'Import job not found' using errcode='P0002'; end if;
  if j.status='completed' then return jsonb_build_object('jobId',j.id,'status',j.status); end if;
  update public.club_import_jobs set status='running',started_at=coalesce(started_at,now()),error_message=null where id=j.id;
  payload:=j.payload;
  foreach stage in array array['snapshot','identity_reconciliation','parent_products','supplier_variants','pricing','availability','retirement','publish','complete'] loop
    update public.club_import_jobs set current_stage=stage,percentage_complete=case stage when 'snapshot' then 5 when 'identity_reconciliation' then 15 when 'parent_products' then 30 when 'supplier_variants' then 50 when 'pricing' then 65 when 'availability' then 75 when 'retirement' then 85 when 'publish' then 95 else 100 end where id=j.id;
    insert into public.club_import_job_events(job_id,stage,status,percentage_complete) values(j.id,stage,'started',(select percentage_complete from public.club_import_jobs where id=j.id));
    if stage='publish' then
      outcome:=public.club_reconcile_active_sports(j.organisation_id,j.filename,payload->'rows',true,payload->>'revision');
    end if;
    update public.club_import_job_events set status='completed',duration_ms=extract(milliseconds from clock_timestamp()-started) where id=(select id from public.club_import_job_events where job_id=j.id and club_import_job_events.stage=stage and status='started' order by created_at desc limit 1);
  end loop;
  update public.club_import_jobs set status='completed',completed_at=now(),percentage_complete=100,current_stage='complete',duration_ms=extract(milliseconds from clock_timestamp()-started),reconciliation_summary=coalesce(outcome,'{}'::jsonb) where id=j.id;
  return jsonb_build_object('jobId',j.id,'status','completed','summary',coalesce(outcome,'{}'::jsonb));
exception when others then
  update public.club_import_jobs set status='failed',failed_at=now(),error_message=sqlerrm,duration_ms=extract(milliseconds from clock_timestamp()-started) where id=p_job_id;
  insert into public.club_import_job_logs(job_id,level,message,metadata) values(p_job_id,'error',sqlerrm,jsonb_build_object('sqlState',sqlstate));
  return jsonb_build_object('jobId',p_job_id,'status','failed','error',sqlerrm);
end; $$;
revoke all on function public.club_run_supplier_import_job(uuid) from public,anon,authenticated;

create or replace function public.club_retry_supplier_import_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.club_import_jobs%rowtype;
begin
  select * into j from public.club_import_jobs where id=p_job_id and organisation_id in (select organisation_id from public.club_import_jobs where id=p_job_id) for update;
  if not found then raise exception 'Import job not found' using errcode='P0002'; end if;
  if j.status<>'failed' then raise exception 'Only failed import jobs can be retried' using errcode='22023'; end if;
  update public.club_import_jobs set status='queued',failed_at=null,error_message=null where id=p_job_id;
  insert into public.club_import_job_logs(job_id,message) values(p_job_id,'Retry queued from failed stage',jsonb_build_object('stage',j.current_stage));
  return jsonb_build_object('jobId',p_job_id,'status','queued','currentStage',j.current_stage);
end; $$;
revoke all on function public.club_retry_supplier_import_job(uuid) from public,anon;

create or replace function public.club_get_supplier_import_job(p_job_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select jsonb_build_object('job',to_jsonb(j),'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.club_import_job_events e where e.job_id=j.id),'[]'::jsonb),'logs',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at) from public.club_import_job_logs l where l.job_id=j.id),'[]'::jsonb)) from public.club_import_jobs j where j.id=p_job_id and public.club_capability_allowed(j.organisation_id,auth.uid(),'supplier.catalogue_manage');
$$;
revoke all on function public.club_get_supplier_import_job(uuid) from public,anon;
grant execute on function public.club_get_supplier_import_job(uuid) to authenticated;

create or replace function public.club_list_supplier_import_jobs(p_organisation_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(to_jsonb(j) order by j.created_at desc),'[]'::jsonb) from public.club_import_jobs j where j.organisation_id=p_organisation_id and public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage');
$$;
revoke all on function public.club_list_supplier_import_jobs(uuid) from public,anon;
grant execute on function public.club_list_supplier_import_jobs(uuid) to authenticated;
