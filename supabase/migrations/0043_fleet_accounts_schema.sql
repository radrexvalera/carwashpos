-- Fleet accounts: a company-type customer with deferred/on-account billing. Deliberately NOT a
-- separate fleet<->vehicle join table -- vehicles.customer_id already supports many vehicles per
-- customer for free, so every vehicle under a fleet account's customer_id IS a fleet vehicle.
create table public.fleet_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null unique references public.customers(id),
  credit_limit numeric(12, 2) check (credit_limit is null or credit_limit >= 0),
  payment_terms_days int not null default 30,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index fleet_accounts_tenant_id_idx on public.fleet_accounts(tenant_id);

-- Only accounts with something owed show up here (same "no row = zero" convention as
-- loyalty_balances) -- outstanding = each on_account sale's total minus what's been paid on it.
create view public.fleet_account_balances
with (security_invoker = true) as
select
  fa.id as fleet_account_id,
  fa.tenant_id,
  fa.customer_id,
  sum(s.total - coalesce(p.paid_amount, 0)) as outstanding_balance
from public.fleet_accounts fa
join public.sales s on s.customer_id = fa.customer_id and s.tenant_id = fa.tenant_id
  and s.billing_type = 'on_account' and s.status != 'voided'
left join (
  select sale_id, sum(amount) as paid_amount from public.payments group by sale_id
) p on p.sale_id = s.id
where coalesce(p.paid_amount, 0) < s.total
group by fa.id, fa.tenant_id, fa.customer_id;
grant select on public.fleet_account_balances to authenticated;

alter table public.fleet_accounts enable row level security;
create policy fleet_accounts_select on public.fleet_accounts
  for select using (tenant_id = public.current_tenant_id());
create policy fleet_accounts_insert on public.fleet_accounts
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_fleet_accounts'));
create policy fleet_accounts_update on public.fleet_accounts
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_fleet_accounts'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_fleet_accounts'));

-- New permission: setting up accounts/credit limits and settling invoices is an office/
-- management task, distinct from can_manage_shift (which any cashier has).
insert into public.permissions (key, description) values
  ('can_manage_fleet_accounts', 'Manage fleet accounts, credit limits, and invoice settlement');

-- Backfill onto the existing tenant's admin+manager roles -- the tenant-creation trigger's
-- wildcard admin grant only covers tenants created from here on, not ones that already exist.
insert into public.role_permissions (role_id, permission_key)
select r.id, 'can_manage_fleet_accounts'
from public.roles r
where r.key in ('admin', 'manager')
on conflict do nothing;

-- Keep future tenants correct too.
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
    (v_supervisor_id, 'can_manage_jobs'),
    (v_cashier_id, 'can_manage_jobs'),
    (v_cashier_id, 'can_manage_shift');

  return new;
end;
$$;
