-- Copies one tenant's Catalog & Pricing data -- vehicle sizes, service categories, services,
-- per-size prices, and wash bays -- into another tenant.
--
-- This is a one-off operational script, NOT a schema migration -- it doesn't belong in
-- supabase/migrations/ and shouldn't be tracked by `supabase db push`. Run it directly against
-- the database (Supabase Studio's SQL Editor, or `supabase db query --linked --file
-- supabase/scripts/copy_catalog_pricing.sql`) whenever you need it.
--
-- Safe to re-run: every table is matched by name within the target tenant first, so running this
-- twice updates/skips instead of creating duplicates. Vehicle sizes and locations are matched
-- against what the target tenant ALREADY has (every tenant auto-seeds its own 6 default sizes and
-- one location on signup) rather than blindly copied, so you don't end up with two "Medium"s.
--
-- EDIT these two lines before running:
--   v_source_slug: the tenant you're copying FROM (find it via `select slug from tenants`)
--   v_target_slug: the tenant you're copying TO -- must already exist (sign up first)

begin;

do $$
declare
  v_source_slug text := 'washwash';
  v_target_slug text := 'REPLACE_WITH_TARGET_SLUG';
  v_source_tenant uuid;
  v_target_tenant uuid;
  v_target_location uuid;
begin
  select id into v_source_tenant from public.tenants where slug = v_source_slug;
  select id into v_target_tenant from public.tenants where slug = v_target_slug;

  if v_source_tenant is null then
    raise exception 'Source tenant with slug % not found', v_source_slug;
  end if;
  if v_target_tenant is null then
    raise exception 'Target tenant with slug % not found -- it has to exist (sign up) before running this', v_target_slug;
  end if;
  if v_source_tenant = v_target_tenant then
    raise exception 'Source and target are the same tenant';
  end if;

  -- Every tenant gets exactly one auto-seeded location on signup; bays attach to whichever one
  -- is oldest. If the target has multiple locations and you want a different one, change this.
  select id into v_target_location from public.locations where tenant_id = v_target_tenant order by created_at limit 1;
  if v_target_location is null then
    raise exception 'Target tenant has no location to attach bays to';
  end if;

  -- 1. Vehicle sizes -- usually a no-op since both tenants start with the same 6 defaults; this
  -- only inserts anything if the source has custom sizes the target is missing.
  create temp table _vehicle_size_map (source_id uuid primary key, target_id uuid not null) on commit drop;

  insert into public.vehicle_sizes (tenant_id, name, sort_order, is_active)
  select v_target_tenant, s.name, s.sort_order, s.is_active
  from public.vehicle_sizes s
  where s.tenant_id = v_source_tenant
  on conflict (tenant_id, name) do update set sort_order = excluded.sort_order, is_active = excluded.is_active;

  insert into _vehicle_size_map (source_id, target_id)
  select s.id, t.id
  from public.vehicle_sizes s
  join public.vehicle_sizes t on t.tenant_id = v_target_tenant and t.name = s.name
  where s.tenant_id = v_source_tenant;

  -- 2. Service categories (including the is_carwash commission flag)
  create temp table _category_map (source_id uuid primary key, target_id uuid not null) on commit drop;

  insert into public.service_categories (tenant_id, name, sort_order, is_active, is_carwash)
  select v_target_tenant, c.name, c.sort_order, c.is_active, c.is_carwash
  from public.service_categories c
  where c.tenant_id = v_source_tenant
  on conflict (tenant_id, name)
  do update set sort_order = excluded.sort_order, is_active = excluded.is_active, is_carwash = excluded.is_carwash;

  insert into _category_map (source_id, target_id)
  select c.id, t.id
  from public.service_categories c
  join public.service_categories t on t.tenant_id = v_target_tenant and t.name = c.name
  where c.tenant_id = v_source_tenant;

  -- 3. Services -- no unique(tenant_id, name) constraint on this table, so matched manually
  -- (insert what's missing, then update what already matches by name).
  create temp table _service_map (source_id uuid primary key, target_id uuid not null) on commit drop;

  insert into public.services (tenant_id, name, category, category_id, default_duration_minutes, pricing_type, flat_price, is_active)
  select v_target_tenant, s.name, s.category, cm.target_id, s.default_duration_minutes, s.pricing_type, s.flat_price, s.is_active
  from public.services s
  left join _category_map cm on cm.source_id = s.category_id
  where s.tenant_id = v_source_tenant
    and not exists (select 1 from public.services existing where existing.tenant_id = v_target_tenant and existing.name = s.name);

  update public.services t
  set category = s.category, category_id = cm.target_id, default_duration_minutes = s.default_duration_minutes,
      pricing_type = s.pricing_type, flat_price = s.flat_price, is_active = s.is_active
  from public.services s
  left join _category_map cm on cm.source_id = s.category_id
  where s.tenant_id = v_source_tenant and t.tenant_id = v_target_tenant and t.name = s.name;

  insert into _service_map (source_id, target_id)
  select s.id, t.id
  from public.services s
  join public.services t on t.tenant_id = v_target_tenant and t.name = s.name
  where s.tenant_id = v_source_tenant;

  -- 4. Per-size prices
  insert into public.service_prices (tenant_id, service_id, vehicle_size_id, price, is_active)
  select v_target_tenant, sm.target_id, vm.target_id, sp.price, sp.is_active
  from public.service_prices sp
  join _service_map sm on sm.source_id = sp.service_id
  join _vehicle_size_map vm on vm.source_id = sp.vehicle_size_id
  where sp.tenant_id = v_source_tenant
  on conflict (service_id, vehicle_size_id) do update set price = excluded.price, is_active = excluded.is_active;

  -- 5. Wash bays -- also no unique(tenant_id, name) constraint, matched manually.
  insert into public.wash_bays (tenant_id, location_id, name, sort_order, is_active)
  select v_target_tenant, v_target_location, b.name, b.sort_order, b.is_active
  from public.wash_bays b
  where b.tenant_id = v_source_tenant
    and not exists (select 1 from public.wash_bays existing where existing.tenant_id = v_target_tenant and existing.name = b.name);

  update public.wash_bays t
  set sort_order = b.sort_order, is_active = b.is_active
  from public.wash_bays b
  where b.tenant_id = v_source_tenant and t.tenant_id = v_target_tenant and t.name = b.name;

  raise notice 'Done. Target now has % categories, % services, % prices, % vehicle sizes, % bays.',
    (select count(*) from public.service_categories where tenant_id = v_target_tenant),
    (select count(*) from public.services where tenant_id = v_target_tenant),
    (select count(*) from public.service_prices where tenant_id = v_target_tenant),
    (select count(*) from public.vehicle_sizes where tenant_id = v_target_tenant),
    (select count(*) from public.wash_bays where tenant_id = v_target_tenant);
end $$;

commit;
