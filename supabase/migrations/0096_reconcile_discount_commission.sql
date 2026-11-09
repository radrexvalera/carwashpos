-- Commission on a discounted job must be rate x (price - discount), split across the crew, with a
-- freebie (a line discounted to zero) still keeping its full commission (0090's rule, re-confirmed
-- by the owner). Two ways the existing adjustments missed that:
--
-- 1. Crew assigned AFTER a discounted sale got full commission. recompute_job_commission() resets
--    every crew member to a full, undiscounted share; apply_discount_commission_adjustment() /
--    apply_card_fee_commission_adjustment() returned early if the job had EVER been adjusted
--    ("once only"), so the cut was never re-applied -- and for crew added later it never existed.
--    Real cases: JOB-20261106-0020 (P560 paid, P500 owed) and JOB-20261108-0017 (P20,000 paid,
--    P11,600 owed). Fix: both adjustments now RECONCILE instead of running once -- for each crew
--    row group they compute the cut the job should carry today and write only the difference from
--    what's already in the ledger, so they're safe to call any number of times, and
--    recompute_job_commission() calls them after re-sharing the crew.
--
-- 2. A discount on one line was spread across the whole job at a blended rate. The fraction is now
--    weighted by each line's own commission rate (sum of rate x discounted value / sum of rate x
--    full value), so a discount reduces commission exactly by that line's rate x its discount. For
--    a single-rate job (every discounted job so far) this is the same number as before.
--
-- Separately: neither adjustment function ever had EXECUTE revoked, and Supabase grants EXECUTE on
-- public functions to anon/authenticated by default -- the same gap 0051 closed for
-- record_inventory_transaction(). Revoked below; they're only ever called from other SECURITY
-- DEFINER functions, which keep their own rights.

-- Ledger rows that carry the discount / card-fee cut, by adjustment_reason. Everything else on a
-- job (originals, crew corrections, void reversals) is the "base" those cuts are taken from.
create or replace function public.apply_discount_commission_adjustment(p_tenant_id uuid, p_job_id uuid, p_created_by uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_sale record;
  v_job_total numeric(12, 2) := 0;
  v_pooled_discount numeric(12, 2);
  v_eligible_base numeric(12, 2);
  v_carwash_rate numeric(5, 2);
  v_other_rate numeric(5, 2);
  v_rate numeric(5, 2);
  v_js record;
  v_effective numeric(12, 2);
  v_weighted_full numeric(14, 4) := 0;
  v_weighted_effective numeric(14, 4) := 0;
  v_job_fraction numeric(8, 6);
  v_line_fractions jsonb := '{}'::jsonb;
  v_fraction numeric(8, 6);
  v_comm record;
  v_target numeric(12, 2);
  v_delta numeric(12, 2);
  v_comm_period_status text;
  v_comm_payroll_entry_id uuid;
begin
  select * into v_job from public.jobs where id = p_job_id and tenant_id = p_tenant_id;
  if v_job.id is null then
    return;
  end if;

  select coalesce(sum(line_total), 0) into v_job_total
  from public.job_services where job_id = p_job_id and status != 'cancelled';
  if v_job_total <= 0 then
    return;
  end if;

  select * into v_sale from public.sales where job_id = p_job_id and status != 'voided' limit 1;
  if v_sale.id is null then
    return;
  end if;

  v_pooled_discount := coalesce(v_sale.manual_discount_amount, 0) + coalesce(v_sale.promotion_discount_amount, 0) + coalesce(v_sale.loyalty_discount_amount, 0);

  select coalesce(sum(si.line_total), 0) into v_eligible_base
  from public.sale_items si
  join public.job_services js on js.id = si.job_service_id
  where si.sale_id = v_sale.id and si.line_type = 'job_service'
    and si.discount_amount < js.line_total;

  v_carwash_rate := public.resolve_carwash_rate_for_location(p_tenant_id, v_job.location_id);
  select other_commission_rate into v_other_rate from public.settings where tenant_id = p_tenant_id;
  v_other_rate := coalesce(v_other_rate, 40);

  -- Each line's value after its checkout discount (same rules as 0090: unbilled lines and freebies
  -- count at full value), weighted by the line's own commission rate.
  for v_js in
    select js.id, js.service_id, js.line_total, coalesce(sc.is_carwash, false) as is_carwash,
           si.discount_amount as si_discount, si.line_total as si_line_total
    from public.job_services js
    left join public.services s on s.id = js.service_id
    left join public.service_categories sc on sc.id = s.category_id
    left join public.sale_items si on si.sale_id = v_sale.id and si.job_service_id = js.id
    where js.job_id = p_job_id and js.status != 'cancelled'
  loop
    if v_js.si_line_total is null or v_js.si_discount >= v_js.line_total then
      v_effective := v_js.line_total;
    else
      v_effective := greatest(
        v_js.si_line_total - case when v_eligible_base > 0 then round(v_pooled_discount * v_js.si_line_total / v_eligible_base, 2) else 0 end,
        0
      );
    end if;

    v_line_fractions := v_line_fractions || jsonb_build_object(
      v_js.id::text,
      case when v_js.line_total > 0 then greatest(0, least(1, round(1 - v_effective / v_js.line_total, 6))) else 0 end
    );

    if not public.job_service_uses_fixed_by_size(p_tenant_id, v_js.service_id) then
      v_rate := public.resolve_service_commission_rate(p_tenant_id, v_js.service_id, v_js.is_carwash, v_carwash_rate, v_other_rate);
      v_weighted_full := v_weighted_full + v_js.line_total * v_rate;
      v_weighted_effective := v_weighted_effective + v_effective * v_rate;
    end if;
  end loop;

  v_job_fraction := case
    when v_weighted_full > 0 then greatest(0, least(1, round(1 - v_weighted_effective / v_weighted_full, 6)))
    else 0
  end;

  for v_comm in
    select
      employee_id, job_service_id, service_id, commission_rate,
      sum(commission_amount) filter (where adjustment_reason is distinct from 'Checkout discount (excluding freebies)'
                                       and adjustment_reason is distinct from 'Card processing fee') as base_amount,
      coalesce(sum(commission_amount) filter (where adjustment_reason = 'Checkout discount (excluding freebies)'), 0) as existing_cut,
      max(gross_service_amount) as gross_amount,
      (array_agg(commission_type order by created_at desc))[1] as commission_type,
      (array_agg(id order by created_at desc))[1] as latest_ledger_id,
      (array_agg(payroll_period_id order by created_at desc) filter (where payroll_period_id is not null))[1] as period_id
    from public.commission_ledger
    where job_id = p_job_id and commission_type != 'manual'
    group by employee_id, job_service_id, service_id, commission_rate
  loop
    -- A row tied to one specific line uses that line's own fraction (a freebie line's is 0); a
    -- whole-job row uses the rate-weighted job fraction.
    if v_comm.job_service_id is not null then
      v_fraction := coalesce((v_line_fractions ->> v_comm.job_service_id::text)::numeric, 0);
    else
      v_fraction := v_job_fraction;
    end if;

    -- existing_cut is stored negative; target is the cut as a positive amount.
    v_target := round(greatest(coalesce(v_comm.base_amount, 0), 0) * v_fraction, 2);
    v_delta := round(v_target + v_comm.existing_cut, 2);
    if abs(v_delta) < 0.01 then
      continue;
    end if;

    v_comm_period_status := null;
    v_comm_payroll_entry_id := null;
    if v_comm.period_id is not null then
      select status into v_comm_period_status from public.payroll_periods where id = v_comm.period_id;
    end if;
    if v_comm_period_status = 'paid' then
      continue;
    end if;
    if v_comm.period_id is not null then
      select id into v_comm_payroll_entry_id from public.payroll_entries
      where payroll_period_id = v_comm.period_id and employee_id = v_comm.employee_id;
    end if;

    insert into public.commission_ledger (
      tenant_id, employee_id, job_id, job_service_id, service_id,
      gross_service_amount, commission_type, commission_rate, commission_amount,
      status, payroll_period_id, reverses_ledger_id, adjustment_reason, created_by
    ) values (
      p_tenant_id, v_comm.employee_id, p_job_id, v_comm.job_service_id, v_comm.service_id,
      v_comm.gross_amount, v_comm.commission_type, v_comm.commission_rate, -v_delta,
      case when v_comm_payroll_entry_id is not null then 'approved' else 'earned' end,
      case when v_comm_payroll_entry_id is not null then v_comm.period_id else null end,
      v_comm.latest_ledger_id, 'Checkout discount (excluding freebies)', p_created_by
    );

    if v_comm_payroll_entry_id is not null then
      if v_comm_period_status = 'draft' then
        update public.payroll_entries set commission_total = commission_total - v_delta where id = v_comm_payroll_entry_id;
      elsif v_comm_period_status = 'locked' then
        insert into public.payroll_adjustments (tenant_id, payroll_entry_id, amount, reason, created_by)
        values (p_tenant_id, v_comm_payroll_entry_id, -v_delta, 'Checkout discount (excluding freebies)', p_created_by);
      end if;
    end if;
  end loop;
end;
$$;

-- Same reconcile shape: the fee cut is taken from the commission left after the discount cut.
create or replace function public.apply_card_fee_commission_adjustment(p_tenant_id uuid, p_job_id uuid, p_created_by uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_total numeric(12, 2);
  v_card_fee numeric(12, 2);
  v_fee_fraction numeric(8, 6);
  v_comm record;
  v_target numeric(12, 2);
  v_delta numeric(12, 2);
  v_comm_period_status text;
  v_comm_payroll_entry_id uuid;
begin
  select coalesce(sum(line_total), 0) into v_job_total
  from public.job_services where job_id = p_job_id and status != 'cancelled';

  select coalesce(sum(card_processing_fee), 0) into v_card_fee
  from public.sales where job_id = p_job_id and status != 'voided';

  if v_job_total <= 0 or v_card_fee <= 0 then
    return;
  end if;

  v_fee_fraction := least(v_card_fee / v_job_total, 1);

  for v_comm in
    select
      employee_id, job_service_id, service_id, commission_rate,
      sum(commission_amount) filter (where adjustment_reason is distinct from 'Card processing fee') as after_discount,
      coalesce(sum(commission_amount) filter (where adjustment_reason = 'Card processing fee'), 0) as existing_cut,
      max(gross_service_amount) as gross_amount,
      (array_agg(commission_type order by created_at desc))[1] as commission_type,
      (array_agg(id order by created_at desc))[1] as latest_ledger_id,
      (array_agg(payroll_period_id order by created_at desc) filter (where payroll_period_id is not null))[1] as period_id
    from public.commission_ledger
    where job_id = p_job_id and commission_type != 'manual'
    group by employee_id, job_service_id, service_id, commission_rate
  loop
    v_target := round(greatest(coalesce(v_comm.after_discount, 0), 0) * v_fee_fraction, 2);
    v_delta := round(v_target + v_comm.existing_cut, 2);
    if abs(v_delta) < 0.01 then
      continue;
    end if;

    v_comm_period_status := null;
    v_comm_payroll_entry_id := null;
    if v_comm.period_id is not null then
      select status into v_comm_period_status from public.payroll_periods where id = v_comm.period_id;
    end if;
    if v_comm_period_status = 'paid' then
      continue;
    end if;
    if v_comm.period_id is not null then
      select id into v_comm_payroll_entry_id from public.payroll_entries
      where payroll_period_id = v_comm.period_id and employee_id = v_comm.employee_id;
    end if;

    insert into public.commission_ledger (
      tenant_id, employee_id, job_id, job_service_id, service_id,
      gross_service_amount, commission_type, commission_rate, commission_amount,
      status, payroll_period_id, reverses_ledger_id, adjustment_reason, created_by
    ) values (
      p_tenant_id, v_comm.employee_id, p_job_id, v_comm.job_service_id, v_comm.service_id,
      v_comm.gross_amount, v_comm.commission_type, v_comm.commission_rate, -v_delta,
      case when v_comm_payroll_entry_id is not null then 'approved' else 'earned' end,
      case when v_comm_payroll_entry_id is not null then v_comm.period_id else null end,
      v_comm.latest_ledger_id, 'Card processing fee', p_created_by
    );

    if v_comm_payroll_entry_id is not null then
      if v_comm_period_status = 'draft' then
        update public.payroll_entries set commission_total = commission_total - v_delta where id = v_comm_payroll_entry_id;
      elsif v_comm_period_status = 'locked' then
        insert into public.payroll_adjustments (tenant_id, payroll_entry_id, amount, reason, created_by)
        values (p_tenant_id, v_comm_payroll_entry_id, -v_delta, 'Card processing fee', p_created_by);
      end if;
    end if;
  end loop;
end;
$$;

revoke execute on function public.apply_discount_commission_adjustment(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.apply_card_fee_commission_adjustment(uuid, uuid, uuid) from public, anon, authenticated;

-- Unchanged from 0094 except the two adjustment calls at the end.
create or replace function public.recompute_job_commission(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_created_by uuid := auth.uid();
  v_job record;
  v_js record;
  v_job_total numeric(12, 2) := 0;
  v_job_pool numeric(12, 2) := 0;
  v_carwash_rate numeric(5, 2);
  v_other_rate numeric(5, 2);
  v_rate numeric(5, 2);
  v_crew_count int;
  v_crew_share numeric(12, 2);
  v_emp record;
  v_existing_net numeric(12, 2);
  v_delta numeric(12, 2);
  v_is_current_crew boolean;
  v_period_id uuid;
  v_period_status text;
  v_period_start date;
  v_period_end date;
  v_payroll_entry_id uuid;
  v_latest_ledger_id uuid;
  v_new_status text;
  v_new_payroll_period_id uuid;
  v_entries_written int := 0;
  v_bonus_count int := 0;
  v_effective_rate numeric(5, 2);
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_jobs') then
    raise exception 'Not authorized to edit crew or recompute commission';
  end if;

  select * into v_job from public.jobs where id = p_job_id and tenant_id = v_tenant_id;
  if v_job.id is null then
    raise exception 'Job not found';
  end if;
  if v_job.status != 'completed' then
    raise exception 'Job is not completed yet -- crew changes are picked up automatically when it is';
  end if;

  if public.job_has_repaint_line(v_tenant_id, p_job_id) then
    raise exception 'This job''s commission was entered manually at Collect Payment -- crew changes here can''t recompute it automatically';
  end if;

  if exists (
    select 1 from public.commission_ledger cl
    join public.payroll_periods pp on pp.id = cl.payroll_period_id
    where cl.job_id = p_job_id and cl.job_service_id is null and cl.service_id is null and pp.status = 'paid'
  ) then
    raise exception 'This job''s commission was already paid out -- use a payroll adjustment to correct it instead';
  end if;

  select id, status, start_date, end_date into v_period_id, v_period_status, v_period_start, v_period_end
  from public.payroll_periods
  where tenant_id = v_tenant_id and v_job.completed_at::date between start_date and end_date
  order by created_at desc
  limit 1;

  if v_period_status = 'paid' then
    raise exception 'The crew has been updated, but this job falls in payroll period % to %, which is already marked paid -- record this commission as a manual payroll adjustment for that period instead.', v_period_start, v_period_end;
  end if;

  v_carwash_rate := public.resolve_carwash_rate_for_location(v_tenant_id, v_job.location_id);
  select other_commission_rate into v_other_rate from public.settings where tenant_id = v_tenant_id;
  v_other_rate := coalesce(v_other_rate, 40);

  for v_js in
    select js.*, coalesce(sc.is_carwash, false) as is_carwash
    from public.job_services js
    left join public.services s on s.id = js.service_id
    left join public.service_categories sc on sc.id = s.category_id
    where js.job_id = p_job_id and js.status != 'cancelled'
  loop
    v_job_total := v_job_total + v_js.line_total;

    if not public.job_service_uses_fixed_by_size(v_tenant_id, v_js.service_id) then
      v_rate := public.resolve_service_commission_rate(v_tenant_id, v_js.service_id, v_js.is_carwash, v_carwash_rate, v_other_rate);
      v_job_pool := v_job_pool + round(v_js.line_total * v_rate / 100, 2);
    end if;

    if not exists (select 1 from public.commission_ledger where job_service_id = v_js.id) then
      v_bonus_count := v_bonus_count + public.apply_job_service_bonus_commission(
        v_tenant_id, p_job_id, v_js.id, v_js.service_id, v_js.unit_price, v_js.quantity, v_js.line_total,
        v_job.vehicle_size_id, v_created_by
      );
    end if;

    if v_js.status != 'completed' then
      update public.job_services set status = 'completed', completed_at = now() where id = v_js.id;
    end if;
  end loop;

  v_effective_rate := case when v_job_total > 0 then round(v_job_pool / v_job_total * 100, 2) else 0 end;

  select count(distinct jsa.employee_id) into v_crew_count
  from public.job_service_attendants jsa
  join public.job_services js on js.id = jsa.job_service_id
  where js.job_id = p_job_id;

  v_crew_share := case when v_crew_count > 0 then round(v_job_pool / v_crew_count, 2) else 0 end;

  for v_emp in
    select employee_id from (
      select distinct employee_id from public.commission_ledger
      where job_id = p_job_id and job_service_id is null and service_id is null
      union
      select distinct jsa.employee_id from public.job_service_attendants jsa
      join public.job_services js on js.id = jsa.job_service_id
      where js.job_id = p_job_id
    ) x
  loop
    select coalesce(sum(commission_amount), 0) into v_existing_net
    from public.commission_ledger
    where job_id = p_job_id and job_service_id is null and service_id is null and employee_id = v_emp.employee_id;

    select id into v_latest_ledger_id
    from public.commission_ledger
    where job_id = p_job_id and job_service_id is null and service_id is null and employee_id = v_emp.employee_id
    order by created_at desc limit 1;

    select exists (
      select 1 from public.job_service_attendants jsa join public.job_services js on js.id = jsa.job_service_id
      where js.job_id = p_job_id and jsa.employee_id = v_emp.employee_id
    ) into v_is_current_crew;

    v_delta := round((case when v_is_current_crew then v_crew_share else 0 end) - v_existing_net, 2);
    if abs(v_delta) < 0.01 then
      continue;
    end if;

    v_payroll_entry_id := null;
    v_new_status := 'earned';
    v_new_payroll_period_id := null;

    if v_period_id is not null then
      select id into v_payroll_entry_id from public.payroll_entries
      where payroll_period_id = v_period_id and employee_id = v_emp.employee_id;

      if v_payroll_entry_id is null then
        insert into public.payroll_entries (tenant_id, payroll_period_id, employee_id, base_pay, commission_total)
        values (v_tenant_id, v_period_id, v_emp.employee_id, 0, 0)
        returning id into v_payroll_entry_id;
      end if;

      v_new_status := 'approved';
      v_new_payroll_period_id := v_period_id;
    end if;

    insert into public.commission_ledger (
      tenant_id, employee_id, job_id, job_service_id, service_id,
      gross_service_amount, commission_type, commission_rate, commission_amount,
      status, payroll_period_id, reverses_ledger_id, adjustment_reason, created_by
    ) values (
      v_tenant_id, v_emp.employee_id, p_job_id, null, null,
      v_job_total, 'job_percentage', v_effective_rate, v_delta,
      v_new_status, v_new_payroll_period_id, v_latest_ledger_id,
      'Crew assignment corrected after job completion', v_created_by
    );

    if v_payroll_entry_id is not null then
      if v_period_status = 'draft' then
        update public.payroll_entries set commission_total = commission_total + v_delta where id = v_payroll_entry_id;
      elsif v_period_status = 'locked' then
        insert into public.payroll_adjustments (tenant_id, payroll_entry_id, amount, reason, created_by)
        values (v_tenant_id, v_payroll_entry_id, v_delta, 'Crew assignment corrected after job completion', v_created_by);
      end if;
    end if;

    v_entries_written := v_entries_written + 1;
  end loop;

  -- The crew shares above are full, undiscounted amounts. Re-apply the checkout discount and card-fee
  -- cuts so a crew member added or changed after a discounted sale gets rate x (price - discount)
  -- like everyone else -- both reconcile, so this only writes what's actually missing.
  perform public.apply_discount_commission_adjustment(v_tenant_id, p_job_id, v_created_by);
  perform public.apply_card_fee_commission_adjustment(v_tenant_id, p_job_id, v_created_by);

  return jsonb_build_object(
    'job_id', p_job_id, 'rate', v_effective_rate, 'pool', v_job_pool, 'crew_count', v_crew_count,
    'entries_written', v_entries_written, 'bonus_entries_created', v_bonus_count
  );
end;
$$;

grant execute on function public.recompute_job_commission(uuid) to authenticated;
