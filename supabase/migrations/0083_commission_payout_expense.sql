-- Commission owed to crew is a real payable, same category as rent or supplies, but nothing
-- recorded the actual cash leaving the business when payroll is paid -- it only ever showed up as
-- a live "Pending commission" snapshot. Recording it as a real expense the moment payroll is
-- marked paid (not when it's earned) makes it cash-basis: Net only drops when the money actually
-- goes out, and it's visible in the Expense tracker's own by-category breakdown ("where the money
-- goes") instead of a separate, easy-to-miss number.
--
-- Category is found-or-created by name on first use, per tenant -- no backfill migration needed for
-- existing tenants, and no change needed to seed_new_tenant_defaults() for future ones either.
create or replace function public.mark_payroll_period_paid(p_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_period record;
  v_total_commission numeric(12, 2);
  v_category_id uuid;
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

  -- Summed from commission_ledger, not payroll_entries.commission_total alone -- a post-lock
  -- correction only lives in payroll_adjustments and never touches commission_total, but it DOES
  -- always get this payroll_period_id tagged onto its own ledger row either way (see
  -- recompute_job_commission()/void_sale()'s own comments), so this always captures the true total
  -- regardless of when corrections happened.
  select coalesce(sum(commission_amount), 0) into v_total_commission
  from public.commission_ledger where tenant_id = v_tenant_id and payroll_period_id = p_period_id;

  if v_total_commission > 0 then
    select id into v_category_id from public.expense_categories
    where tenant_id = v_tenant_id and name = 'Commission Payouts';

    if v_category_id is null then
      insert into public.expense_categories (tenant_id, name, sort_order, is_active)
      values (v_tenant_id, 'Commission Payouts', 999, true)
      returning id into v_category_id;
    end if;

    insert into public.expenses (
      tenant_id, category_id, description, amount, expense_date, payment_method, created_by
    ) values (
      v_tenant_id, v_category_id,
      'Commission payout for payroll period ' || v_period.start_date || ' to ' || v_period.end_date,
      v_total_commission, current_date, 'cash', auth.uid()
    );
  end if;

  return jsonb_build_object('id', p_period_id, 'status', 'paid');
end;
$$;

grant execute on function public.mark_payroll_period_paid(uuid) to authenticated;
