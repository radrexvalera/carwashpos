-- Phase 0: tenants, auth/role join, catalog tables (services, pricing, products, consumables, BOM, bays)
-- Tenant provisioning (the `tenants` row plus the first admin `user_profiles` row) is done by the
-- operator via the Supabase service role (SQL editor or a trusted script) -- there is no public
-- self-serve signup flow. Once a tenant has its first admin, that admin can invite/create the rest
-- of the staff through the app.

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null default 'Main Location',
  created_at timestamptz not null default now()
);
create index locations_tenant_id_idx on public.locations(tenant_id);

-- Joins Supabase Auth users to a tenant + role. One row per staff member.
create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role text not null check (role in ('admin', 'manager', 'cashier')),
  full_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index user_profiles_tenant_id_idx on public.user_profiles(tenant_id);

create table public.vehicle_size_classes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index vehicle_size_classes_tenant_id_idx on public.vehicle_size_classes(tenant_id);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  category text,
  default_duration_minutes int,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index services_tenant_id_idx on public.services(tenant_id);

-- Explicit price matrix: one independently-set price per (service, vehicle size class).
-- Deliberately NOT a base-price * multiplier scheme -- real-world pricing isn't proportional
-- across every service (see plan doc "Confirmed Design Decisions" #2).
create table public.service_prices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  vehicle_size_class_id uuid not null references public.vehicle_size_classes(id) on delete cascade,
  price numeric(10, 2) not null check (price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (service_id, vehicle_size_class_id)
);
create index service_prices_tenant_id_idx on public.service_prices(tenant_id);

-- Retail products: sold to customers, stock deducted at sale.
create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sku text,
  name text not null,
  price numeric(10, 2) not null check (price >= 0),
  cost numeric(10, 2) check (cost >= 0),
  stock_qty numeric(10, 2) not null default 0,
  reorder_threshold numeric(10, 2),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index products_tenant_id_idx on public.products(tenant_id);
create unique index products_tenant_sku_key on public.products(tenant_id, sku) where sku is not null;

-- Internal supplies: consumed delivering a service, never sold directly.
-- stock_qty_book is the "theoretical" running balance -- decremented automatically via each
-- service's BOM on ticket completion (Phase 1), trued up periodically via consumable_stock_counts
-- (Phase 3). See plan doc "Confirmed Design Decisions" #1.
create table public.consumables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  unit text not null,
  unit_cost numeric(10, 2) not null default 0 check (unit_cost >= 0),
  stock_qty_book numeric(10, 3) not null default 0,
  reorder_threshold numeric(10, 3),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index consumables_tenant_id_idx on public.consumables(tenant_id);

-- Bill of materials: how much of a consumable a given service uses up.
create table public.service_bom (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  consumable_id uuid not null references public.consumables(id) on delete cascade,
  quantity_used numeric(10, 3) not null check (quantity_used > 0),
  created_at timestamptz not null default now(),
  unique (service_id, consumable_id)
);
create index service_bom_tenant_id_idx on public.service_bom(tenant_id);

create table public.bays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index bays_tenant_id_idx on public.bays(tenant_id);

-- Seed a default location + the three default vehicle size classes whenever a new tenant is
-- created, so an operator provisioning a tenant doesn't have to hand-insert this boilerplate.
create function public.seed_new_tenant_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.locations (tenant_id, name)
  values (new.id, 'Main Location');

  insert into public.vehicle_size_classes (tenant_id, name, sort_order)
  values
    (new.id, 'Sedan', 1),
    (new.id, 'SUV', 2),
    (new.id, 'Van/Pickup', 3);

  return new;
end;
$$;

create trigger tenants_seed_defaults
  after insert on public.tenants
  for each row execute function public.seed_new_tenant_defaults();
