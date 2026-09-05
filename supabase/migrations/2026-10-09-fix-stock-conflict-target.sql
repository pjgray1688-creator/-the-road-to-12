-- Match the stock idempotency conflict target to its partial unique index.
-- PostgreSQL cannot infer a partial index unless the conflict predicate is
-- included in the ON CONFLICT target.
do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.club_finalize_paid_order(uuid,uuid)'::regprocedure)
    into definition;
  definition := replace(definition,
    'on conflict (organisation_id,idempotency_key) do nothing',
    'on conflict (organisation_id,idempotency_key) where idempotency_key is not null do nothing');
  if definition = pg_get_functiondef('public.club_finalize_paid_order(uuid,uuid)'::regprocedure) then
    raise exception 'Expected stock conflict target was not found';
  end if;
  execute definition;
end $$;
