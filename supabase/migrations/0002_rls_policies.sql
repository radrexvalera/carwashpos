-- Row-level security: every table is scoped to the caller's tenant; writes on catalog tables are
-- further gated to admin/manager. There are deliberately no DELETE policies on catalog tables --
-- rows are deactivated via is_active, never hard-deleted (see plan doc "Cross-Cutting Architecture").

-- security definer + owned by the migration role (postgres), so these helper functions bypass RLS
-- on user_profiles when resolving the caller's own tenant/role -- otherwise every RLS check would
-- recursively need an RLS check on user_profiles to even run.
create function public.current_tenant_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select tenant_id from public.user_profiles where id = auth.uid();
$$;

create function public.current_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.user_profiles where id = auth.uid();
$$;

-- tenants: read-only to members of that tenant. Provisioning a new tenant row happens via the
-- service role key, which bypasses RLS entirely, so no INSERT/UPDATE policy is needed here.
alter table public.tenants enable row level security;

create policy tenants_select on public.tenants
  for select using (id = public.current_tenant_id());

-- locations: read for all tenant members; writes admin-only (there's normally just the one
-- auto-seeded row in v1, but keep it editable for renaming ahead of future multi-location support).
alter table public.locations enable row level security;

create policy locations_select on public.locations
  for select using (tenant_id = public.current_tenant_id());

create policy locations_insert on public.locations
  for insert with check (tenant_id = public.current_tenant_id() and public.current_role() = 'admin');

create policy locations_update on public.locations
  for update using (tenant_id = public.current_tenant_id() and public.current_role() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_role() = 'admin');

-- user_profiles: any tenant member can read the staff list (needed for "by cashier" reporting);
-- only admins can create/edit staff accounts. The very first admin profile for a new tenant is
-- inserted via the service role during onboarding, not through this policy.
alter table public.user_profiles enable row level security;

create policy user_profiles_select on public.user_profiles
  for select using (tenant_id = public.current_tenant_id());

create policy user_profiles_insert on public.user_profiles
  for insert with check (tenant_id = public.current_tenant_id() and public.current_role() = 'admin');

create policy user_profiles_update on public.user_profiles
  for update using (tenant_id = public.current_tenant_id() and public.current_role() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_role() = 'admin');

-- Catalog tables: read for all tenant members, write for admin/manager only.
do $$
declare
  catalog_table text;
begin
  foreach catalog_table in array array[
    'vehicle_size_classes',
    'services',
    'service_prices',
    'products',
    'consumables',
    'service_bom',
    'bays'
  ]
  loop
    execute format('alter table public.%I enable row level security;', catalog_table);

    execute format(
      'create policy %I_select on public.%I for select using (tenant_id = public.current_tenant_id());',
      catalog_table, catalog_table
    );

    execute format(
      'create policy %I_insert on public.%I for insert with check (tenant_id = public.current_tenant_id() and public.current_role() in (''admin'', ''manager''));',
      catalog_table, catalog_table
    );

    execute format(
      'create policy %I_update on public.%I for update using (tenant_id = public.current_tenant_id() and public.current_role() in (''admin'', ''manager'')) with check (tenant_id = public.current_tenant_id() and public.current_role() in (''admin'', ''manager''));',
      catalog_table, catalog_table
    );
  end loop;
end;
$$;
