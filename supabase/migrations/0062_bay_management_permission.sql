-- Wash bays were still gated by the pre-RBAC current_role() in ('admin','manager') check from
-- migration 0002 (policies bays_select/_insert/_update, carried over by ALTER TABLE RENAME to
-- wash_bays in 0016) instead of the capability-based has_permission() system every other feature
-- uses. Moves bay management onto a real permission (so it can be granted/revoked per role like
-- everything else) and adds delete, which never existed before.
insert into public.permissions (key, description) values
  ('can_manage_bays', 'Add, edit, and delete wash bays');

-- Backfill: give every existing tenant's admin (gets every permission, matching
-- seed_new_tenant_defaults()'s own rule) and manager (preserving what current_role() already let
-- managers do) this permission. New tenants get it automatically -- admin via the "all
-- permissions" insert below, manager via the explicit list.
insert into public.role_permissions (role_id, permission_key)
select r.id, 'can_manage_bays' from public.roles r where r.key in ('admin', 'manager')
on conflict do nothing;

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

  insert into public.settings (tenant_id, business_name)
  values (new.id, new.name);

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
    (v_manager_id, 'can_manage_fleet_accounts'),
    (v_manager_id, 'can_manage_bays'),
    (v_supervisor_id, 'can_manage_jobs'),
    (v_cashier_id, 'can_manage_jobs'),
    (v_cashier_id, 'can_manage_shift');

  return new;
end;
$$;

drop policy bays_select on public.wash_bays;
drop policy bays_insert on public.wash_bays;
drop policy bays_update on public.wash_bays;

create policy wash_bays_select on public.wash_bays
  for select using (tenant_id = public.current_tenant_id());

create policy wash_bays_insert on public.wash_bays
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_bays'));

create policy wash_bays_update on public.wash_bays
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_bays'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_bays'));

create policy wash_bays_delete on public.wash_bays
  for delete using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_bays'));

-- A real delete, guarded by the database's own foreign key: jobs.bay_id references wash_bays with
-- no cascade, so a bay currently holding a job fails with a friendly redirect instead of a raw FK
-- error. Historical jobs don't block this -- bay_id is already cleared to null on release/
-- completion (see the Job Queue's "Ready for Release" behavior), so only a bay in active use blocks.
create or replace function public.delete_bay(p_bay_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_bays') then
    raise exception 'Not authorized to delete bays';
  end if;

  if not exists (select 1 from public.wash_bays where id = p_bay_id and tenant_id = v_tenant_id) then
    raise exception 'Bay not found';
  end if;

  begin
    delete from public.wash_bays where id = p_bay_id and tenant_id = v_tenant_id;
  exception when foreign_key_violation then
    raise exception 'This bay has a job in it and can''t be deleted -- move or complete that job first.';
  end;

  return jsonb_build_object('id', p_bay_id, 'deleted', true);
end;
$$;

grant execute on function public.delete_bay(uuid) to authenticated;
