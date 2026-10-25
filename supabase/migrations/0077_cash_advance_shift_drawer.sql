-- Cash advances are handed out in cash, straight out of whichever drawer the manager is working --
-- the same gap expenses had before 0074: nothing tracked which shift's cash actually paid for one,
-- so get_shift_summary()'s expected_cash never accounted for it. Same treatment as that migration's
-- expenses.shift_id: link to whichever shift is open for the person recording it (current_employee_id(),
-- not the recipient employee_id -- the recipient may not even be cashiering), then subtract it from
-- expected cash. Unlike expenses there's no payment_method to gate on -- a cash advance has no other
-- form, it's always cash.
alter table public.cash_advances add column shift_id uuid references public.cashier_shifts(id);
create index cash_advances_shift_id_idx on public.cash_advances(shift_id);

create or replace function public.create_cash_advance(p_employee_id uuid, p_amount numeric, p_advance_date date, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_id uuid := gen_random_uuid();
  v_shift_id uuid;
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

  select id into v_shift_id from public.cashier_shifts
  where tenant_id = v_tenant_id and cashier_id = public.current_employee_id() and status = 'open';

  insert into public.cash_advances (id, tenant_id, employee_id, amount, advance_date, reason, remaining_balance, shift_id, created_by)
  values (v_id, v_tenant_id, p_employee_id, p_amount, coalesce(p_advance_date, current_date), p_reason, p_amount, v_shift_id, auth.uid());

  return jsonb_build_object('id', v_id);
end;
$$;

grant execute on function public.create_cash_advance(uuid, numeric, date, text) to authenticated;

create or replace function public.get_shift_summary(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_shift record;
  v_cash_sales numeric(12, 2);
  v_cash_in numeric(12, 2);
  v_cash_out numeric(12, 2);
  v_cash_expenses numeric(12, 2);
  v_cash_advances numeric(12, 2);
  v_by_method jsonb;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  select * into v_shift from public.cashier_shifts where id = p_shift_id and tenant_id = v_tenant_id;
  if v_shift.id is null then
    raise exception 'Shift not found';
  end if;

  if v_shift.cashier_id != public.current_employee_id() and not public.has_permission('can_review_shifts') then
    raise exception 'Not authorized to view this shift';
  end if;

  select coalesce(sum(p.amount) filter (where p.method = 'cash'), 0) into v_cash_sales
  from public.payments p
  join public.sales s on s.id = p.sale_id
  where s.shift_id = p_shift_id and s.status != 'voided';

  select coalesce(sum(amount) filter (where type = 'cash_in'), 0), coalesce(sum(amount) filter (where type = 'cash_out'), 0)
  into v_cash_in, v_cash_out
  from public.cash_movements where shift_id = p_shift_id;

  select coalesce(sum(amount), 0) into v_cash_expenses
  from public.expenses where shift_id = p_shift_id and payment_method = 'cash' and is_voided = false;

  select coalesce(sum(amount), 0) into v_cash_advances
  from public.cash_advances where shift_id = p_shift_id;

  -- Every payment method this shift actually took, cash included, so the UI can show "this is the
  -- total across all payment types, only the cash row is what's in the drawer" instead of leaving
  -- the cashier to guess why the drawer doesn't match total sales.
  select coalesce(jsonb_object_agg(method, total), '{}'::jsonb) into v_by_method
  from (
    select p.method, sum(p.amount) as total
    from public.payments p
    join public.sales s on s.id = p.sale_id
    where s.shift_id = p_shift_id and s.status != 'voided'
    group by p.method
  ) x;

  return jsonb_build_object(
    'opening_float', v_shift.opening_float,
    'cash_sales', v_cash_sales,
    'cash_in', v_cash_in,
    'cash_out', v_cash_out,
    'cash_expenses', v_cash_expenses,
    'cash_advances', v_cash_advances,
    'expected_cash', v_shift.opening_float + v_cash_sales + v_cash_in - v_cash_out - v_cash_expenses - v_cash_advances,
    'by_method', v_by_method
  );
end;
$$;

grant execute on function public.get_shift_summary(uuid) to authenticated;
