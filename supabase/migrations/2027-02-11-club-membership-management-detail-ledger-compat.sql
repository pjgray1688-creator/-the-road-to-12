-- Repair the management-detail projection to use the installed provider
-- payment schema. No membership or payment rows are modified.
begin;

do $$
begin
  if to_regclass('public.club_memberships') is null
    or to_regclass('public.club_products') is null
    or to_regclass('public.club_membership_billing_arrangements') is null
    or to_regclass('public.club_membership_billing_obligations') is null
    or to_regclass('public.club_membership_billing_payments') is null
    or to_regclass('public.club_membership_counter_payments') is null
    or to_regclass('public.club_membership_shared_contracts') is null
    or to_regprocedure('public.club_capability_allowed(uuid,uuid,text)') is null then
    raise exception 'Membership management projection prerequisites are missing; no changes applied';
  end if;
  if exists(select 1 from (values
      ('club_membership_billing_payments','id'),('club_membership_billing_payments','organisation_id'),
      ('club_membership_billing_payments','obligation_id'),('club_membership_billing_payments','amount_minor'),
      ('club_membership_billing_payments','currency'),('club_membership_billing_payments','occurred_at'),
      ('club_membership_billing_payments','provider_reference'),('club_membership_billing_obligations','id'),
      ('club_membership_billing_obligations','organisation_id'),('club_membership_billing_obligations','membership_id'),
      ('club_membership_billing_obligations','payment_method_family'),('club_membership_billing_obligations','provider_type'),
      ('club_membership_billing_obligations','state'),('club_membership_counter_payments','id'),
      ('club_membership_counter_payments','organisation_id'),('club_membership_counter_payments','membership_id'),
      ('club_membership_counter_payments','billing_period_start'),('club_membership_counter_payments','billing_period_end'),
      ('club_membership_counter_payments','paid_through_date')
    ) required(table_name,column_name)
    where not exists(select 1 from information_schema.columns c where c.table_schema='public'
      and c.table_name=required.table_name and c.column_name=required.column_name)) then
    raise exception 'Membership payment ledger signatures do not match; no changes applied';
  end if;
end $$;

create or replace function public.club_get_membership_management_detail(p_organisation_id uuid,p_membership_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare m public.club_memberships%rowtype; p public.club_products%rowtype; arrangement jsonb; history jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.manage') then
    raise exception 'Membership management is not permitted' using errcode='42501';
  end if;
  select * into m from public.club_memberships where id=p_membership_id and organisation_id=p_organisation_id;
  if not found then raise exception 'Membership is not available' using errcode='P0002'; end if;
  select * into p from public.club_products where id=m.product_id and organisation_id=p_organisation_id;
  select to_jsonb(a) - 'provider_customer_reference' into arrangement
    from public.club_membership_billing_arrangements a where a.membership_id=m.id and a.organisation_id=p_organisation_id
    order by a.created_at desc limit 1;

  select coalesce(jsonb_agg(x.item order by x.occurred_at desc),'[]'::jsonb) into history from (
    select jsonb_build_object(
      'id',cp.id,'kind','counter','method',cp.method,'state',cp.state,'amount_minor',cp.amount_minor,
      'currency',cp.currency,'payment_received_at',cp.payment_received_at,'external_reference',cp.external_reference,
      'billing_period_start',cp.billing_period_start,'billing_period_end',cp.billing_period_end,
      'paid_through_date',cp.paid_through_date,'recorded_by',cp.initiated_by,'verified_by',cp.verified_by,
      'verified_at',cp.verified_at,'evidence_note',cp.evidence_note
    ) item,cp.payment_received_at occurred_at
    from public.club_membership_counter_payments cp
    where cp.organisation_id=p_organisation_id and cp.membership_id=m.id
    union all
    select jsonb_build_object(
      'id',pay.id,'kind','billing','method',o.payment_method_family,'provider_type',o.provider_type,
      'state',o.state,'amount_minor',pay.amount_minor,'currency',pay.currency,
      'payment_received_at',pay.occurred_at,'external_reference',pay.provider_reference,
      'billing_period_start',null,'billing_period_end',null,'paid_through_date',null,
      'recorded_by',null,'verified_by',null,'verified_at',null,'evidence_note',null
    ) item,pay.occurred_at
    from public.club_membership_billing_obligations o
    join public.club_membership_billing_payments pay
      on pay.obligation_id=o.id and pay.organisation_id=o.organisation_id
    where o.organisation_id=p_organisation_id and o.membership_id=m.id
  ) x;

  return jsonb_build_object(
    'id',m.id,'product_id',m.product_id,'product_name',p.name,'product_kind',p.kind,'billing',p.billing,
    'is_lifetime',p.is_lifetime,'status',m.status,'starts_at',m.starts_at,'ends_at',m.ends_at,'source',m.source,
    'migration_metadata',m.migration_metadata,'billing_arrangement',arrangement,'payments',history,
    'shared_contract',exists(select 1 from public.club_membership_shared_contracts s where s.membership_id=m.id and s.organisation_id=p_organisation_id),
    'has_billing_obligation',exists(select 1 from public.club_membership_billing_obligations o where o.membership_id=m.id and o.organisation_id=p_organisation_id)
  );
end $$;

revoke all on function public.club_get_membership_management_detail(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_get_membership_management_detail(uuid,uuid) to authenticated;

commit;
