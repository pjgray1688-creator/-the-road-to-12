-- R12 Club transactional aggregate RPCs (manual review only; not executed by this change).
-- PostgreSQL functions execute as one transaction: any raised error rolls back every
-- product/definition or membership/holder/grant write made by that RPC call.

create or replace function public.club_create_product(
  p_organisation_id uuid,
  p_name text,
  p_kind text,
  p_price_minor integer,
  p_currency text,
  p_billing text,
  p_duration_days integer,
  p_sellable boolean,
  p_archived_at timestamptz,
  p_entitlements jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_product public.club_products%rowtype;
  v_entitlements jsonb;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id, array['gym_admin','owner']) then
    raise exception 'Club product administration is not permitted' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null
     or p_kind not in ('membership','class','pt','transformation')
     or p_price_minor < 0
     or p_currency !~ '^[A-Z]{3}$'
     or p_billing not in ('one_off','recurring','manual')
     or (p_duration_days is not null and p_duration_days <= 0)
     or p_sellable is null
     or p_entitlements is null
     or jsonb_typeof(p_entitlements) <> 'array' then
    raise exception 'Invalid Club product input' using errcode = '22023';
  end if;

  insert into public.club_products (
    organisation_id, name, kind, price_minor, currency, billing,
    duration_days, sellable, archived_at
  ) values (
    p_organisation_id, btrim(p_name), p_kind, p_price_minor, p_currency, p_billing,
    p_duration_days, p_sellable, p_archived_at
  ) returning * into v_product;

  insert into public.club_product_entitlements (
    product_id, organisation_id, position, entitlement_key, scope, location_ids,
    allowance_quantity, allowance_period, discount_percent, discount_period, discount_max_uses
  )
  select
    v_product.id,
    v_product.organisation_id,
    (definition.ordinality - 1)::integer,
    definition.value->>'entitlement_key',
    definition.value->>'scope',
    case when definition.value ? 'location_ids'
      then array(select jsonb_array_elements_text(definition.value->'location_ids'))::uuid[]
      else null
    end,
    (definition.value->>'allowance_quantity')::integer,
    definition.value->>'allowance_period',
    (definition.value->>'discount_percent')::numeric,
    definition.value->>'discount_period',
    (definition.value->>'discount_max_uses')::integer
  from jsonb_array_elements(p_entitlements) with ordinality as definition(value, ordinality);

  select coalesce(jsonb_agg(to_jsonb(entitlement) order by entitlement.position), '[]'::jsonb)
    into v_entitlements
  from public.club_product_entitlements entitlement
  where entitlement.product_id = v_product.id;

  return jsonb_build_object('product', to_jsonb(v_product), 'entitlements', v_entitlements);
end;
$$;

create or replace function public.club_update_product(
  p_product_id uuid,
  p_name text,
  p_kind text,
  p_price_minor integer,
  p_currency text,
  p_billing text,
  p_duration_days integer,
  p_sellable boolean,
  p_archived_at timestamptz,
  p_entitlements jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_product public.club_products%rowtype;
  v_entitlements jsonb;
begin
  select * into v_product
  from public.club_products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'Club product not found' using errcode = 'P0002';
  end if;
  if auth.uid() is null or not public.club_has_active_role(v_product.organisation_id, array['gym_admin','owner']) then
    raise exception 'Club product administration is not permitted' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null
     or p_kind not in ('membership','class','pt','transformation')
     or p_price_minor < 0
     or p_currency !~ '^[A-Z]{3}$'
     or p_billing not in ('one_off','recurring','manual')
     or (p_duration_days is not null and p_duration_days <= 0)
     or p_sellable is null
     or p_entitlements is null
     or jsonb_typeof(p_entitlements) <> 'array' then
    raise exception 'Invalid Club product input' using errcode = '22023';
  end if;

  update public.club_products
  set name = btrim(p_name), kind = p_kind, price_minor = p_price_minor,
      currency = p_currency, billing = p_billing, duration_days = p_duration_days,
      sellable = p_sellable, archived_at = p_archived_at
  where id = v_product.id
  returning * into v_product;

  delete from public.club_product_entitlements
  where product_id = v_product.id;

  insert into public.club_product_entitlements (
    product_id, organisation_id, position, entitlement_key, scope, location_ids,
    allowance_quantity, allowance_period, discount_percent, discount_period, discount_max_uses
  )
  select
    v_product.id,
    v_product.organisation_id,
    (definition.ordinality - 1)::integer,
    definition.value->>'entitlement_key',
    definition.value->>'scope',
    case when definition.value ? 'location_ids'
      then array(select jsonb_array_elements_text(definition.value->'location_ids'))::uuid[]
      else null
    end,
    (definition.value->>'allowance_quantity')::integer,
    definition.value->>'allowance_period',
    (definition.value->>'discount_percent')::numeric,
    definition.value->>'discount_period',
    (definition.value->>'discount_max_uses')::integer
  from jsonb_array_elements(p_entitlements) with ordinality as definition(value, ordinality);

  select coalesce(jsonb_agg(to_jsonb(entitlement) order by entitlement.position), '[]'::jsonb)
    into v_entitlements
  from public.club_product_entitlements entitlement
  where entitlement.product_id = v_product.id;

  return jsonb_build_object('product', to_jsonb(v_product), 'entitlements', v_entitlements);
end;
$$;

create or replace function public.club_assign_product(
  p_organisation_id uuid,
  p_product_id uuid,
  p_holder_user_ids uuid[],
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_product public.club_products%rowtype;
  v_membership public.club_memberships%rowtype;
  v_holder_user_ids uuid[];
  v_holders jsonb;
  v_grants jsonb;
begin
  select * into v_product
  from public.club_products
  where id = p_product_id and organisation_id = p_organisation_id
  for share;

  if not found then
    raise exception 'Club product not found in organisation' using errcode = 'P0002';
  end if;
  if auth.uid() is null or not public.club_has_active_role(v_product.organisation_id, array['gym_admin','owner']) then
    raise exception 'Club product assignment is not permitted' using errcode = '42501';
  end if;
  if v_product.archived_at is not null then
    raise exception 'Archived Club products cannot be newly assigned' using errcode = '22023';
  end if;
  if p_starts_at is null or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise exception 'Invalid Club membership validity' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('purchase','subscription','staff_assignment','promotion','migration','founding') then
    raise exception 'Invalid Club assignment source' using errcode = '22023';
  end if;
  if p_holder_user_ids is null or cardinality(p_holder_user_ids) = 0
     or exists (select 1 from unnest(p_holder_user_ids) as supplied(user_id) where supplied.user_id is null) then
    raise exception 'At least one valid Club membership holder is required' using errcode = '22023';
  end if;

  select array_agg(holder.user_id order by holder.user_id)
    into v_holder_user_ids
  from (select distinct unnest(p_holder_user_ids) as user_id) holder;

  if (select count(*) from public.club_members member
      where member.organisation_id = v_product.organisation_id
        and member.user_id = any(v_holder_user_ids)
        and member.active) <> cardinality(v_holder_user_ids) then
    raise exception 'Every holder must be an active member of the product organisation' using errcode = '22023';
  end if;

  -- Product updates take FOR UPDATE on this row. The table lock also prevents a
  -- direct entitlement-definition write from changing the snapshot mid-assignment.
  lock table public.club_product_entitlements in share mode;

  insert into public.club_memberships (
    organisation_id, product_id, status, starts_at, ends_at, source
  ) values (
    v_product.organisation_id, v_product.id, 'active', p_starts_at, p_ends_at, p_source
  ) returning * into v_membership;

  insert into public.club_membership_holders (membership_id, user_id)
  select v_membership.id, holder.user_id
  from unnest(v_holder_user_ids) as holder(user_id);

  insert into public.club_entitlement_grants (
    user_id, organisation_id, membership_id, entitlement_key, scope, location_ids,
    allowance_quantity, allowance_period, discount_percent, discount_period,
    discount_max_uses, starts_at, ends_at, source
  )
  select
    holder.user_id,
    v_membership.organisation_id,
    v_membership.id,
    definition.entitlement_key,
    definition.scope,
    coalesce(definition.location_ids, '{}'::uuid[]),
    definition.allowance_quantity,
    definition.allowance_period,
    definition.discount_percent,
    definition.discount_period,
    definition.discount_max_uses,
    v_membership.starts_at,
    v_membership.ends_at,
    v_membership.source
  from unnest(v_holder_user_ids) as holder(user_id)
  cross join public.club_product_entitlements definition
  where definition.product_id = v_product.id;

  select coalesce(jsonb_agg(to_jsonb(holder) order by holder.user_id), '[]'::jsonb)
    into v_holders
  from public.club_membership_holders holder
  where holder.membership_id = v_membership.id;

  select coalesce(jsonb_agg(to_jsonb(grant_record) order by grant_record.user_id, grant_record.id), '[]'::jsonb)
    into v_grants
  from public.club_entitlement_grants grant_record
  where grant_record.membership_id = v_membership.id;

  return jsonb_build_object(
    'membership', to_jsonb(v_membership),
    'holders', v_holders,
    'grants', v_grants
  );
end;
$$;

comment on function public.club_create_product(uuid, text, text, integer, text, text, integer, boolean, timestamptz, jsonb)
  is 'Atomically creates one Club product and its ordered entitlement definitions. Repeated calls intentionally create distinct products.';
comment on function public.club_update_product(uuid, text, text, integer, text, text, integer, boolean, timestamptz, jsonb)
  is 'Atomically updates mutable Club product fields and replaces its complete ordered entitlement definition set; issued grants are unchanged.';
comment on function public.club_assign_product(uuid, uuid, uuid[], timestamptz, timestamptz, text)
  is 'Atomically creates one membership, normalized holders, and grants materialised only from persisted product definitions. Repeated calls intentionally create distinct assignments; payment idempotency is future work.';

revoke all on function public.club_create_product(uuid, text, text, integer, text, text, integer, boolean, timestamptz, jsonb) from public;
revoke all on function public.club_update_product(uuid, text, text, integer, text, text, integer, boolean, timestamptz, jsonb) from public;
revoke all on function public.club_assign_product(uuid, uuid, uuid[], timestamptz, timestamptz, text) from public;
grant execute on function public.club_create_product(uuid, text, text, integer, text, text, integer, boolean, timestamptz, jsonb) to authenticated;
grant execute on function public.club_update_product(uuid, text, text, integer, text, text, integer, boolean, timestamptz, jsonb) to authenticated;
grant execute on function public.club_assign_product(uuid, uuid, uuid[], timestamptz, timestamptz, text) to authenticated;
