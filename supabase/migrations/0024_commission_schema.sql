-- Commission rules + ledger (spec sections 11-14). One rule per service, or a tenant-wide default
-- (service_id null) used when a service has no specific rule. custom_split and role_based (spec
-- methods D/E) are both expressed the same way here: per-attendant job_service_attendants.
-- split_percentage overrides an even split -- role_in_job is then just a label for what the
-- percentage represents, not a separate rate table, which keeps this from needing its own
-- role-rate config schema for v1.
create table public.service_commission_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid references public.services(id),
  commission_type text not null check (commission_type in ('fixed_pool', 'percentage', 'fixed_per_attendant', 'points')),
  rate numeric(10, 2) not null check (rate >= 0),
  -- Only consulted when commission_type = 'percentage': what the percentage applies to. A
  -- discount applied later at the SALE (checkout) never retroactively changes commission --
  -- basis is resolved once, at job-service completion time, from job_services' own price/discount.
  basis text not null default 'discounted_price' check (basis in ('original_price', 'discounted_price')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index service_commission_rules_tenant_id_idx on public.service_commission_rules(tenant_id);
create unique index service_commission_rules_one_per_service on public.service_commission_rules(tenant_id, service_id) where service_id is not null;
create unique index service_commission_rules_one_default on public.service_commission_rules(tenant_id) where service_id is null;

-- A proper ledger, never a mutable running total (spec's own rule, dev rule #10/#11): every
-- commission fact is an insert. A reversal is a NEW row with a negative amount referencing what it
-- reverses via reverses_ledger_id, not an edit to the original row.
create table public.commission_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  job_id uuid not null references public.jobs(id),
  job_service_id uuid not null references public.job_services(id),
  service_id uuid not null references public.services(id),
  gross_service_amount numeric(12, 2) not null,
  commission_type text not null,
  commission_rate numeric(10, 2) not null,
  commission_amount numeric(12, 2) not null default 0,
  points numeric(10, 2),
  status text not null default 'earned' check (status in ('pending', 'earned', 'approved', 'paid', 'reversed', 'adjusted')),
  payroll_period_id uuid,
  paid_date timestamptz,
  adjustment_reason text,
  reverses_ledger_id uuid references public.commission_ledger(id),
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now()
);
create index commission_ledger_tenant_id_idx on public.commission_ledger(tenant_id);
create index commission_ledger_employee_id_idx on public.commission_ledger(employee_id);
create index commission_ledger_job_service_id_idx on public.commission_ledger(job_service_id);

alter table public.service_commission_rules enable row level security;

create policy service_commission_rules_select on public.service_commission_rules
  for select using (tenant_id = public.current_tenant_id());

create policy service_commission_rules_insert on public.service_commission_rules
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'));

create policy service_commission_rules_update on public.service_commission_rules
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'));

alter table public.commission_ledger enable row level security;

-- Attendants see their own earnings; can_view_all_commissions (admin/manager by default) sees
-- everyone's, matching spec: "Attendants should not be able to query everyone else's commissions
-- unless authorized."
create policy commission_ledger_select on public.commission_ledger
  for select using (
    tenant_id = public.current_tenant_id()
    and (employee_id = public.current_employee_id() or public.has_permission('can_view_all_commissions'))
  );

-- No insert/update/delete policies: only complete_job() (security definer, next migration) writes
-- "earned" rows; future approve/lock/reverse RPCs will be the only path for status changes.
