-- Payroll periods roll commission_ledger entries into a pay run (spec section 15). Deliberately
-- lightweight -- this is an operational commission/pay calculation, not statutory payroll (no BIR/
-- SSS/PhilHealth/Pag-IBIG computation), matching the spec's own framing.
create table public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period_type text not null check (period_type in ('daily', 'weekly', 'semi_monthly', 'custom')),
  start_date date not null,
  end_date date not null,
  status text not null default 'draft' check (status in ('draft', 'locked', 'paid')),
  locked_at timestamptz,
  locked_by uuid references public.user_profiles(id),
  paid_at timestamptz,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index payroll_periods_tenant_id_idx on public.payroll_periods(tenant_id);

alter table public.commission_ledger
  add constraint commission_ledger_payroll_period_id_fkey
  foreign key (payroll_period_id) references public.payroll_periods(id);

-- base_pay/tips/bonus/cash_advance/deductions/adjustments are manual manager input -- there's no
-- attendance or tip-recording subsystem yet to derive them from (spec sections 15-16 are only
-- partially built: commission is real, tips/attendance are not, so these stay direct entry for
-- now rather than pretending to be computed from something that doesn't exist).
create table public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payroll_period_id uuid not null references public.payroll_periods(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  base_pay numeric(12, 2) not null default 0,
  commission_total numeric(12, 2) not null default 0,
  tips numeric(12, 2) not null default 0,
  bonus numeric(12, 2) not null default 0,
  cash_advance numeric(12, 2) not null default 0,
  deductions numeric(12, 2) not null default 0,
  adjustments numeric(12, 2) not null default 0,
  net_pay numeric(12, 2) generated always as
    (base_pay + commission_total + tips + bonus + adjustments - cash_advance - deductions) stored,
  created_at timestamptz not null default now(),
  unique (payroll_period_id, employee_id)
);
create index payroll_entries_tenant_id_idx on public.payroll_entries(tenant_id);
create index payroll_entries_employee_id_idx on public.payroll_entries(employee_id);

-- A correction AFTER a period is locked is a new row here, never an edit to the frozen
-- payroll_entries row (spec's own rule: "anything after lock requires an explicit adjustment
-- record"). Not folded into payroll_entries.adjustments, which is only for pre-lock manual input.
create table public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payroll_entry_id uuid not null references public.payroll_entries(id) on delete cascade,
  amount numeric(12, 2) not null,
  reason text not null,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now()
);
create index payroll_adjustments_entry_id_idx on public.payroll_adjustments(payroll_entry_id);

alter table public.payroll_periods enable row level security;

create policy payroll_periods_select on public.payroll_periods
  for select using (tenant_id = public.current_tenant_id());
-- No insert/update policy: only generate_payroll_period()/lock_payroll_period()/
-- mark_payroll_period_paid() (security definer, next migration) write these.

alter table public.payroll_entries enable row level security;

create policy payroll_entries_select on public.payroll_entries
  for select using (
    tenant_id = public.current_tenant_id()
    and (employee_id = public.current_employee_id() or public.has_permission('can_view_all_commissions'))
  );

-- Manual fields (base_pay/tips/bonus/cash_advance/deductions/adjustments) are editable directly
-- while the period is still a draft; once locked, this policy's subquery stops matching and any
-- correction has to go through payroll_adjustments instead.
create policy payroll_entries_update on public.payroll_entries
  for update using (
    tenant_id = public.current_tenant_id()
    and public.has_permission('can_approve_commission')
    and exists (select 1 from public.payroll_periods p where p.id = payroll_entries.payroll_period_id and p.status = 'draft')
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_permission('can_approve_commission')
    and exists (select 1 from public.payroll_periods p where p.id = payroll_entries.payroll_period_id and p.status = 'draft')
  );

alter table public.payroll_adjustments enable row level security;

create policy payroll_adjustments_select on public.payroll_adjustments
  for select using (
    tenant_id = public.current_tenant_id()
    and (
      public.has_permission('can_view_all_commissions')
      or exists (
        select 1 from public.payroll_entries pe
        where pe.id = payroll_adjustments.payroll_entry_id and pe.employee_id = public.current_employee_id()
      )
    )
  );

create policy payroll_adjustments_insert on public.payroll_adjustments
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_approve_commission'));
