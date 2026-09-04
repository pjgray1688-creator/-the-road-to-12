-- Provider-neutral payment attempts and safe Madhouse Balance holds.
-- Review-only: execute after 2026-09-25. No external provider is enabled by this migration.

create table if not exists public.club_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  order_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','paid','failed','cancelled')),
  external_method text check (external_method is null or external_method in ('card','klarna','clearpay','paypal','bank_transfer')),
  total_minor integer not null check (total_minor > 0),
  external_amount_minor integer not null default 0 check (external_amount_minor >= 0),
  idempotency_key text not null,
  failure_reason text,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  unique (organisation_id, idempotency_key),
  foreign key (order_id, organisation_id) references public.club_orders(id, organisation_id) on delete restrict
);

create table if not exists public.club_balance_holds (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  account_id uuid not null,
  order_id uuid not null,
  payment_attempt_id uuid not null,
  amount_minor integer not null check (amount_minor > 0),
  status text not null default 'held' check (status in ('held','captured','released')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  unique (organisation_id, idempotency_key),
  unique (payment_attempt_id, organisation_id),
  foreign key (account_id, organisation_id) references public.club_balance_accounts(id, organisation_id) on delete restrict,
  foreign key (order_id, organisation_id) references public.club_orders(id, organisation_id) on delete restrict,
  foreign key (payment_attempt_id, organisation_id) references public.club_payment_attempts(id, organisation_id) on delete restrict
);

alter table public.club_payment_attempts enable row level security;
alter table public.club_balance_holds enable row level security;
revoke all on table public.club_payment_attempts, public.club_balance_holds from public, anon, authenticated;

create or replace function public.club_create_payment_attempt(
  p_organisation_id uuid, p_order_id uuid, p_balance_amount_minor integer,
  p_external_method text, p_external_amount_minor integer, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_order public.club_orders%rowtype;
  v_account public.club_balance_accounts%rowtype;
  v_attempt public.club_payment_attempts%rowtype;
  v_hold public.club_balance_holds%rowtype;
  v_available integer;
begin
  if auth.uid() is null or p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Payment attempt is not valid' using errcode='42501';
  end if;
  select * into v_order from public.club_orders where id=p_order_id and organisation_id=p_organisation_id for update;
  if not found or v_order.status <> 'pending_payment' or v_order.user_id is distinct from auth.uid() then
    raise exception 'Order is not available for payment' using errcode='42501';
  end if;
  if p_balance_amount_minor < 0 or p_external_amount_minor < 0 or p_balance_amount_minor + p_external_amount_minor <> v_order.total_minor then
    raise exception 'Payment amounts do not match order total' using errcode='22023';
  end if;
  if p_external_method is not null and p_external_amount_minor = 0 then
    raise exception 'External payment amount must be positive' using errcode='22023';
  end if;
  if p_external_amount_minor > 0 and p_external_method is null then
    raise exception 'An external payment method is required' using errcode='22023';
  end if;
  if p_external_method is not null and p_external_method not in ('card','klarna','clearpay','paypal','bank_transfer') then
    raise exception 'External payment method is not supported' using errcode='22023';
  end if;
  select * into v_attempt from public.club_payment_attempts where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key;
  if found then
    return jsonb_build_object('attempt',to_jsonb(v_attempt),'hold',(select to_jsonb(h) from public.club_balance_holds h where h.payment_attempt_id=v_attempt.id));
  end if;
  -- An order has one active payment attempt at a time. This prevents two external
  -- processors (or two different external methods) being attached concurrently.
  if exists(select 1 from public.club_payment_attempts where organisation_id=p_organisation_id and order_id=p_order_id and status='pending') then
    raise exception 'Another payment attempt is already in progress' using errcode='22023';
  end if;
  if p_balance_amount_minor > 0 then
    select * into v_account from public.club_balance_accounts where organisation_id=p_organisation_id and user_id=auth.uid() and status='active' for update;
    if not found then raise exception 'Balance account not found' using errcode='P0002'; end if;
    v_available := coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=v_account.id),0)
      - coalesce((select sum(amount_minor) from public.club_balance_holds where account_id=v_account.id and status='held'),0);
    if v_available < p_balance_amount_minor then raise exception 'Insufficient Madhouse Balance' using errcode='22023'; end if;
  end if;
  insert into public.club_payment_attempts(organisation_id,order_id,user_id,total_minor,external_method,external_amount_minor,idempotency_key)
    values(p_organisation_id,p_order_id,auth.uid(),v_order.total_minor,p_external_method,p_external_amount_minor,p_idempotency_key) returning * into v_attempt;
  if p_balance_amount_minor > 0 then
    insert into public.club_balance_holds(organisation_id,account_id,order_id,payment_attempt_id,amount_minor,idempotency_key)
      values(p_organisation_id,v_account.id,p_order_id,v_attempt.id,p_balance_amount_minor,p_idempotency_key) returning * into v_hold;
  end if;
  return jsonb_build_object('attempt',to_jsonb(v_attempt),'hold',case when v_hold.id is null then null else to_jsonb(v_hold) end);
end; $$;

create or replace function public.club_release_payment_attempt(p_attempt_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_attempt public.club_payment_attempts%rowtype; v_hold public.club_balance_holds%rowtype;
begin
  select * into v_attempt from public.club_payment_attempts where id=p_attempt_id and user_id=auth.uid() for update;
  if not found then raise exception 'Payment attempt not found' using errcode='P0002'; end if;
  if v_attempt.status='paid' then raise exception 'Paid payment cannot be released' using errcode='22023'; end if;
  update public.club_payment_attempts set status='cancelled',failure_reason=nullif(btrim(p_reason),''),updated_at=now() where id=v_attempt.id returning * into v_attempt;
  update public.club_balance_holds set status='released',updated_at=now() where payment_attempt_id=v_attempt.id and status='held' returning * into v_hold;
  return jsonb_build_object('attempt',to_jsonb(v_attempt),'hold',case when v_hold.id is null then null else to_jsonb(v_hold) end);
end; $$;

revoke all on function public.club_create_payment_attempt(uuid,uuid,integer,text,integer,text) from public,anon;
revoke all on function public.club_release_payment_attempt(uuid,text) from public,anon;
grant execute on function public.club_create_payment_attempt(uuid,uuid,integer,text,integer,text) to authenticated;
grant execute on function public.club_release_payment_attempt(uuid,text) to authenticated;

comment on table public.club_payment_attempts is 'Provider-neutral pending payment intents. No provider approval or payment success is implied.';
comment on table public.club_balance_holds is 'Temporary internal Madhouse Balance reservations released on failed/cancelled external payment.';
