-- Estimated consumable usage per service, optionally varying by vehicle size (spec section 21).
-- No separate "recipe" header entity -- a service's recipe is just its set of rows here, which
-- keeps this from needing an extra table with no metadata of its own (same simplification
-- already applied to commission's role-based splits: satisfy the functional requirement without
-- an entity that would carry no additional information).
--
-- vehicle_size_id null means "applies to any size" -- a size-specific row for the same
-- (service_id, item_id) takes precedence over the null-size default, handled in complete_job().
create table public.service_recipe_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  vehicle_size_id uuid references public.vehicle_sizes(id),
  item_id uuid not null references public.inventory_items(id),
  quantity_used numeric(12, 4) not null check (quantity_used > 0),
  created_at timestamptz not null default now(),
  unique (service_id, vehicle_size_id, item_id)
);
create index service_recipe_items_tenant_id_idx on public.service_recipe_items(tenant_id);
create index service_recipe_items_service_id_idx on public.service_recipe_items(service_id);

alter table public.service_recipe_items enable row level security;

create policy service_recipe_items_select on public.service_recipe_items
  for select using (tenant_id = public.current_tenant_id());

create policy service_recipe_items_insert on public.service_recipe_items
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_inventory'));

create policy service_recipe_items_update on public.service_recipe_items
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_inventory'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_inventory'));

create policy service_recipe_items_delete on public.service_recipe_items
  for delete using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_inventory'));
