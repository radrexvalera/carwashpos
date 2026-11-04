-- cashier_shifts has deliberately had no update policy since 0020 -- closing only ever happens
-- through close_shift(), which computes expected_cash server-side. But that also means a typo in
-- the counted-cash figure, caught right after closing, has had no fix path at all until now.
-- Rather than allowing a silent overwrite, this keeps the same audit discipline as every other
-- correction in this app (void_sale/void_expense/payroll_adjustments): a required reason, and the
-- correction itself is recorded (who, when, why), not just silently applied over the original
-- value.
alter table public.cashier_shifts add column corrected_by uuid references public.user_profiles(id);
alter table public.cashier_shifts add column corrected_at timestamptz;
alter table public.cashier_shifts add column correction_reason text;

create or replace function public.correct_shift_counted_cash(p_shift_id uuid, p_counted_cash numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_shift record;
  v_reason text := trim(coalesce(p_reason, ''));
  v_variance numeric(12, 2);
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  select * into v_shift from public.cashier_shifts where id = p_shift_id and tenant_id = v_tenant_id;
  if v_shift.id is null then
    raise exception 'Shift not found';
  end if;

  if v_shift.status != 'closed' then
    raise exception 'Only a closed shift''s counted cash can be corrected -- close it first';
  end if;

  -- Same actor rule as close_shift() itself: the cashier who closed it, or a reviewer.
  if v_shift.cashier_id != public.current_employee_id() and not public.has_permission('can_review_shifts') then
    raise exception 'Not authorized to correct this shift';
  end if;

  if v_reason = '' then
    raise exception 'A reason is required to correct counted cash';
  end if;

  if p_counted_cash < 0 then
    raise exception 'Counted cash cannot be negative';
  end if;

  -- expected_cash is NOT recomputed -- it's the snapshot of what this shift's own sales/cash
  -- movements added up to at close time, and shouldn't shift just because time has passed.
  v_variance := round(p_counted_cash - v_shift.expected_cash, 2);

  update public.cashier_shifts
  set counted_cash = p_counted_cash, variance = v_variance,
      corrected_by = auth.uid(), corrected_at = now(), correction_reason = v_reason
  where id = p_shift_id;

  return jsonb_build_object(
    'id', p_shift_id, 'expected_cash', v_shift.expected_cash, 'counted_cash', p_counted_cash, 'variance', v_variance
  );
end;
$$;

grant execute on function public.correct_shift_counted_cash(uuid, numeric, text) to authenticated;
