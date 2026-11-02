-- Bug: generate_payroll_period() filtered commission_ledger by its own created_at, not by when
-- the underlying job actually happened. That's correct for the normal flow (commission is
-- recorded right at job completion/payment, so the two dates match), but wrong for ANY
-- correction made after the fact: recompute_job_commission() (the EditCrewDialog "add a crew
-- that was missed" path) inserts its correction row with created_at = now(), which can be days
-- after the job itself. A payroll run for the period the job actually happened in silently
-- missed that correction -- found via live Test123 data: two real crew corrections for jobs
-- completed Oct 30/31 were stamped created_at Nov 2 (correction day), fell outside the Oct
-- 26-Nov 1 payroll period's date filter, and were silently excluded even though the period was
-- generated AFTER the correction existed. Every commission_ledger row is tied to a real job
-- (job_id not null), so anchoring the filter to jobs.completed_at fixes this for every
-- "corrected after the fact" path (crew recompute, future bonus/card-fee adjustments), not just
-- this one report.
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
      select cl.employee_id, sum(cl.commission_amount) as total
      from public.commission_ledger cl
      join public.jobs j on j.id = cl.job_id
      where cl.tenant_id = v_tenant_id
        and cl.payroll_period_id is null
        and cl.status = 'earned'
        and j.completed_at::date between p_start_date and p_end_date
      group by cl.employee_id
    ) cl on cl.employee_id = e.id
    where e.tenant_id = v_tenant_id
      and (cl.total is not null or (e.active and e.salary_rate is not null))
  loop
    insert into public.payroll_entries (tenant_id, payroll_period_id, employee_id, base_pay, commission_total)
    values (v_tenant_id, v_period_id, v_employee.employee_id, v_employee.base_pay, v_employee.commission_total);

    v_entry_count := v_entry_count + 1;
  end loop;

  update public.commission_ledger cl
  set payroll_period_id = v_period_id, status = 'approved'
  from public.jobs j
  where j.id = cl.job_id
    and cl.tenant_id = v_tenant_id
    and cl.payroll_period_id is null
    and cl.status = 'earned'
    and j.completed_at::date between p_start_date and p_end_date
    and cl.employee_id in (select employee_id from public.payroll_entries where payroll_period_id = v_period_id);

  return jsonb_build_object('id', v_period_id, 'status', 'draft', 'entries_created', v_entry_count);
end;
$$;

grant execute on function public.generate_payroll_period(text, date, date) to authenticated;

-- recompute_job_commission()'s other half of the same bug: it only looked up a payroll period
-- via an ALREADY-LINKED job-level ledger row (cl.payroll_period_id is not null for this job).
-- A job that started with zero crew (so complete_job() never wrote a job-level ledger row at
-- all -- the "if v_crew_count > 0" branch never ran) has no such row to find, so even though a
-- payroll period already exists covering that job's date, this function never saw it and left
-- the correction permanently unlinked (payroll_period_id null), where it could only ever be
-- swept up by a payroll run whose date range happened to include the correction's OWN date, not
-- the job's. Now looks up any period covering the job's actual completed_at date instead, and
-- creates the employee's payroll_entries row on the fly if they didn't have one yet (true for
-- an employee who had zero commission -- no crew at all -- when that period was generated).
-- Still refuses outright if that period is already paid (matching the existing top-of-function
-- guard for "this job's own commission was already paid") rather than silently leaving the
-- correction stranded -- same intent as that guard: a paid period's numbers are closed and need
-- a deliberate manual payroll adjustment, not an automatic rewrite.
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

  -- Money already paid out needs a manual payroll adjustment, not an automated rewrite.
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

      -- This employee had no entry in this period at all -- true whenever they had zero
      -- commission (no crew) when the period was generated. Create it now so the adjustment has
      -- somewhere to land.
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

  return jsonb_build_object(
    'job_id', p_job_id, 'rate', v_effective_rate, 'pool', v_job_pool, 'crew_count', v_crew_count,
    'entries_written', v_entries_written, 'bonus_entries_created', v_bonus_count
  );
end;
$$;

grant execute on function public.recompute_job_commission(uuid) to authenticated;
