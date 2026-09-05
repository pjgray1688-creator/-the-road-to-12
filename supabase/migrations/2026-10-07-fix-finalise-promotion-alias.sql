-- Qualify the SQL alias used by order finalisation.  The promotion finaliser
-- also declares PL/pgSQL record `e`; reusing `e` as a query alias makes
-- e.promotion_id ambiguous (42702) when a paid order is finalised.
do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.club_finalize_paid_order(uuid,uuid)'::regprocedure)
    into definition;
  definition := replace(definition,
    'from public.club_promotion_applied_orders e join public.club_promotions pr on pr.id=e.promotion_id where e.order_id=o.id',
    'from public.club_promotion_applied_orders applied_promotion join public.club_promotions pr on pr.id=applied_promotion.promotion_id where applied_promotion.order_id=o.id');
  if definition = pg_get_functiondef('public.club_finalize_paid_order(uuid,uuid)'::regprocedure) then
    raise exception 'Expected finalisation promotion alias was not found';
  end if;
  execute definition;
end $$;
