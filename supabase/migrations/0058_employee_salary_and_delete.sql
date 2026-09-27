-- Fixed salary rate for employees who aren't paid on commission (e.g. a cashier or utility
-- worker). Null means "no fixed rate" -- unrelated to whether they also earn commission, so a
-- hybrid base+commission employee is just someone with both a salary_rate and commission_ledger
-- activity, both of which now land on the same generated payroll entry (see the function below).
alter table public.employees add column salary_rate numeric(12, 2) check (salary_rate is null or salary_rate > 0);
alter table public.employees add column salary_rate_type text check (salary_rate_type in ('daily', 'weekly', 'semi_monthly', 'monthly'));
alter table public.employees add constraint employees_salary_rate_type_pair
  check ((salary_rate is null) = (salary_rate_type is null));

-- Previously generate_payroll_period() only ever created an entry for employees who had
-- commission_ledger activity in range, so a salaried (non-commission) employee never got a
-- payroll entry generated at all. Now also includes active employees with a salary_rate, with
-- base_pay pre-filled as a best-effort proration by days in the period -- still directly editable
-- afterwards, same as it always was for every other manual field.
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
  v_days_in_period int := p_end_date - p_start_date + 1;
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
    select
      e.id as employee_id,
      coalesce(cl.total, 0) as commission_total,
      case
        when e.active and e.salary_rate is not null then
          round(e.salary_rate * v_days_in_period / (case e.salary_rate_type
            when 'daily' then 1
            when 'weekly' then 7
            when 'semi_monthly' then 15
            else 30
          end), 2)
        else 0
      end as base_pay
    from public.employees e
    left join (
      select employee_id, sum(commission_amount) as total
      from public.commission_ledger
      where tenant_id = v_tenant_id
        and payroll_period_id is null
        and status = 'earned'
        and created_at::date between p_start_date and p_end_date
      group by employee_id
    ) cl on cl.employee_id = e.id
    where e.tenant_id = v_tenant_id
      and (cl.total is not null or (e.active and e.salary_rate is not null))
  loop
    insert into public.payroll_entries (tenant_id, payroll_period_id, employee_id, base_pay, commission_total)
    values (v_tenant_id, v_period_id, v_employee.employee_id, v_employee.base_pay, v_employee.commission_total);

    v_entry_count := v_entry_count + 1;
  end loop;

  update public.commission_ledger
  set payroll_period_id = v_period_id, status = 'approved'
  where tenant_id = v_tenant_id
    and payroll_period_id is null
    and status = 'earned'
    and created_at::date between p_start_date and p_end_date
    and employee_id in (select employee_id from public.payroll_entries where payroll_period_id = v_period_id);

  return jsonb_build_object('id', v_period_id, 'status', 'draft', 'entries_created', v_entry_count);
end;
$$;

grant execute on function public.generate_payroll_period(text, date, date) to authenticated;

-- A real hard delete, not the usual deactivate-never-delete convention -- but restricted by the
-- database's own foreign keys, not app logic: any employee with actual history (jobs, shifts,
-- commissions, payroll, cash advances) fails with a friendly redirect to deactivating instead.
-- Only lets you clean up a genuinely unused record, e.g. one added by mistake seconds ago.
create or replace function public.delete_employee(p_employee_id uuid)
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

  if not public.has_permission('can_manage_employees') then
    raise exception 'Not authorized to delete employees';
  end if;

  if not exists (select 1 from public.employees where id = p_employee_id and tenant_id = v_tenant_id) then
    raise exception 'Employee not found';
  end if;

  begin
    delete from public.employees where id = p_employee_id and tenant_id = v_tenant_id;
  exception when foreign_key_violation then
    raise exception 'This employee has activity on record (jobs, shifts, commissions, or payroll) and can''t be deleted -- deactivate them instead.';
  end;

  return jsonb_build_object('id', p_employee_id, 'deleted', true);
end;
$$;

grant execute on function public.delete_employee(uuid) to authenticated;
