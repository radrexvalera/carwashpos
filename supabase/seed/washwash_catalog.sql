-- One-off catalog load for the WashWash tenant (id a15d3963-6a8b-433c-8c21-407915ea1437),
-- sourced from photographed OtoKwikk price boards (Bundle Promo, Service Price List, Nano Ceramic
-- Tint) on 2026-09-21. Tenant-specific business data, not schema -- deliberately NOT a numbered
-- migration. Safe to re-run: size classes and services are guarded, prices upsert.
--
-- Two size taxonomies coexist on purpose, matching the real price boards: Motorcycle-Small/Big and
-- S/M/L/XL/XXL for most services, and Sedan/Crossover/SUV/Van for the Tint service specifically. A
-- service only gets prices for the sizes its board actually lists; any other size combo is simply
-- unpriced, and the POS already disables a service button when the selected size has no price.
--
-- Bundles (Deluxe/Premium/Otokwikk Special) are modeled as plain services with their own flat
-- price-per-size for now, not as a "promotion" entity -- the Promotions module (Phase 5) doesn't
-- exist yet. When it does, these are natural candidates to convert into real bundle promotions.

update public.vehicle_size_classes set name = 'Van', sort_order = 11
where tenant_id = 'a15d3963-6a8b-433c-8c21-407915ea1437' and name = 'Van/Pickup';

update public.vehicle_size_classes set sort_order = 8
where tenant_id = 'a15d3963-6a8b-433c-8c21-407915ea1437' and name = 'Sedan';

update public.vehicle_size_classes set sort_order = 10
where tenant_id = 'a15d3963-6a8b-433c-8c21-407915ea1437' and name = 'SUV';

insert into public.vehicle_size_classes (tenant_id, name, sort_order) values
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Motorcycle - Small', 1),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Motorcycle - Big', 2),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'S', 3),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'M', 4),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'L', 5),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'XL', 6),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'XXL', 7),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Crossover', 9)
on conflict (tenant_id, name) do nothing;

insert into public.services (tenant_id, name, category)
select 'a15d3963-6a8b-433c-8c21-407915ea1437', v.name, v.category
from (values
  ('Premium Carwash', 'Wash'),
  ('Engine Steamed Wash', 'Wash'),
  ('Premium Hand Wax', 'Wash'),
  ('Buffing', 'Detailing'),
  ('Headlight Restoration', 'Detailing'),
  ('Interior Detailing', 'Detailing'),
  ('Exterior Detailing', 'Detailing'),
  ('Acid Rain Removal', 'Detailing'),
  ('All Shine', 'Detailing'),
  ('Ceramic Coating', 'Coating'),
  ('Deluxe Bundle', 'Bundle'),
  ('Premium Bundle', 'Bundle'),
  ('Otokwikk Special', 'Bundle'),
  ('Nano Ceramic Tint', 'Tint')
) as v(name, category)
where not exists (
  select 1 from public.services s
  where s.tenant_id = 'a15d3963-6a8b-433c-8c21-407915ea1437' and s.name = v.name
);

create temporary table tmp_prices (service_name text, size_name text, price numeric) on commit drop;

insert into tmp_prices (service_name, size_name, price) values
  ('Premium Carwash', 'Motorcycle - Small', 100),
  ('Premium Carwash', 'Motorcycle - Big', 150),
  ('Premium Carwash', 'S', 170),
  ('Premium Carwash', 'M', 210),
  ('Premium Carwash', 'L', 240),
  ('Premium Carwash', 'XL', 270),
  ('Premium Carwash', 'XXL', 320),

  ('Engine Steamed Wash', 'S', 500),
  ('Engine Steamed Wash', 'M', 550),
  ('Engine Steamed Wash', 'L', 600),
  ('Engine Steamed Wash', 'XL', 650),
  ('Engine Steamed Wash', 'XXL', 700),

  ('Premium Hand Wax', 'S', 500),
  ('Premium Hand Wax', 'M', 550),
  ('Premium Hand Wax', 'L', 600),
  ('Premium Hand Wax', 'XL', 650),
  ('Premium Hand Wax', 'XXL', 700),

  ('Buffing', 'Motorcycle - Small', 500),
  ('Buffing', 'Motorcycle - Big', 500),
  ('Buffing', 'S', 1100),
  ('Buffing', 'M', 1300),
  ('Buffing', 'L', 1500),
  ('Buffing', 'XL', 1700),
  ('Buffing', 'XXL', 1900),

  ('Headlight Restoration', 'S', 750),
  ('Headlight Restoration', 'M', 750),
  ('Headlight Restoration', 'L', 750),
  ('Headlight Restoration', 'XL', 750),
  ('Headlight Restoration', 'XXL', 750),

  ('Interior Detailing', 'S', 3000),
  ('Interior Detailing', 'M', 3500),
  ('Interior Detailing', 'L', 4000),
  ('Interior Detailing', 'XL', 4500),
  ('Interior Detailing', 'XXL', 5000),

  ('Exterior Detailing', 'S', 3500),
  ('Exterior Detailing', 'M', 4000),
  ('Exterior Detailing', 'L', 4500),
  ('Exterior Detailing', 'XL', 5000),
  ('Exterior Detailing', 'XXL', 5500),

  ('Acid Rain Removal', 'S', 1000),
  ('Acid Rain Removal', 'M', 1200),
  ('Acid Rain Removal', 'L', 1400),
  ('Acid Rain Removal', 'XL', 1600),
  ('Acid Rain Removal', 'XXL', 1800),

  ('All Shine', 'Motorcycle - Small', 50),
  ('All Shine', 'Motorcycle - Big', 50),
  ('All Shine', 'S', 100),
  ('All Shine', 'M', 150),
  ('All Shine', 'L', 200),
  ('All Shine', 'XL', 250),
  ('All Shine', 'XXL', 300),

  ('Ceramic Coating', 'Motorcycle - Small', 2500),
  ('Ceramic Coating', 'Motorcycle - Big', 2500),
  ('Ceramic Coating', 'S', 8999),
  ('Ceramic Coating', 'M', 11999),
  ('Ceramic Coating', 'L', 14999),
  ('Ceramic Coating', 'XL', 15999),
  ('Ceramic Coating', 'XXL', 17999),

  ('Deluxe Bundle', 'S', 599),
  ('Deluxe Bundle', 'M', 749),
  ('Deluxe Bundle', 'L', 849),
  ('Deluxe Bundle', 'XL', 999),

  ('Premium Bundle', 'S', 1699),
  ('Premium Bundle', 'M', 1899),
  ('Premium Bundle', 'L', 2099),
  ('Premium Bundle', 'XL', 2299),

  ('Otokwikk Special', 'S', 7000),
  ('Otokwikk Special', 'M', 8149),
  ('Otokwikk Special', 'L', 9199),
  ('Otokwikk Special', 'XL', 10399),

  ('Nano Ceramic Tint', 'Sedan', 6999),
  ('Nano Ceramic Tint', 'Crossover', 7999),
  ('Nano Ceramic Tint', 'SUV', 8999),
  ('Nano Ceramic Tint', 'Van', 10999);

insert into public.service_prices (tenant_id, service_id, vehicle_size_class_id, price)
select 'a15d3963-6a8b-433c-8c21-407915ea1437', s.id, vsc.id, tp.price
from tmp_prices tp
join public.services s
  on s.tenant_id = 'a15d3963-6a8b-433c-8c21-407915ea1437' and s.name = tp.service_name
join public.vehicle_size_classes vsc
  on vsc.tenant_id = 'a15d3963-6a8b-433c-8c21-407915ea1437' and vsc.name = tp.size_name
on conflict (service_id, vehicle_size_class_id) do update set price = excluded.price;
