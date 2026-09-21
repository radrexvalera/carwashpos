-- Collapses the old two-axis vehicle classification (Motorcycle-Small/Big + S/M/L/XL/XXL for most
-- services, Sedan/Crossover/SUV/Van for Tint only) onto the spec's single 6-tier ladder used for
-- ALL pricing: Motorcycle, Small, Medium, Large, XL, XXL. "Vehicle Type" (Sedan/SUV/Pickup/etc) is
-- reintroduced below purely as a descriptive tag on vehicle_models -- it never drives pricing. See
-- plan doc "Structural issues found in the spec" #1.

alter table public.vehicle_size_classes rename to vehicle_sizes;
alter index vehicle_size_classes_pkey rename to vehicle_sizes_pkey;
alter index vehicle_size_classes_tenant_id_idx rename to vehicle_sizes_tenant_id_idx;
alter table public.vehicle_sizes rename constraint vehicle_size_classes_tenant_id_name_key to vehicle_sizes_tenant_id_name_key;

alter table public.service_prices rename column vehicle_size_class_id to vehicle_size_id;

-- Existing catalog write policies (from migration 0002) predate the RBAC system and check
-- current_role() directly. Since this migration already touches these tables, switch their write
-- policies to has_permission('can_manage_catalog') -- the pattern everything from here on should
-- use -- while leaving untouched tables (Phase 0-2 ticket/job tables) on current_role() until
-- Phase 2 replaces them.
drop policy vehicle_size_classes_insert on public.vehicle_sizes;
drop policy vehicle_size_classes_update on public.vehicle_sizes;
create policy vehicle_sizes_insert on public.vehicle_sizes
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'));
create policy vehicle_sizes_update on public.vehicle_sizes
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'));

drop policy service_prices_insert on public.service_prices;
drop policy service_prices_update on public.service_prices;
create policy service_prices_insert on public.service_prices
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'));
create policy service_prices_update on public.service_prices
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'));

create table public.vehicle_makes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index vehicle_makes_tenant_id_idx on public.vehicle_makes(tenant_id);

-- Convenience lookup only (spec: "This is only a convenience lookup"). Cashiers can always
-- override the size at transaction time (Phase 2) -- default_vehicle_size_id just pre-fills it.
create table public.vehicle_models (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  make_id uuid not null references public.vehicle_makes(id) on delete cascade,
  model_name text not null,
  vehicle_type text,
  default_vehicle_size_id uuid references public.vehicle_sizes(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, make_id, model_name)
);
create index vehicle_models_tenant_id_idx on public.vehicle_models(tenant_id);

alter table public.vehicle_makes enable row level security;
create policy vehicle_makes_select on public.vehicle_makes
  for select using (tenant_id = public.current_tenant_id());
create policy vehicle_makes_insert on public.vehicle_makes
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'));
create policy vehicle_makes_update on public.vehicle_makes
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'));

alter table public.vehicle_models enable row level security;
create policy vehicle_models_select on public.vehicle_models
  for select using (tenant_id = public.current_tenant_id());
create policy vehicle_models_insert on public.vehicle_models
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'));
create policy vehicle_models_update on public.vehicle_models
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'));

-- New tenants now get the spec's 6-tier ladder instead of the old Sedan/SUV/Van-Pickup default.
create or replace function public.seed_new_tenant_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_manager_id uuid;
  v_supervisor_id uuid;
  v_cashier_id uuid;
begin
  insert into public.locations (tenant_id, name)
  values (new.id, 'Main Location');

  insert into public.vehicle_sizes (tenant_id, name, sort_order)
  values
    (new.id, 'Motorcycle', 1),
    (new.id, 'Small', 2),
    (new.id, 'Medium', 3),
    (new.id, 'Large', 4),
    (new.id, 'XL', 5),
    (new.id, 'XXL', 6);

  insert into public.tenant_ticket_counters (tenant_id, next_number)
  values (new.id, 1);

  insert into public.roles (tenant_id, key, name, is_system) values
    (new.id, 'admin', 'Admin / Owner', true),
    (new.id, 'manager', 'Manager', true),
    (new.id, 'supervisor', 'Supervisor', true),
    (new.id, 'cashier', 'Cashier', true),
    (new.id, 'attendant', 'Car Wash Attendant', true),
    (new.id, 'detailer', 'Detailer', true);

  select id into v_admin_id from public.roles where tenant_id = new.id and key = 'admin';
  select id into v_manager_id from public.roles where tenant_id = new.id and key = 'manager';
  select id into v_supervisor_id from public.roles where tenant_id = new.id and key = 'supervisor';
  select id into v_cashier_id from public.roles where tenant_id = new.id and key = 'cashier';

  insert into public.role_permissions (role_id, permission_key)
  select v_admin_id, key from public.permissions;

  insert into public.role_permissions (role_id, permission_key) values
    (v_manager_id, 'can_manage_employees'),
    (v_manager_id, 'can_manage_catalog'),
    (v_manager_id, 'can_view_profit'),
    (v_manager_id, 'can_manage_inventory'),
    (v_manager_id, 'can_approve_commission'),
    (v_manager_id, 'can_view_all_commissions'),
    (v_manager_id, 'can_manage_jobs'),
    (v_manager_id, 'can_refund'),
    (v_manager_id, 'can_approve_discount'),
    (v_manager_id, 'can_review_shifts'),
    (v_manager_id, 'can_manage_expenses'),
    (v_manager_id, 'can_manage_promotions'),
    (v_manager_id, 'can_view_reports'),
    (v_supervisor_id, 'can_manage_jobs'),
    (v_cashier_id, 'can_manage_jobs'),
    (v_cashier_id, 'can_manage_shift');

  return new;
end;
$$;
