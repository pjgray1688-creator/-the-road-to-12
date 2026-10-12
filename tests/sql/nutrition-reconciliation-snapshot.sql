\set ON_ERROR_STOP on
select md5(jsonb_build_object(
  'plans',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.nutrition_plans r),
  'targets',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.nutrition_targets r),
  'meals',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.nutrition_meals r),
  'items',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.nutrition_meal_items r),
  'alternatives',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.nutrition_meal_alternatives r),
  'supplements',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.nutrition_supplements r),
  'checkins',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.nutrition_daily_checkins r),
  'extras',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.nutrition_extras r),
  'feedback',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.nutrition_coach_feedback r)
)::text) as nutrition_data_fingerprint;
