-- One configurable settings row per tenant -- business info, currency/timezone defaults, and
-- receipt/numbering config. Avoids hard-coding business rules per spec's development rules.
create table public.settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  business_name text not null default '',
  address text,
  contact_phone text,
  contact_email text,
  currency text not null default 'PHP',
  timezone text not null default 'Asia/Manila',
  receipt_header text,
  receipt_footer text,
  numbering_prefix text not null default 'CW',
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;

create policy settings_select on public.settings
  for select using (tenant_id = public.current_tenant_id());

create policy settings_insert on public.settings
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_settings'));

create policy settings_update on public.settings
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_settings'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_settings'));

-- Backfill a default row for every existing tenant.
insert into public.settings (tenant_id, business_name)
select id, name from public.tenants
on conflict (tenant_id) do nothing;

-- New tenants get a settings row automatically from here on.
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
    (v_supervisor_id, 'can_manage_jobs'),
    (v_cashier_id, 'can_manage_jobs'),
    (v_cashier_id, 'can_manage_shift');

  return new;
end;
$$;
