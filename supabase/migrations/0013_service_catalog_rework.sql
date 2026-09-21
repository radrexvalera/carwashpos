-- service_categories replaces the free-text services.category column with a proper lookup, and
-- services gains pricing_type/flat_price to support flat, starting-at, and manually-quoted
-- services alongside the existing per-vehicle-size price matrix (spec section 6).

create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index service_categories_tenant_id_idx on public.service_categories(tenant_id);

alter table public.services add column category_id uuid references public.service_categories(id);
alter table public.services add column pricing_type text not null default 'matrix'
  check (pricing_type in ('matrix', 'flat', 'starting_at', 'quoted'));
alter table public.services add column flat_price numeric(12, 2) check (flat_price is null or flat_price >= 0);

-- Backfill: create a category per distinct existing free-text category value (per tenant) and
-- point each service at it. The old services.category column is kept (nullable now has no effect,
-- it was already nullable) as a harmless historical value -- dropping it is a follow-up once the
-- admin UI no longer needs a fallback, not required for this migration to be safe.
insert into public.service_categories (tenant_id, name, sort_order)
select distinct tenant_id, category, 0
from public.services
where category is not null
on conflict (tenant_id, name) do nothing;

update public.services s
set category_id = sc.id
from public.service_categories sc
where sc.tenant_id = s.tenant_id and sc.name = s.category and s.category_id is null;

alter table public.service_categories enable row level security;
create policy service_categories_select on public.service_categories
  for select using (tenant_id = public.current_tenant_id());
create policy service_categories_insert on public.service_categories
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'));
create policy service_categories_update on public.service_categories
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'));

-- Same has_permission() switch as migration 0012, applied to services now that this migration
-- already touches it.
drop policy services_insert on public.services;
drop policy services_update on public.services;
create policy services_insert on public.services
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'));
create policy services_update on public.services
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'));
