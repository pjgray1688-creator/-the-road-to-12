-- Disabled, no-payment foundation for the specifically approved Madhouse
-- PayPal Pay in 3 products. This migration creates no customer/order/payment
-- rows and contains no provider calls or entitlement-grant path.

create table if not exists public.club_paypal_pay_in_3_settings (
  organisation_id uuid primary key references public.club_organisations(id) on delete cascade,
  legal_entity_number text not null check (legal_entity_number = '17383077'),
  merchant_account_id text,
  paypal_approved boolean not null default false,
  accountant_approved boolean not null default false,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.club_paypal_pay_in_3_settings(organisation_id,legal_entity_number)
select id,'17383077' from public.club_organisations where slug='madhouse-gym'
on conflict (organisation_id) do nothing;

create table if not exists public.club_paypal_pay_in_3_product_codes (
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  product_id uuid not null,
  canonical_product_code text not null check (canonical_product_code in (
    'madhouse.transformation.bronze.v1',
    'madhouse.transformation.silver.v1',
    'madhouse.transformation.gold.v1',
    'madhouse.membership.yearly.v1',
    'madhouse.membership.golden-ticket-lifetime.v1'
  )),
  created_at timestamptz not null default now(),
  primary key (organisation_id,product_id),
  unique (organisation_id,canonical_product_code),
  foreign key (product_id,organisation_id) references public.club_products(id,organisation_id) on delete restrict
);

-- Product names are used only once here to bind the existing canonical
-- catalogue rows to immutable codes. Runtime checkout uses product_id/code,
-- never a name or amount. Ambiguous or structurally mismatched rows stay
-- unmapped and therefore fail closed.
with expected(name,code,kind,billing,duration_days,is_lifetime,sellable) as (values
  ('Transformation Bronze','madhouse.transformation.bronze.v1','transformation','one_off',70,false,true),
  ('Transformation Silver','madhouse.transformation.silver.v1','transformation','one_off',70,false,true),
  ('Transformation Gold','madhouse.transformation.gold.v1','transformation','one_off',70,false,true),
  ('Yearly Membership','madhouse.membership.yearly.v1','membership','one_off',365,false,true),
  ('Golden Ticket Founding Membership','madhouse.membership.golden-ticket-lifetime.v1','membership','one_off',null,true,false)
), matches as (
  select p.organisation_id,p.id product_id,e.code
  from public.club_organisations o
  join public.club_products p on p.organisation_id=o.id
  join expected e on e.name=p.name and e.kind=p.kind and e.billing=p.billing
    and e.duration_days is not distinct from p.duration_days
    and e.is_lifetime is not distinct from coalesce(p.is_lifetime,false)
    and e.sellable=p.sellable and p.archived_at is null
  where o.slug='madhouse-gym'
  group by p.organisation_id,p.id,e.code
), unique_matches as (
  select organisation_id,product_id,code
  from (select matches.*,count(*) over(partition by organisation_id,code) as code_matches from matches) candidates
  where code_matches=1
)
insert into public.club_paypal_pay_in_3_product_codes(organisation_id,product_id,canonical_product_code)
select organisation_id,product_id,code from unique_matches
on conflict do nothing;

create or replace function public.club_bind_paypal_pay_in_3_product_code()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_code text;
begin
  if not exists(select 1 from public.club_organisations where id=new.organisation_id and slug='madhouse-gym') or new.archived_at is not null then return new; end if;
  v_code:=case
    when new.name='Transformation Bronze' and new.kind='transformation' and new.billing='one_off' and new.duration_days=70 and not coalesce(new.is_lifetime,false) and new.sellable then 'madhouse.transformation.bronze.v1'
    when new.name='Transformation Silver' and new.kind='transformation' and new.billing='one_off' and new.duration_days=70 and not coalesce(new.is_lifetime,false) and new.sellable then 'madhouse.transformation.silver.v1'
    when new.name='Transformation Gold' and new.kind='transformation' and new.billing='one_off' and new.duration_days=70 and not coalesce(new.is_lifetime,false) and new.sellable then 'madhouse.transformation.gold.v1'
    when new.name='Yearly Membership' and new.kind='membership' and new.billing='one_off' and new.duration_days=365 and not coalesce(new.is_lifetime,false) and new.sellable then 'madhouse.membership.yearly.v1'
    when new.name='Golden Ticket Founding Membership' and new.kind='membership' and new.billing='one_off' and new.duration_days is null and coalesce(new.is_lifetime,false) and not new.sellable then 'madhouse.membership.golden-ticket-lifetime.v1'
    else null end;
  if v_code is not null then
    insert into public.club_paypal_pay_in_3_product_codes(organisation_id,product_id,canonical_product_code)
    values(new.organisation_id,new.id,v_code) on conflict (organisation_id,product_id) do nothing;
  end if;
  return new;
end; $$;
revoke all on function public.club_bind_paypal_pay_in_3_product_code() from public,anon,authenticated;
drop trigger if exists club_bind_paypal_pay_in_3_product_code on public.club_products;
create trigger club_bind_paypal_pay_in_3_product_code
after insert or update of name,kind,billing,duration_days,is_lifetime,sellable,archived_at
on public.club_products for each row execute function public.club_bind_paypal_pay_in_3_product_code();

-- Prepared-order storage contract only. Rows are not created by this release;
-- provider order/capture IDs are unique and idempotency is scoped to the buyer.
create table if not exists public.club_paypal_pay_in_3_orders (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  requesting_user_id uuid not null references auth.users(id) on delete restrict,
  buyer_user_id uuid references auth.users(id) on delete restrict,
  golden_ticket_customer_id uuid,
  golden_ticket_authorised_by uuid references auth.users(id) on delete restrict,
  golden_ticket_authorisation_reason text,
  product_id uuid not null,
  canonical_product_code text not null check (canonical_product_code in (
    'madhouse.transformation.bronze.v1','madhouse.transformation.silver.v1','madhouse.transformation.gold.v1',
    'madhouse.membership.yearly.v1','madhouse.membership.golden-ticket-lifetime.v1'
  )),
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (currency='GBP'),
  receiving_entity_number text not null default '17383077' check (receiving_entity_number='17383077'),
  merchant_account_id text not null,
  idempotency_key text not null check (length(btrim(idempotency_key)) between 16 and 200),
  provider_order_id text,
  provider_capture_id text,
  provider_webhook_event_id text,
  provider_refund_id text,
  refund_idempotency_key text,
  refunded_minor integer not null default 0 check (refunded_minor >= 0 and refunded_minor <= amount_minor),
  audit_event_id uuid references public.club_audit_events(id) on delete restrict,
  status text not null default 'prepared' check (status in ('prepared','created','approved','captured','partially_refunded','refunded','failed','cancelled')),
  created_at timestamptz not null default now(),
  captured_at timestamptz,
  refunded_at timestamptz,
  entitlement_finalized_at timestamptz,
  unique (organisation_id,idempotency_key),
  unique (provider_order_id),
  unique (provider_capture_id),
  unique (provider_webhook_event_id),
  unique (provider_refund_id),
  foreign key (product_id,organisation_id) references public.club_products(id,organisation_id) on delete restrict,
  foreign key (golden_ticket_customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete restrict,
  check (
    (canonical_product_code='madhouse.membership.golden-ticket-lifetime.v1'
      and golden_ticket_customer_id is not null and golden_ticket_authorised_by is not null
      and golden_ticket_authorised_by=requesting_user_id
      and nullif(btrim(golden_ticket_authorisation_reason),'') is not null)
    or
    (canonical_product_code<>'madhouse.membership.golden-ticket-lifetime.v1'
      and buyer_user_id is not null and buyer_user_id=requesting_user_id and golden_ticket_customer_id is null
      and golden_ticket_authorised_by is null and golden_ticket_authorisation_reason is null)
  )
);

create table if not exists public.club_paypal_pay_in_3_webhook_events (
  provider_event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error_code text
);

alter table public.club_paypal_pay_in_3_settings enable row level security;
alter table public.club_paypal_pay_in_3_product_codes enable row level security;
alter table public.club_paypal_pay_in_3_orders enable row level security;
alter table public.club_paypal_pay_in_3_webhook_events enable row level security;
revoke all on public.club_paypal_pay_in_3_settings,public.club_paypal_pay_in_3_product_codes,
  public.club_paypal_pay_in_3_orders,public.club_paypal_pay_in_3_webhook_events from public,anon,authenticated;

comment on table public.club_paypal_pay_in_3_orders is 'Disabled PayPal Pay in 3 order/capture idempotency contract. No capture or entitlement finalizer is installed by this migration.';
comment on table public.club_paypal_pay_in_3_settings is 'Merchant readiness gate; all approval/enabled values default false and require separate review.';
