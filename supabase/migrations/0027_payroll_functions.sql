-- Rolls unclaimed commission_ledger entries (payroll_period_id is null, status='earned') into a
-- new payroll period, one payroll_entries row per employee with activity in range. A ledger row
-- can only ever be claimed by one period since generate only looks at unclaimed rows and
-- immediately marks them claimed in the same transaction -- no double-counting across periods,
-- and no date-range overlap checking needed to guarantee that.
create or replace function public.generate_payroll_period(p_period_type text, p_start_date date, p_end_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_created_by uuid := auth.uid();
  v_period_id uuid := gen_random_uuid();
  v_employee record;
  v_entry_count int := 0;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_approve_commission') then
    raise exception 'Not authorized to generate payroll';
  end if;

  if p_end_date < p_start_date then
    raise exception 'end_date must be on or after start_date';
  end if;

  insert into public.payroll_periods (id, tenant_id, period_type, start_date, end_date, created_by)
  values (v_period_id, v_tenant_id, p_period_type, p_start_date, p_end_date, v_created_by);

  for v_employee in
    select employee_id, sum(commission_amount) as total
    from public.commission_ledger
    where tenant_id = v_tenant_id
      and payroll_period_id is null
      and status = 'earned'
      and created_at::date between p_start_date and p_end_date
    group by employee_id
  loop
    insert into public.payroll_entries (tenant_id, payroll_period_id, employee_id, commission_total)
    values (v_tenant_id, v_period_id, v_employee.employee_id, v_employee.total);

    update public.commission_ledger
    set payroll_period_id = v_period_id, status = 'approved'
    where tenant_id = v_tenant_id
      and employee_id = v_employee.employee_id
      and payroll_period_id is null
      and status = 'earned'
      and created_at::date between p_start_date and p_end_date;

    v_entry_count := v_entry_count + 1;
  end loop;

  return jsonb_build_object('id', v_period_id, 'status', 'draft', 'entries_created', v_entry_count);
end;
$$;

grant execute on function public.generate_payroll_period(text, date, date) to authenticated;

create or replace function public.lock_payroll_period(p_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_period record;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_approve_commission') then
    raise exception 'Not authorized to lock payroll';
  end if;

  select * into v_period from public.payroll_periods where id = p_period_id and tenant_id = v_tenant_id;
  if v_period.id is null then
    raise exception 'Payroll period not found';
  end if;

  if v_period.status != 'draft' then
    return jsonb_build_object('id', v_period.id, 'status', v_period.status);
  end if;

  update public.payroll_periods set status = 'locked', locked_at = now(), locked_by = auth.uid() where id = p_period_id;

  return jsonb_build_object('id', p_period_id, 'status', 'locked');
end;
$$;

grant execute on function public.lock_payroll_period(uuid) to authenticated;

create or replace function public.mark_payroll_period_paid(p_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_period record;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_approve_commission') then
    raise exception 'Not authorized to mark payroll as paid';
  end if;

  select * into v_period from public.payroll_periods where id = p_period_id and tenant_id = v_tenant_id;
  if v_period.id is null then
    raise exception 'Payroll period not found';
  end if;

  if v_period.status = 'draft' then
    raise exception 'Lock the period before marking it paid';
  end if;

  if v_period.status = 'paid' then
    return jsonb_build_object('id', v_period.id, 'status', 'paid');
  end if;

  update public.payroll_periods set status = 'paid', paid_at = now() where id = p_period_id;

  update public.commission_ledger
  set status = 'paid', paid_date = now()
  where tenant_id = v_tenant_id and payroll_period_id = p_period_id and status = 'approved';

  return jsonb_build_object('id', p_period_id, 'status', 'paid');
end;
$$;

grant execute on function public.mark_payroll_period_paid(uuid) to authenticated;
