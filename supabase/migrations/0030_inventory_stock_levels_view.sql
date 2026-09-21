-- Derives on-hand quantity, latest cost, and a quantity-weighted average cost purely from the
-- ledger -- there is no stored stock_qty/unit_cost column anywhere to drift out of sync with this.
-- security_invoker inherits RLS from the underlying tables.
create view public.inventory_stock_levels
with (security_invoker = true) as
select
  i.id,
  i.tenant_id,
  i.name,
  i.sku,
  i.item_type,
  i.category_id,
  i.unit_id,
  u.abbreviation as unit_abbreviation,
  i.retail_price,
  i.min_stock,
  i.reorder_level,
  i.target_stock,
  i.is_active,
  coalesce(t.on_hand_qty, 0) as on_hand_qty,
  latest.unit_cost_at_time as latest_unit_cost,
  avg_cost.average_unit_cost,
  coalesce(t.on_hand_qty, 0) * coalesce(avg_cost.average_unit_cost, 0) as inventory_value,
  (i.reorder_level is not null and coalesce(t.on_hand_qty, 0) <= i.reorder_level) as is_low_stock
from public.inventory_items i
join public.inventory_units u on u.id = i.unit_id
left join lateral (
  select sum(quantity_delta) as on_hand_qty
  from public.inventory_transactions
  where item_id = i.id
) t on true
left join lateral (
  select unit_cost_at_time
  from public.inventory_transactions
  where item_id = i.id and unit_cost_at_time is not null
  order by created_at desc
  limit 1
) latest on true
left join lateral (
  select sum(quantity_delta * unit_cost_at_time) / nullif(sum(quantity_delta), 0) as average_unit_cost
  from public.inventory_transactions
  where item_id = i.id and quantity_delta > 0 and unit_cost_at_time is not null
) avg_cost on true;

grant select on public.inventory_stock_levels to authenticated;
