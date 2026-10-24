-- void_sale() can now optionally also reverse the job's commission, caller's choice per void (the
-- UI defaults this off -- a voided transaction is often just a billing mistake where the service
-- genuinely happened and the crew should still be paid for it; only a voided-because-the-job-was-
-- bad-or-undone case should also pull the commission back). When requested, covers BOTH shapes
-- commission can take for a job: the job-level percentage pool (job_service_id/service_id both
-- null) that recompute_job_commission() already knows how to correct, and any per-service
-- fixed_pool/fixed_per_attendant/points commission (which that function never touched). Grouped by
-- (employee_id, job_service_id, service_id, commission_rate) -- the same netting key used
-- throughout the commission report/payroll breakdown -- so a job that already had a prior
-- correction nets correctly instead of double-reversing.
--
-- Same payroll-period awareness as recompute_job_commission(): a draft period's entry is adjusted
-- directly, a locked period gets a payroll_adjustments row, and a period already marked PAID is
-- left alone entirely (money already left the business through payroll can't be silently
-- rewritten) -- that line is just skipped and counted, surfaced back to the caller so the owner
-- knows a manual payroll adjustment is still needed. The void itself always proceeds either way;
-- unlike recompute_job_commission(), this never blocks the whole operation over one paid line.
--
-- The new boolean parameter makes this a different signature, not a replacement of 0071's
-- two-arg version -- drop that one first or both would coexist (the old one still callable with
-- just 2 args too, since the new param has a default), making a 2-arg call ambiguous.
drop function if exists public.void_sale(uuid, text);

create or replace function public.void_sale(p_sale_id uuid, p_reason text, p_reverse_commission boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_created_by uuid := auth.uid();
  v_reason text := trim(coalesce(p_reason, ''));
  v_sale record;
  v_item record;
  v_loyalty record;
  v_stamp record;
  v_comm record;
  v_comm_period_id uuid;
  v_comm_period_status text;
  v_comm_payroll_entry_id uuid;
  v_commission_reversed int := 0;
  v_commission_skipped int := 0;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_refund') then
    raise exception 'Not authorized to void transactions';
  end if;

  if v_reason = '' then
    raise exception 'A void reason is required';
  end if;

  select * into v_sale from public.sales where id = p_sale_id and tenant_id = v_tenant_id;
  if v_sale.id is null then
    raise exception 'Transaction not found';
  end if;

  if v_sale.status = 'voided' then
    raise exception 'This transaction is already voided';
  end if;

  update public.sales
  set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = v_reason
  where id = p_sale_id;

  for v_item in
    select item_id, quantity from public.sale_items where sale_id = p_sale_id and line_type = 'product'
  loop
    perform public.record_inventory_transaction(v_item.item_id, 'returned', v_item.quantity, null, 'sale_void', p_sale_id, v_reason);
  end loop;

  for v_loyalty in
    select transaction_type, points_delta from public.loyalty_transactions where sale_id = p_sale_id
  loop
    insert into public.loyalty_transactions (tenant_id, customer_id, transaction_type, points_delta, sale_id, created_by)
    values (v_tenant_id, v_sale.customer_id, v_loyalty.transaction_type, -v_loyalty.points_delta, p_sale_id, auth.uid());
  end loop;

  for v_stamp in
    select program_id, transaction_type, stamp_delta from public.membership_stamps where sale_id = p_sale_id
  loop
    insert into public.membership_stamps (tenant_id, customer_id, program_id, transaction_type, stamp_delta, sale_id, created_by)
    values (v_tenant_id, v_sale.customer_id, v_stamp.program_id, v_stamp.transaction_type, -v_stamp.stamp_delta, p_sale_id, auth.uid());
  end loop;

  if p_reverse_commission and v_sale.job_id is not null then
    for v_comm in
      select
        employee_id, job_service_id, service_id, commission_rate,
        sum(commission_amount) as net_amount,
        max(gross_service_amount) as gross_amount,
        (array_agg(commission_type order by created_at desc))[1] as commission_type,
        (array_agg(id order by created_at desc))[1] as latest_ledger_id
      from public.commission_ledger
      where job_id = v_sale.job_id
      group by employee_id, job_service_id, service_id, commission_rate
    loop
      if abs(v_comm.net_amount) < 0.01 then
        continue;
      end if;

      -- Every row in this group is claimed into the same payroll period in practice
      -- (generate_payroll_period() claims a whole date range per employee in one pass), so any one
      -- of them is representative.
      select payroll_period_id into v_comm_period_id
      from public.commission_ledger
      where job_id = v_sale.job_id and employee_id = v_comm.employee_id
        and job_service_id is not distinct from v_comm.job_service_id
        and service_id is not distinct from v_comm.service_id
        and commission_rate = v_comm.commission_rate
        and payroll_period_id is not null
      limit 1;

      v_comm_period_status := null;
      v_comm_payroll_entry_id := null;
      if v_comm_period_id is not null then
        select status into v_comm_period_status from public.payroll_periods where id = v_comm_period_id;
      end if;

      if v_comm_period_status = 'paid' then
        v_commission_skipped := v_commission_skipped + 1;
        continue;
      end if;

      if v_comm_period_id is not null then
        select id into v_comm_payroll_entry_id from public.payroll_entries
        where payroll_period_id = v_comm_period_id and employee_id = v_comm.employee_id;
      end if;

      insert into public.commission_ledger (
        tenant_id, employee_id, job_id, job_service_id, service_id,
        gross_service_amount, commission_type, commission_rate, commission_amount,
        status, payroll_period_id, reverses_ledger_id, adjustment_reason, created_by
      ) values (
        v_tenant_id, v_comm.employee_id, v_sale.job_id, v_comm.job_service_id, v_comm.service_id,
        v_comm.gross_amount, v_comm.commission_type, v_comm.commission_rate, -v_comm.net_amount,
        case when v_comm_payroll_entry_id is not null then 'approved' else 'earned' end,
        case when v_comm_payroll_entry_id is not null then v_comm_period_id else null end,
        v_comm.latest_ledger_id, 'Commission reversed -- transaction voided: ' || v_reason, v_created_by
      );

      if v_comm_payroll_entry_id is not null then
        if v_comm_period_status = 'draft' then
          update public.payroll_entries set commission_total = commission_total - v_comm.net_amount where id = v_comm_payroll_entry_id;
        elsif v_comm_period_status = 'locked' then
          insert into public.payroll_adjustments (tenant_id, payroll_entry_id, amount, reason, created_by)
          values (v_tenant_id, v_comm_payroll_entry_id, -v_comm.net_amount, 'Commission reversed -- transaction voided: ' || v_reason, v_created_by);
        end if;
      end if;

      v_commission_reversed := v_commission_reversed + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'id', p_sale_id, 'status', 'voided',
    'commission_reversed_count', v_commission_reversed, 'commission_skipped_count', v_commission_skipped
  );
end;
$$;

grant execute on function public.void_sale(uuid, text, boolean) to authenticated;
