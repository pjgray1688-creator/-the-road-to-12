-- Replace temporary GSN demo stock with the exact 13 September Rotherham count.
-- Stock remains an immutable movement ledger; this is safe to rerun because
-- every correction has a stable idempotency key.
do $$
declare
  v_rotherham_id uuid;
  v_carlton_id uuid;
begin
  select l.id into v_rotherham_id
  from public.club_locations l
  where l.organisation_id = 'fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid
    and l.active and lower(btrim(l.name)) = 'rotherham'
  order by l.id limit 1;

  if v_rotherham_id is null then
    raise exception 'No active Rotherham location exists; no GSN stocktake was written' using errcode = 'P0002';
  end if;

  select l.id into v_carlton_id
  from public.club_locations l
  where l.organisation_id = 'fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid
    and l.active and lower(btrim(l.name)) = 'carlton'
  order by l.id limit 1;

  -- Clear the previous Carlton demo opening stock, if Carlton is configured.
  if v_carlton_id is not null then
    with current as (
      select cp.id, coalesce(sum(sm.quantity_delta), 0)::integer as current_quantity
      from public.club_commerce_products cp
      left join public.club_stock_movements sm
        on sm.organisation_id = cp.organisation_id
       and sm.location_id = v_carlton_id
       and sm.product_id = cp.id
      where cp.organisation_id = 'fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid
        and cp.brand = 'GSN' and cp.active
      group by cp.id
    )
    insert into public.club_stock_movements
      (organisation_id, location_id, product_id, movement_type, quantity_delta, reason, idempotency_key)
    select 'fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid, v_carlton_id, id,
           'stocktake_adjustment', -current_quantity,
           'Clear old GSN demo stock at Carlton before real stock setup',
           'gsn-demo-clear-carlton-2026-09-13:' || id::text
    from current
    where current_quantity <> 0
    on conflict (organisation_id, idempotency_key) do nothing;
  end if;

  -- Apply the exact Rotherham count supplied from the 13 September morning stocktake.
  with counts(name, counted_quantity) as (values
    ('Chicken Black Bean & Special Fried Rice', 13),
    ('Chicken Arrabbiata Pasta with Red Pepper', 8),
    ('Morning Classic English Breakfast', 10),
    ('Chicken Chow Mein with Stir Fry Vegetables', 4),
    ('Mild & Creamy Chicken Korma', 4),
    ('Salt & Pepper Chicken Noodles', 2),
    ('Breaded Chicken Katsu Curry', 2),
    ('Smooth Satay Chicken Curry', 4),
    ('Chicken Macaroni Cheese & Greens', 2),
    ('Creamy Peppercorn Chicken Pasta', 3),
    ('BBQ Chicken & Mexican Rice', 1),
    ('Tender Chicken Tikka Masala', 4),
    ('Rich & Hearty Pasta Bolognese', 1),
    ('Roast Chicken Dinner', 0),
    ('Aromatic Salt & Pepper Wrap', 3),
    ('Korean Sweet Chilli Wrap', 0),
    ('Greek Souvlaki Chicken Wrap', 1),
    ('Sizzling Chicken Fajita Wrap', 0),
    ('Sticky BBQ Chicken Wrap', 2),
    ('English Breakfast Wrap', 0),
    ('Tender Chicken Tikka Wrap', 2),
    ('Pesto Pasta with HECK! Seasoned Chicken', 7),
    ('Oriental Sweet & Sour Chicken', 2)
  ), current as (
    select cp.id, c.counted_quantity,
           coalesce(sum(sm.quantity_delta), 0)::integer as current_quantity
    from counts c
    join public.club_commerce_products cp
      on cp.organisation_id = 'fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid
     and cp.brand = 'GSN' and cp.name = c.name and cp.active
    left join public.club_stock_movements sm
      on sm.organisation_id = cp.organisation_id
     and sm.location_id = v_rotherham_id
     and sm.product_id = cp.id
    group by cp.id, c.counted_quantity
  )
  insert into public.club_stock_movements
    (organisation_id, location_id, product_id, movement_type, quantity_delta, reason, idempotency_key)
  select 'fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid, v_rotherham_id, id,
         'stocktake_adjustment', counted_quantity - current_quantity,
         '13 Sep morning Rotherham gym stocktake — exact manual stocktake',
         'gsn-stocktake-rotherham-2026-09-13:' || id::text
  from current
  where counted_quantity <> current_quantity
  on conflict (organisation_id, idempotency_key) do nothing;
end $$;

-- Verification: Rotherham should equal the supplied exact counts.
-- select cp.name, coalesce(sum(sm.quantity_delta), 0) as resulting_quantity
-- from public.club_commerce_products cp
-- left join public.club_stock_movements sm on sm.organisation_id = cp.organisation_id and sm.product_id = cp.id and sm.location_id = (select id from public.club_locations where organisation_id = cp.organisation_id and active and lower(btrim(name)) = 'rotherham' order by id limit 1)
-- where cp.organisation_id = 'fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid and cp.brand = 'GSN' and cp.active
-- group by cp.id, cp.name order by cp.name;
-- Verification: every active Carlton GSN balance should be zero.
-- select cp.name, coalesce(sum(sm.quantity_delta), 0) as resulting_quantity
-- from public.club_commerce_products cp
-- left join public.club_stock_movements sm on sm.organisation_id = cp.organisation_id and sm.product_id = cp.id and sm.location_id = (select id from public.club_locations where organisation_id = cp.organisation_id and active and lower(btrim(name)) = 'carlton' order by id limit 1)
-- where cp.organisation_id = 'fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid and cp.brand = 'GSN' and cp.active
-- group by cp.id, cp.name order by cp.name;
