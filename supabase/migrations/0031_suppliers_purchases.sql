create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  contact_person text,
  mobile text,
  email text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index suppliers_tenant_id_idx on public.suppliers(tenant_id);

-- A purchase order here doubles as the stock-in record itself (spec's "Purchase Order / Stock-In")
-- -- no separate draft/receive workflow for v1; creating one immediately posts purchase
-- transactions to the ledger via create_purchase_order().
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  reference_number text,
  order_date date not null default current_date,
  subtotal numeric(12, 2) not null default 0,
  discount_total numeric(12, 2) not null default 0,
  delivery_charge numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now()
);
create index purchase_orders_tenant_id_idx on public.purchase_orders(tenant_id);

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id),
  quantity numeric(14, 4) not null check (quantity > 0),
  unit_cost numeric(12, 4) not null check (unit_cost >= 0),
  discount_amount numeric(12, 2) not null default 0,
  line_total numeric(12, 2) not null
);
create index purchase_order_items_po_id_idx on public.purchase_order_items(purchase_order_id);

alter table public.suppliers enable row level security;
create policy suppliers_select on public.suppliers
  for select using (tenant_id = public.current_tenant_id());
create policy suppliers_insert on public.suppliers
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_inventory'));
create policy suppliers_update on public.suppliers
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_inventory'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_inventory'));

alter table public.purchase_orders enable row level security;
create policy purchase_orders_select on public.purchase_orders
  for select using (tenant_id = public.current_tenant_id());
-- No insert policy: only create_purchase_order() (next migration) writes these.

alter table public.purchase_order_items enable row level security;
create policy purchase_order_items_select on public.purchase_order_items
  for select using (tenant_id = public.current_tenant_id());
