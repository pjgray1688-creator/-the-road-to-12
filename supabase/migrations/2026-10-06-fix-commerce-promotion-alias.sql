-- Correct the live commerce promotion evaluator without changing its business rules.
-- The declared PL/pgSQL variable `a` conflicted with the table alias `a` in the
-- final aggregate, causing create_commerce_order to fail with SQLSTATE 42702.
do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.club_evaluate_commerce_promotions(uuid,uuid,uuid,uuid,jsonb,text)'::regprocedure)
    into definition;
  definition := replace(definition,
    'from jsonb_array_elements(applied) a));',
    'from jsonb_array_elements(applied) applied_row));');
  definition := replace(definition,
    'sum((a->>''applied_saving_minor'')::integer)',
    'sum((applied_row->>''applied_saving_minor'')::integer)');
  if definition = pg_get_functiondef('public.club_evaluate_commerce_promotions(uuid,uuid,uuid,uuid,jsonb,text)'::regprocedure) then
    raise exception 'Expected promotion alias was not found';
  end if;
  execute definition;
end $$;
