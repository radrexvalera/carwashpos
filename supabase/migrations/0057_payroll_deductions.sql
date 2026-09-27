-- Itemized deductions (e.g. backjob penalties, uniform costs, damage charges) applied to a single
-- payroll entry, each with its own reason. payroll_entries.deductions (0026) stays the generated
-- column net_pay depends on, but its value is now the sum of this entry's itemized rows here, not
-- a raw manager-typed number -- the same ledger-backed pattern used for cash_advance (0056).
create table public.payroll_deductions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payroll_entry_id uuid not null references public.payroll_entries(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  reason text not null,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now()
);
create index payroll_deductions_tenant_id_idx on public.payroll_deductions(tenant_id);
create index payroll_deductions_entry_id_idx on public.payroll_deductions(payroll_entry_id);

alter table public.payroll_deductions enable row level security;

create policy payroll_deductions_select on public.payroll_deductions
  for select using (
    tenant_id = public.current_tenant_id()
    and (
      public.has_permission('can_view_all_commissions')
      or exists (
        select 1 from public.payroll_entries pe
        where pe.id = payroll_deductions.payroll_entry_id and pe.employee_id = public.current_employee_id()
      )
    )
  );
-- No insert/update/delete policy: only add_payroll_deduction()/remove_payroll_deduction()
-- (security definer, below) write these.

create or replace function public.add_payroll_deduction(p_payroll_entry_id uuid, p_amount numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_period_status text;
  v_id uuid := gen_random_uuid();
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_approve_commission') then
    raise exception 'Not authorized to record payroll deductions';
  end if;

  if p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Reason is required';
  end if;

  select pp.status into v_period_status
  from public.payroll_entries pe
  join public.payroll_periods pp on pp.id = pe.payroll_period_id
  where pe.id = p_payroll_entry_id and pe.tenant_id = v_tenant_id;

  if v_period_status is null then
    raise exception 'Payroll entry not found';
  end if;

  if v_period_status != 'draft' then
    raise exception 'Payroll period is no longer editable';
  end if;

  insert into public.payroll_deductions (id, tenant_id, payroll_entry_id, amount, reason, created_by)
  values (v_id, v_tenant_id, p_payroll_entry_id, p_amount, trim(p_reason), auth.uid());

  update public.payroll_entries set deductions = deductions + p_amount where id = p_payroll_entry_id;

  return jsonb_build_object('id', v_id);
end;
$$;

grant execute on function public.add_payroll_deduction(uuid, numeric, text) to authenticated;

create or replace function public.remove_payroll_deduction(p_deduction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_deduction record;
  v_period_status text;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_approve_commission') then
    raise exception 'Not authorized to remove payroll deductions';
  end if;

  select * into v_deduction from public.payroll_deductions where id = p_deduction_id and tenant_id = v_tenant_id;
  if v_deduction.id is null then
    raise exception 'Deduction not found';
  end if;

  select pp.status into v_period_status
  from public.payroll_entries pe
  join public.payroll_periods pp on pp.id = pe.payroll_period_id
  where pe.id = v_deduction.payroll_entry_id;

  if v_period_status != 'draft' then
    raise exception 'Payroll period is no longer editable';
  end if;

  update public.payroll_entries set deductions = deductions - v_deduction.amount where id = v_deduction.payroll_entry_id;

  delete from public.payroll_deductions where id = p_deduction_id;

  return jsonb_build_object('id', p_deduction_id, 'removed', true);
end;
$$;

grant execute on function public.remove_payroll_deduction(uuid) to authenticated;
