-- Customers are only created for registered/company accounts -- a pure walk-in vehicle has no
-- customer_id at all (nullable on vehicles), matching spec section 4. Deliberately no stored
-- total_visits/total_spend/last_visit/loyalty_points columns: those are derived from jobs/sales at
-- read time (a view, added once jobs exist) rather than mutable counters that could drift from
-- the ledger they'd be summarizing -- consistent with the "never directly overwrite a running
-- total" rule applied to inventory/commission elsewhere in this schema.
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_type text not null default 'individual' check (customer_type in ('individual', 'company')),
  full_name text not null,
  mobile text,
  email text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index customers_tenant_id_idx on public.customers(tenant_id);
create index customers_tenant_mobile_idx on public.customers(tenant_id, mobile) where mobile is not null;

-- make/model are free text (not FKs into vehicle_makes/vehicle_models) -- that lookup is a
-- convenience for pre-filling a default size, not a constraint on what a vehicle record can say,
-- since the spec explicitly says "do not hard-code vehicle models."
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid references public.customers(id),
  plate_number text not null,
  make text,
  model text,
  year int,
  color text,
  vehicle_type text,
  vehicle_size_id uuid references public.vehicle_sizes(id),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, plate_number)
);
create index vehicles_tenant_id_idx on public.vehicles(tenant_id);
create index vehicles_customer_id_idx on public.vehicles(customer_id);

alter table public.customers enable row level security;
create policy customers_select on public.customers
  for select using (tenant_id = public.current_tenant_id());
create policy customers_insert on public.customers
  for insert with check (tenant_id = public.current_tenant_id());
create policy customers_update on public.customers
  for update using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

alter table public.vehicles enable row level security;
create policy vehicles_select on public.vehicles
  for select using (tenant_id = public.current_tenant_id());
create policy vehicles_insert on public.vehicles
  for insert with check (tenant_id = public.current_tenant_id());
create policy vehicles_update on public.vehicles
  for update using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
