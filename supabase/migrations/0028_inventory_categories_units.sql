-- Inventory foundation: categories (admin-defined groupings) and units of measure with optional
-- conversion to a base unit (spec example: 1 gallon = 3.785 liters). Purchases/recipes can record
-- quantities in whatever unit is natural; conversion happens once, server-side, when posting to
-- the ledger, so stock is always tracked in one consistent unit per item.
create table public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index inventory_categories_tenant_id_idx on public.inventory_categories(tenant_id);

create table public.inventory_units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  abbreviation text not null,
  base_unit_id uuid references public.inventory_units(id),
  conversion_factor numeric(12, 6) not null default 1 check (conversion_factor > 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index inventory_units_tenant_id_idx on public.inventory_units(tenant_id);

alter table public.inventory_categories enable row level security;
create policy inventory_categories_select on public.inventory_categories
  for select using (tenant_id = public.current_tenant_id());
create policy inventory_categories_insert on public.inventory_categories
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_inventory'));
create policy inventory_categories_update on public.inventory_categories
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_inventory'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_inventory'));

alter table public.inventory_units enable row level security;
create policy inventory_units_select on public.inventory_units
  for select using (tenant_id = public.current_tenant_id());
create policy inventory_units_insert on public.inventory_units
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_inventory'));
create policy inventory_units_update on public.inventory_units
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_inventory'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_inventory'));

-- Seed a sensible starting set of units for every tenant (existing ones backfilled below, new ones
-- via the tenant-seed trigger, updated in the next migration once other seed steps are settled).
insert into public.inventory_units (tenant_id, name, abbreviation) values
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Piece', 'pc'),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Liter', 'L'),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Milliliter', 'ml'),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Bottle', 'btl'),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Pack', 'pack'),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Box', 'box'),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Kilogram', 'kg'),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Gram', 'g');

update public.inventory_units set base_unit_id = (select id from public.inventory_units where tenant_id = 'a15d3963-6a8b-433c-8c21-407915ea1437' and name = 'Liter'), conversion_factor = 0.001
where tenant_id = 'a15d3963-6a8b-433c-8c21-407915ea1437' and name = 'Milliliter';

update public.inventory_units set base_unit_id = (select id from public.inventory_units where tenant_id = 'a15d3963-6a8b-433c-8c21-407915ea1437' and name = 'Kilogram'), conversion_factor = 0.001
where tenant_id = 'a15d3963-6a8b-433c-8c21-407915ea1437' and name = 'Gram';

insert into public.inventory_units (tenant_id, name, abbreviation, base_unit_id, conversion_factor)
select 'a15d3963-6a8b-433c-8c21-407915ea1437', 'Gallon', 'gal', id, 3.785
from public.inventory_units where tenant_id = 'a15d3963-6a8b-433c-8c21-407915ea1437' and name = 'Liter';
