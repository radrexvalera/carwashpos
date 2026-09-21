-- Capability-based RBAC (additive infrastructure for Phase 2+). Deliberately does NOT touch
-- user_profiles.role / current_role() -- those still drive all existing Phase 0-2 RLS policies.
-- This is the mechanism future features (jobs, commissions, inventory, refunds, etc.) will check
-- via has_permission() instead of hardcoded role-name comparisons, and it's what lets an employee
-- hold more than one role (spec: "An employee can have more than one role if necessary").

-- Global catalog of capability keys -- not tenant-scoped, since the set of things the app CAN gate
-- is defined by the codebase, not user content. New permissions get added here as later phases
-- introduce features that need gating.
create table public.permissions (
  key text primary key,
  description text not null
);

insert into public.permissions (key, description) values
  ('can_manage_settings', 'Manage business settings'),
  ('can_manage_roles', 'Manage roles and role permissions'),
  ('can_manage_employees', 'Manage employee records and role assignments'),
  ('can_manage_catalog', 'Manage services, categories, pricing, vehicle sizes'),
  ('can_edit_price', 'Override or edit a price during a transaction'),
  ('can_view_profit', 'View profitability and cost reports'),
  ('can_manage_inventory', 'Manage inventory items, stock adjustments, and purchasing'),
  ('can_approve_commission', 'Approve and lock commission/payroll periods'),
  ('can_view_all_commissions', 'View all employees'' commission, not just their own'),
  ('can_manage_jobs', 'Create jobs, assign crew, change job status'),
  ('can_void_transaction', 'Void an unfinalized transaction'),
  ('can_refund', 'Refund a completed transaction'),
  ('can_approve_discount', 'Approve a manual discount beyond the standard cashier limit'),
  ('can_manage_shift', 'Open and close a cashier shift'),
  ('can_review_shifts', 'Review and reconcile other cashiers'' shifts'),
  ('can_manage_expenses', 'Record and manage operating expenses'),
  ('can_manage_promotions', 'Manage promotions and the loyalty program'),
  ('can_view_reports', 'View sales and management reports');

-- Tenant-scoped: every tenant gets its own copy of the default roles (seeded below) and can add
-- custom roles later.
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  name text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, key)
);
create index roles_tenant_id_idx on public.roles(tenant_id);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

create table public.employee_roles (
  employee_id uuid not null references public.employees(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  primary key (employee_id, role_id)
);

-- security definer + owned by the migration role, same pattern as current_tenant_id()/
-- current_role() -- bypasses RLS internally to resolve the caller's own permissions without a
-- recursive RLS check on employees/employee_roles/role_permissions.
create function public.has_permission(perm_key text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.employees e
    join public.employee_roles er on er.employee_id = e.id
    join public.role_permissions rp on rp.role_id = er.role_id
    where e.user_id = auth.uid() and rp.permission_key = perm_key
  );
$$;

-- Extends the Phase 0 tenant-seed trigger to also seed the six default roles + their permission
-- grants for every new tenant. Permission sets here are a starting point matching the spec's role
-- descriptions (Admin/Owner = everything; others as described in spec section 49) -- tenants can
-- adjust later once role management UI exists.
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
  v_attendant_id uuid;
  v_detailer_id uuid;
begin
  insert into public.locations (tenant_id, name)
  values (new.id, 'Main Location');

  insert into public.vehicle_size_classes (tenant_id, name, sort_order)
  values
    (new.id, 'Sedan', 1),
    (new.id, 'SUV', 2),
    (new.id, 'Van/Pickup', 3);

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
  select id into v_attendant_id from public.roles where tenant_id = new.id and key = 'attendant';
  select id into v_detailer_id from public.roles where tenant_id = new.id and key = 'detailer';

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
