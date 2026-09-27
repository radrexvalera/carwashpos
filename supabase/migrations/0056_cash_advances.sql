-- Cash advances given to employees mid-week, repaid in partial installments across one or more
-- weekly payroll periods (e.g. a 1000 advance on Wednesday, only 500 deducted from that week's
-- pay, the remaining 500 carried forward and deducted from a later period). payroll_entries.
-- cash_advance (0026) stays the generated column net_pay depends on, but its value is now the sum
-- of this employee's repayments recorded against that entry, not a raw manager-typed number.
create table public.cash_advances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  amount numeric(12, 2) not null check (amount > 0),
  advance_date date not null default current_date,
  reason text,
  remaining_balance numeric(12, 2) not null,
  status text not null default 'outstanding' check (status in ('outstanding', 'paid')),
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  check (remaining_balance >= 0 and remaining_balance <= amount)
);
create index cash_advances_tenant_id_idx on public.cash_advances(tenant_id);
create index cash_advances_employee_id_idx on public.cash_advances(employee_id);

-- One row per deduction applied to a specific payroll entry -- this is what lets the same advance
-- be paid off across several weeks instead of forcing one lump-sum deduction.
create table public.cash_advance_repayments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cash_advance_id uuid not null references public.cash_advances(id) on delete cascade,
  payroll_entry_id uuid not null references public.payroll_entries(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now()
);
create index cash_advance_repayments_tenant_id_idx on public.cash_advance_repayments(tenant_id);
create index cash_advance_repayments_advance_id_idx on public.cash_advance_repayments(cash_advance_id);
create index cash_advance_repayments_entry_id_idx on public.cash_advance_repayments(payroll_entry_id);

alter table public.cash_advances enable row level security;

create policy cash_advances_select on public.cash_advances
  for select using (
    tenant_id = public.current_tenant_id()
    and (employee_id = public.current_employee_id() or public.has_permission('can_view_all_commissions'))
  );
-- No insert/update policy: only create_cash_advance()/record_cash_advance_repayment()/
-- void_cash_advance_repayment() (security definer, below) write these.

alter table public.cash_advance_repayments enable row level security;

create policy cash_advance_repayments_select on public.cash_advance_repayments
  for select using (
    tenant_id = public.current_tenant_id()
    and (
      public.has_permission('can_view_all_commissions')
      or exists (
        select 1 from public.cash_advances ca
        where ca.id = cash_advance_repayments.cash_advance_id and ca.employee_id = public.current_employee_id()
      )
    )
  );

create or replace function public.create_cash_advance(p_employee_id uuid, p_amount numeric, p_advance_date date, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_id uuid := gen_random_uuid();
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_approve_commission') then
    raise exception 'Not authorized to record cash advances';
  end if;

  if p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  if not exists (select 1 from public.employees where id = p_employee_id and tenant_id = v_tenant_id) then
    raise exception 'Employee not found';
  end if;

  insert into public.cash_advances (id, tenant_id, employee_id, amount, advance_date, reason, remaining_balance, created_by)
  values (v_id, v_tenant_id, p_employee_id, p_amount, coalesce(p_advance_date, current_date), p_reason, p_amount, auth.uid());

  return jsonb_build_object('id', v_id);
end;
$$;

grant execute on function public.create_cash_advance(uuid, numeric, date, text) to authenticated;

-- Applies a (possibly partial) repayment of one cash advance against one payroll entry. Only
-- allowed while the entry's period is still 'draft', matching the existing rule that manual
-- payroll_entries fields (cash_advance included) can only be changed pre-lock (0026's
-- payroll_entries_update policy) -- anything after lock is a payroll_adjustments correction instead.
create or replace function public.record_cash_advance_repayment(p_cash_advance_id uuid, p_payroll_entry_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_advance record;
  v_entry record;
  v_repayment_id uuid := gen_random_uuid();
  v_new_balance numeric(12, 2);
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_approve_commission') then
    raise exception 'Not authorized to record cash advance repayments';
  end if;

  if p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  select * into v_advance from public.cash_advances where id = p_cash_advance_id and tenant_id = v_tenant_id for update;
  if v_advance.id is null then
    raise exception 'Cash advance not found';
  end if;

  select pe.*, pp.status as period_status into v_entry
  from public.payroll_entries pe
  join public.payroll_periods pp on pp.id = pe.payroll_period_id
  where pe.id = p_payroll_entry_id and pe.tenant_id = v_tenant_id;
  if v_entry.id is null then
    raise exception 'Payroll entry not found';
  end if;

  if v_entry.employee_id != v_advance.employee_id then
    raise exception 'This cash advance belongs to a different employee';
  end if;

  if v_entry.period_status != 'draft' then
    raise exception 'Payroll period is no longer editable';
  end if;

  if p_amount > v_advance.remaining_balance then
    raise exception 'Amount exceeds the remaining balance of %', v_advance.remaining_balance;
  end if;

  v_new_balance := v_advance.remaining_balance - p_amount;

  insert into public.cash_advance_repayments (id, tenant_id, cash_advance_id, payroll_entry_id, amount, created_by)
  values (v_repayment_id, v_tenant_id, p_cash_advance_id, p_payroll_entry_id, p_amount, auth.uid());

  update public.cash_advances
  set remaining_balance = v_new_balance, status = case when v_new_balance <= 0 then 'paid' else 'outstanding' end
  where id = p_cash_advance_id;

  update public.payroll_entries set cash_advance = cash_advance + p_amount where id = p_payroll_entry_id;

  return jsonb_build_object('id', v_repayment_id, 'remaining_balance', v_new_balance);
end;
$$;

grant execute on function public.record_cash_advance_repayment(uuid, uuid, numeric) to authenticated;

-- Undo a mistaken repayment while the period is still draft: reverses both the advance's
-- remaining balance and the payroll entry's cash_advance total, then removes the ledger row.
create or replace function public.void_cash_advance_repayment(p_repayment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_repayment record;
  v_period_status text;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_approve_commission') then
    raise exception 'Not authorized to void cash advance repayments';
  end if;

  select * into v_repayment from public.cash_advance_repayments where id = p_repayment_id and tenant_id = v_tenant_id;
  if v_repayment.id is null then
    raise exception 'Repayment not found';
  end if;

  select pp.status into v_period_status
  from public.payroll_entries pe
  join public.payroll_periods pp on pp.id = pe.payroll_period_id
  where pe.id = v_repayment.payroll_entry_id;

  if v_period_status != 'draft' then
    raise exception 'Payroll period is no longer editable';
  end if;

  update public.cash_advances
  set remaining_balance = remaining_balance + v_repayment.amount, status = 'outstanding'
  where id = v_repayment.cash_advance_id;

  update public.payroll_entries set cash_advance = cash_advance - v_repayment.amount where id = v_repayment.payroll_entry_id;

  delete from public.cash_advance_repayments where id = p_repayment_id;

  return jsonb_build_object('id', p_repayment_id, 'voided', true);
end;
$$;

grant execute on function public.void_cash_advance_repayment(uuid) to authenticated;
