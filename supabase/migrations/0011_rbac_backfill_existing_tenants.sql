-- seed_new_tenant_defaults() only fires on tenant INSERT, so it never ran for tenants created
-- before migration 0009 (i.e. WashWash). Backfill default roles + permission grants for any
-- tenant that doesn't have them yet -- generic and safe to re-run, not tied to one tenant id.
do $$
declare
  t record;
  v_admin_id uuid;
  v_manager_id uuid;
  v_supervisor_id uuid;
  v_cashier_id uuid;
begin
  for t in select id from public.tenants loop
    if exists (select 1 from public.roles where tenant_id = t.id) then
      continue;
    end if;

    insert into public.roles (tenant_id, key, name, is_system) values
      (t.id, 'admin', 'Admin / Owner', true),
      (t.id, 'manager', 'Manager', true),
      (t.id, 'supervisor', 'Supervisor', true),
      (t.id, 'cashier', 'Cashier', true),
      (t.id, 'attendant', 'Car Wash Attendant', true),
      (t.id, 'detailer', 'Detailer', true);

    select id into v_admin_id from public.roles where tenant_id = t.id and key = 'admin';
    select id into v_manager_id from public.roles where tenant_id = t.id and key = 'manager';
    select id into v_supervisor_id from public.roles where tenant_id = t.id and key = 'supervisor';
    select id into v_cashier_id from public.roles where tenant_id = t.id and key = 'cashier';

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
  end loop;
end;
$$;

-- Also backfill an employees row (linked to their existing user_profiles login) for anyone who
-- already has a login but no employee record yet -- so has_permission() resolves for them.
insert into public.employees (tenant_id, user_id, full_name, employment_status, active)
select up.tenant_id, up.id, up.full_name, 'active', true
from public.user_profiles up
where not exists (select 1 from public.employees e where e.user_id = up.id);

-- And assign each backfilled employee the role matching their existing user_profiles.role, so
-- has_permission() reflects the same access they already had under the old current_role() check.
insert into public.employee_roles (employee_id, role_id)
select e.id, r.id
from public.employees e
join public.user_profiles up on up.id = e.user_id
join public.roles r on r.tenant_id = e.tenant_id and r.key = up.role
where not exists (select 1 from public.employee_roles er where er.employee_id = e.id and er.role_id = r.id);
