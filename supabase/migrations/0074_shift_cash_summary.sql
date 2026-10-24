-- close_shift()'s cash math was already correct (opening float + CASH payments only + cash_in -
-- cash_out -- gcash/bank_transfer/maya/card etc. never touched the drawer, so they were never
-- counted), but nothing showed a cashier that breakdown before they typed a counted amount and
-- closed -- the variance only appeared after the fact, with no way to see it coming or understand
-- why it didn't match total sales. get_shift_summary() is the same computation, read-only, so the
-- UI can show it live while the shift is still open; close_shift() now calls it instead of
-- duplicating the math, so the two can never drift apart.
--
-- Also links an expense to whichever shift is open for the person recording it (cash expenses
-- only -- a non-cash expense never touched the till) so a cash expense paid directly out of the
-- drawer mid-shift (e.g. buying supplies) is subtracted from expected cash too -- previously
-- expenses were untracked against any shift at all, a gap called out when expenses was first
-- built (0036's own comment: "revisit only if the business specifically wants till-paid expenses
-- reflected in shift cash-counting").
--
-- And fixes a bug from the payment-methods migration (0066): it widened expenses.payment_method's
-- table-level CHECK CONSTRAINT to the new PH bank/e-wallet methods, but record_expense() has its
-- own separate inline validation that was never updated to match, so every one of those methods
-- has been silently rejected ever since.
alter table public.expenses add column shift_id uuid references public.cashier_shifts(id);
create index expenses_shift_id_idx on public.expenses(shift_id);

create or replace function public.prevent_expense_tampering()
returns trigger
language plpgsql
as $$
begin
  if new.category_id is distinct from old.category_id
    or new.description is distinct from old.description
    or new.amount is distinct from old.amount
    or new.expense_date is distinct from old.expense_date
    or new.payment_method is distinct from old.payment_method
    or new.shift_id is distinct from old.shift_id
    or new.tenant_id is distinct from old.tenant_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Expense financial/identity fields can only be set by record_expense(); use void_expense() to correct a mistake';
  end if;
  return new;
end;
$$;

create or replace function public.record_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_category_id uuid := (payload ->> 'category_id')::uuid;
  v_amount numeric(12, 2) := (payload ->> 'amount')::numeric;
  v_description text := trim(coalesce(payload ->> 'description', ''));
  v_expense_id uuid := gen_random_uuid();
  v_payment_method text := payload ->> 'payment_method';
  v_shift_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_expenses') then
    raise exception 'Not authorized to record expenses';
  end if;

  if v_category_id is null or not exists (
    select 1 from public.expense_categories where id = v_category_id and tenant_id = v_tenant_id
  ) then
    raise exception 'Expense category not found';
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'Expense amount must be positive';
  end if;

  if v_description = '' then
    raise exception 'Expense description is required';
  end if;

  if coalesce(v_payment_method, '') not in (
    'cash', 'gcash', 'maya', 'bank_transfer', 'card', 'maribank', 'gotyme', 'rcbc', 'bpi', 'unionbank', 'qrph'
  ) then
    raise exception 'Invalid payment method';
  end if;

  if v_payment_method = 'cash' then
    select id into v_shift_id from public.cashier_shifts
    where tenant_id = v_tenant_id and cashier_id = public.current_employee_id() and status = 'open';
  end if;

  insert into public.expenses (
    id, tenant_id, category_id, description, amount, expense_date, payment_method, paid_to,
    reference_note, shift_id, created_by
  ) values (
    v_expense_id, v_tenant_id, v_category_id, v_description, v_amount,
    coalesce((payload ->> 'expense_date')::date, current_date), v_payment_method,
    nullif(trim(coalesce(payload ->> 'paid_to', '')), ''),
    nullif(trim(coalesce(payload ->> 'reference_note', '')), ''), v_shift_id, auth.uid()
  );

  return jsonb_build_object('id', v_expense_id);
end;
$$;

grant execute on function public.record_expense(jsonb) to authenticated;

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
    'expected_cash', v_shift.opening_float + v_cash_sales + v_cash_in - v_cash_out - v_cash_expenses,
    'by_method', v_by_method
  );
end;
$$;

grant execute on function public.get_shift_summary(uuid) to authenticated;

create or replace function public.close_shift(p_shift_id uuid, p_counted_cash numeric, p_variance_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_shift record;
  v_summary jsonb;
  v_expected numeric(12, 2);
  v_variance numeric(12, 2);
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  select * into v_shift from public.cashier_shifts where id = p_shift_id and tenant_id = v_tenant_id;
  if v_shift.id is null then
    raise exception 'Shift not found';
  end if;

  if v_shift.status = 'closed' then
    return jsonb_build_object(
      'id', v_shift.id, 'status', 'closed', 'expected_cash', v_shift.expected_cash,
      'counted_cash', v_shift.counted_cash, 'variance', v_shift.variance
    );
  end if;

  if v_shift.cashier_id != public.current_employee_id() and not public.has_permission('can_review_shifts') then
    raise exception 'Not authorized to close this shift';
  end if;

  v_summary := public.get_shift_summary(p_shift_id);
  v_expected := (v_summary ->> 'expected_cash')::numeric;
  v_variance := round(p_counted_cash - v_expected, 2);

  update public.cashier_shifts
  set status = 'closed', closed_at = now(), expected_cash = v_expected, counted_cash = p_counted_cash,
      variance = v_variance, variance_reason = p_variance_reason
  where id = p_shift_id;

  return jsonb_build_object(
    'id', p_shift_id, 'status', 'closed', 'expected_cash', v_expected, 'counted_cash', p_counted_cash,
    'variance', v_variance, 'summary', v_summary
  );
end;
$$;
