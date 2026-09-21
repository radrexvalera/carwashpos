-- Sole write path for expenses -- mirrors create_purchase_order()'s validation shape (permission
-- check, referenced-row existence check, positive-amount check, then a single insert).
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

  if coalesce(payload ->> 'payment_method', '') not in ('cash', 'gcash', 'maya', 'bank_transfer', 'card') then
    raise exception 'Invalid payment method';
  end if;

  insert into public.expenses (
    id, tenant_id, category_id, description, amount, expense_date, payment_method, paid_to,
    reference_note, created_by
  ) values (
    v_expense_id, v_tenant_id, v_category_id, v_description, v_amount,
    coalesce((payload ->> 'expense_date')::date, current_date), payload ->> 'payment_method',
    nullif(trim(coalesce(payload ->> 'paid_to', '')), ''),
    nullif(trim(coalesce(payload ->> 'reference_note', '')), ''), auth.uid()
  );

  return jsonb_build_object('id', v_expense_id);
end;
$$;

grant execute on function public.record_expense(jsonb) to authenticated;

-- Corrections never edit the original row (see prevent_expense_tampering) -- they void it with a
-- required reason, same discipline as a sale void.
create or replace function public.void_expense(p_expense_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if not public.has_permission('can_manage_expenses') then
    raise exception 'Not authorized to void expenses';
  end if;

  if v_reason = '' then
    raise exception 'A void reason is required';
  end if;

  update public.expenses
  set is_voided = true, voided_by = auth.uid(), voided_at = now(), void_reason = v_reason
  where id = p_expense_id and tenant_id = v_tenant_id and is_voided = false;

  if not found then
    raise exception 'Expense not found or already voided';
  end if;
end;
$$;

grant execute on function public.void_expense(uuid, text) to authenticated;
