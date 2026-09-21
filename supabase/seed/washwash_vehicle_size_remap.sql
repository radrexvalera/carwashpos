-- One-off data migration for the WashWash tenant (id a15d3963-6a8b-433c-8c21-407915ea1437):
-- remaps the old 11-size two-axis classification onto the new 6-tier ladder
-- (Motorcycle/Small/Medium/Large/XL/XXL), per the confirmed mapping in the architecture plan:
--   S -> Small, M -> Medium, L -> Large, XL -> XL, XXL -> XXL (price unchanged)
--   Motorcycle - Small + Motorcycle - Big -> Motorcycle, using the lower (100) price
--   Nano Ceramic Tint: Sedan -> Small, Crossover -> Medium, SUV -> Large, Van -> XL
-- Both mappings involving a merge/approximation are flagged for the user to double-check.
-- Tenant-specific business data, not schema -- same pattern as the earlier washwash_catalog.sql.
-- Safe to re-run: creates the new sizes if missing, upserts prices, and only deletes old sizes
-- that still exist under their old names.

insert into public.vehicle_sizes (tenant_id, name, sort_order) values
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Motorcycle', 1),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Small', 2),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Medium', 3),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Large', 4),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'XL', 5),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'XXL', 6)
on conflict (tenant_id, name) do nothing;

create temporary table tmp_size_map (old_name text, new_name text) on commit drop;
insert into tmp_size_map (old_name, new_name) values
  ('S', 'Small'),
  ('M', 'Medium'),
  ('L', 'Large'),
  ('XL', 'XL'),
  ('XXL', 'XXL'),
  ('Sedan', 'Small'),
  ('Crossover', 'Medium'),
  ('SUV', 'Large'),
  ('Van', 'XL');
  -- Motorcycle - Small / Motorcycle - Big handled separately below (merge, not 1:1 map).

insert into public.service_prices (tenant_id, service_id, vehicle_size_id, price)
select 'a15d3963-6a8b-433c-8c21-407915ea1437', sp.service_id, new_size.id, sp.price
from public.service_prices sp
join public.vehicle_sizes old_size on old_size.id = sp.vehicle_size_id
  and old_size.tenant_id = 'a15d3963-6a8b-433c-8c21-407915ea1437'
join tmp_size_map m on m.old_name = old_size.name
join public.vehicle_sizes new_size on new_size.tenant_id = 'a15d3963-6a8b-433c-8c21-407915ea1437'
  and new_size.name = m.new_name
where old_size.name not in ('XL', 'XXL')  -- these keep their existing row, nothing to migrate
on conflict (service_id, vehicle_size_id) do update set price = excluded.price;

-- Motorcycle - Small / Motorcycle - Big -> Motorcycle, lower price wins where both exist for the
-- same service (only Premium Carwash has both today: 100/150 -> 100).
insert into public.service_prices (tenant_id, service_id, vehicle_size_id, price)
select 'a15d3963-6a8b-433c-8c21-407915ea1437', sp.service_id, moto.id, min(sp.price)
from public.service_prices sp
join public.vehicle_sizes old_size on old_size.id = sp.vehicle_size_id
  and old_size.tenant_id = 'a15d3963-6a8b-433c-8c21-407915ea1437'
  and old_size.name in ('Motorcycle - Small', 'Motorcycle - Big')
join public.vehicle_sizes moto on moto.tenant_id = 'a15d3963-6a8b-433c-8c21-407915ea1437' and moto.name = 'Motorcycle'
group by sp.service_id, moto.id
on conflict (service_id, vehicle_size_id) do update set price = least(service_prices.price, excluded.price);

-- Remove the old size rows -- cascades to their now-migrated service_prices rows automatically
-- (vehicle_size_id has ON DELETE CASCADE). XL/XXL are excluded since those rows were kept in place.
delete from public.vehicle_sizes
where tenant_id = 'a15d3963-6a8b-433c-8c21-407915ea1437'
  and name in ('S', 'M', 'L', 'Sedan', 'Crossover', 'SUV', 'Van', 'Motorcycle - Small', 'Motorcycle - Big');
