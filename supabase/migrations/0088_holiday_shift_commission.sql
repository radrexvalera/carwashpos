-- "Regular Day" / "Holiday" toggle on My Shift (cashier_shifts), so the wash commission rate can
-- be bumped for a specific day without touching the tenant-wide Commission Rules setting (which
-- would silently apply to every future shift too, until someone remembers to revert it). Picked at
-- shift-open time, scoped to that shift's own location -- resolve_carwash_rate_for_location()
-- checks for any OPEN, holiday-flagged shift at a job's location at completion time, same way
-- resolve_service_commission_rate() already resolves the per-service rate.
alter table public.cashier_shifts add column is_holiday boolean not null default false;

alter table public.settings add column holiday_carwash_commission_rate numeric(5, 2) not null default 50
  check (holiday_carwash_commission_rate >= 0);

create or replace function public.resolve_carwash_rate_for_location(p_tenant_id uuid, p_location_id uuid)
returns numeric
language sql
security definer
stable
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.cashier_shifts
      where tenant_id = p_tenant_id and location_id = p_location_id and status = 'open' and is_holiday = true
    )
    then coalesce((select holiday_carwash_commission_rate from public.settings where tenant_id = p_tenant_id), 50)
    else coalesce((select carwash_commission_rate from public.settings where tenant_id = p_tenant_id), 30)
  end;
$$;

create or replace function public.complete_job(p_job_id uuid)
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
  v_commission_count int := 0;
  v_job_service_ids uuid[] := '{}';
  v_carwash_rate numeric(5, 2);
  v_other_rate numeric(5, 2);
  v_job_total numeric(12, 2) := 0;
  v_job_pool numeric(12, 2) := 0;
  v_effective_rate numeric(5, 2);
  v_crew_count int;
  v_crew_share numeric(12, 2);
  v_crew record;
  v_rate numeric(5, 2);
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_jobs') then
    raise exception 'Not authorized to complete jobs';
  end if;

  select * into v_job from public.jobs where id = p_job_id and tenant_id = v_tenant_id;
  if v_job.id is null then
    raise exception 'Job not found';
  end if;

  if v_job.status = 'completed' then
    return jsonb_build_object('id', v_job.id, 'status', 'completed', 'commission_entries_created', 0);
  end if;

  v_carwash_rate := public.resolve_carwash_rate_for_location(v_tenant_id, v_job.location_id);
  select other_commission_rate into v_other_rate from public.settings where tenant_id = v_tenant_id;
  v_other_rate := coalesce(v_other_rate, 40);

  for v_js in
    select js.*, coalesce(sc.is_carwash, false) as is_carwash
    from public.job_services js
    left join public.services s on s.id = js.service_id
    left join public.service_categories sc on sc.id = s.category_id
    where js.job_id = p_job_id and js.status not in ('completed', 'cancelled')
  loop
    v_job_service_ids := v_job_service_ids || v_js.id;
    v_job_total := v_job_total + v_js.line_total;

    if not public.job_service_uses_fixed_by_size(v_tenant_id, v_js.service_id) then
      v_rate := public.resolve_service_commission_rate(v_tenant_id, v_js.service_id, v_js.is_carwash, v_carwash_rate, v_other_rate);
      v_job_pool := v_job_pool + round(v_js.line_total * v_rate / 100, 2);
    end if;

    v_commission_count := v_commission_count + public.apply_job_service_bonus_commission(
      v_tenant_id, p_job_id, v_js.id, v_js.service_id, v_js.unit_price, v_js.quantity, v_js.line_total,
      v_job.vehicle_size_id, v_created_by
    );

    update public.job_services set status = 'completed', completed_at = now() where id = v_js.id;
  end loop;

  -- A blend, not a single fixed rate anymore -- shown on reports as "the % this pool works out to
  -- relative to the job's full revenue", not a rate that was actually configured anywhere.
  v_effective_rate := case when v_job_total > 0 then round(v_job_pool / v_job_total * 100, 2) else 0 end;

  if array_length(v_job_service_ids, 1) > 0 and v_job_pool > 0 then
    select count(distinct employee_id) into v_crew_count
    from public.job_service_attendants where job_service_id = any(v_job_service_ids);

    if v_crew_count > 0 then
      v_crew_share := round(v_job_pool / v_crew_count, 2);

      for v_crew in
        select distinct employee_id from public.job_service_attendants where job_service_id = any(v_job_service_ids)
      loop
        insert into public.commission_ledger (
          tenant_id, employee_id, job_id, job_service_id, service_id,
          gross_service_amount, commission_type, commission_rate, commission_amount, points,
          created_by
        ) values (
          v_tenant_id, v_crew.employee_id, p_job_id, null, null,
          v_job_total, 'job_percentage', v_effective_rate, v_crew_share, null,
          v_created_by
        );

        v_commission_count := v_commission_count + 1;
      end loop;
    end if;
  end if;

  update public.jobs set status = 'completed', completed_at = now(), bay_id = null, bay_entered_at = null where id = p_job_id;

  perform public.apply_card_fee_commission_adjustment(v_tenant_id, p_job_id, v_created_by);

  return jsonb_build_object('id', p_job_id, 'status', 'completed', 'commission_entries_created', v_commission_count);
end;
$$;

grant execute on function public.complete_job(uuid) to authenticated;

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

  -- Money already paid out needs a manual payroll adjustment, not an automated rewrite.
  if exists (
    select 1 from public.commission_ledger cl
    join public.payroll_periods pp on pp.id = cl.payroll_period_id
    where cl.job_id = p_job_id and cl.job_service_id is null and cl.service_id is null and pp.status = 'paid'
  ) then
    raise exception 'This job''s commission was already paid out -- use a payroll adjustment to correct it instead';
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

    -- A line added to the job AFTER it was already completed (the Unpaid-tab Edit dialog) never
    -- went through complete_job()'s own bonus loop -- catch it up here, once, the same way
    -- complete_job() would have. Guarded on "no ledger row yet for this line" so an existing line
    -- (just a quantity/crew tweak) never gets a second bonus payout.
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

  -- Every employee who currently has job-level commission recorded for this job (so a removed
  -- crew member's existing credit gets zeroed out) unioned with the currently assigned crew (so a
  -- newly added member gets their share).
  select count(distinct jsa.employee_id) into v_crew_count
  from public.job_service_attendants jsa
  join public.job_services js on js.id = jsa.job_service_id
  where js.job_id = p_job_id;

  v_crew_share := case when v_crew_count > 0 then round(v_job_pool / v_crew_count, 2) else 0 end;

  select cl.payroll_period_id into v_period_id
  from public.commission_ledger cl
  where cl.job_id = p_job_id and cl.job_service_id is null and cl.service_id is null and cl.payroll_period_id is not null
  limit 1;

  v_period_status := null;
  if v_period_id is not null then
    select status into v_period_status from public.payroll_periods where id = v_period_id;
  end if;

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

      if v_payroll_entry_id is not null then
        v_new_status := 'approved';
        v_new_payroll_period_id := v_period_id;
      end if;
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

  return jsonb_build_object(
    'job_id', p_job_id, 'rate', v_effective_rate, 'pool', v_job_pool, 'crew_count', v_crew_count,
    'entries_written', v_entries_written, 'bonus_entries_created', v_bonus_count
  );
end;
$$;

grant execute on function public.recompute_job_commission(uuid) to authenticated;
