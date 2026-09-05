-- Final paid-order settlement is idempotent per organisation and movement key.
-- Ensure the constraint assumed by the canonical finaliser exists before the
-- stock movement ON CONFLICT target is used.
create unique index if not exists club_stock_movements_idempotency_unique
  on public.club_stock_movements (organisation_id, idempotency_key)
  where idempotency_key is not null;
