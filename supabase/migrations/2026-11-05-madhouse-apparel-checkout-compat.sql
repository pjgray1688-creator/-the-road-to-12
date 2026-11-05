-- Forward-only compatibility repair for guest Apparel checkout.
-- The order-preparation RPC snapshots website variants and assigns the
-- Products & Services merchant before Stripe is contacted. These additive
-- declarations are safe when the later merchant-isolation migration already
-- supplied the same columns and constraints.

alter table public.club_order_items
  add column if not exists website_public_slug text,
  add column if not exists variant_colour text,
  add column if not exists variant_size text,
  add column if not exists discount_quantity integer not null default 0,
  add column if not exists discount_minor integer not null default 0;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.club_order_items'::regclass and conname='club_order_items_discount_quantity_check')
     and not exists (select 1 from pg_constraint where conrelid='public.club_order_items'::regclass and conname='club_order_items_website_discount_quantity_ck') then
    alter table public.club_order_items add constraint club_order_items_website_discount_quantity_ck check (discount_quantity>=0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.club_order_items'::regclass and conname='club_order_items_discount_minor_check')
     and not exists (select 1 from pg_constraint where conrelid='public.club_order_items'::regclass and conname='club_order_items_website_discount_minor_ck') then
    alter table public.club_order_items add constraint club_order_items_website_discount_minor_ck check (discount_minor>=0);
  end if;
end $$;

alter table public.club_payment_attempts
  add column if not exists stripe_merchant_entity text,
  add column if not exists stripe_account_id text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_payment_intent_id text;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.club_payment_attempts'::regclass and conname='club_payment_attempts_stripe_entity_ck') then
    alter table public.club_payment_attempts add constraint club_payment_attempts_stripe_entity_ck
      check (stripe_merchant_entity is null or stripe_merchant_entity='madhouse_products_services');
  end if;
end $$;

create unique index if not exists club_payment_attempts_stripe_session_uq
  on public.club_payment_attempts(stripe_account_id,stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create unique index if not exists club_payment_attempts_stripe_intent_uq
  on public.club_payment_attempts(stripe_account_id,stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

comment on column public.club_payment_attempts.stripe_merchant_entity is
  'Explicit merchant assignment for payment attempts. Website Apparel must use madhouse_products_services.';
