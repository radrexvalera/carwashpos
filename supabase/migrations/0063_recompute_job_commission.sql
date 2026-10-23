-- Lets a manager fix a job's crew assignment AFTER the job is already completed (e.g. forgot to
-- add crew before payment) and correctly recompute its job-level commission as a result --
-- without this, a job completed with no crew assigned simply never generates any commission at
-- all (complete_job()'s job-level pool only fires when crew_count > 0), and there was previously
-- no way to backfill it after the fact.
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
  v_job_total numeric(12, 2);
  v_has_other boolean;
  v_carwash_rate numeric(5, 2);
  v_other_rate numeric(5, 2);
  v_job_rate numeric(5, 2);
  v_job_pool numeric(12, 2);
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

  select coalesce(sum(js.line_total), 0),
    coalesce(bool_or(sc.id is null or not sc.is_carwash), false)
  into v_job_total, v_has_other
  from public.job_services js
  left join public.services s on s.id = js.service_id
  left join public.service_categories sc on sc.id = s.category_id
  where js.job_id = p_job_id and js.status = 'completed';

  select carwash_commission_rate, other_commission_rate into v_carwash_rate, v_other_rate
  from public.settings where tenant_id = v_tenant_id;
  v_carwash_rate := coalesce(v_carwash_rate, 30);
  v_other_rate := coalesce(v_other_rate, 40);
  v_job_rate := case when v_has_other then v_other_rate else v_carwash_rate end;
  v_job_pool := round(v_job_total * v_job_rate / 100, 2);

  select count(distinct jsa.employee_id) into v_crew_count
  from public.job_service_attendants jsa
  join public.job_services js on js.id = jsa.job_service_id
  where js.job_id = p_job_id;

  v_crew_share := case when v_crew_count > 0 then round(v_job_pool / v_crew_count, 2) else 0 end;

  -- The one payroll period (if any) this job's job-level commission was already claimed by, so a
  -- correction's delta rides along with its siblings instead of floating unclaimed.
  select cl.payroll_period_id into v_period_id
  from public.commission_ledger cl
  where cl.job_id = p_job_id and cl.job_service_id is null and cl.service_id is null and cl.payroll_period_id is not null
  limit 1;

  v_period_status := null;
  if v_period_id is not null then
    select status into v_period_status from public.payroll_periods where id = v_period_id;
  end if;

  -- Every employee who currently has job-level commission recorded for this job (so a removed
  -- crew member's existing credit gets zeroed out) unioned with the currently assigned crew (so a
  -- newly added member gets their share).
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

      -- Only ride along with the period if this employee already has an entry in it; otherwise
      -- leave the correction unclaimed for the next payroll generation to pick up naturally.
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
      v_job_total, 'job_percentage', v_job_rate, v_delta,
      v_new_status, v_new_payroll_period_id, v_latest_ledger_id,
      'Crew assignment corrected after job completion', v_created_by
    );

    if v_payroll_entry_id is not null then
      if v_period_status = 'draft' then
        update public.payroll_entries set commission_total = commission_total + v_delta where id = v_payroll_entry_id;
      elsif v_period_status = 'locked' then
        -- Locked payroll entries are frozen (0026's own rule) -- a correction after lock is a
        -- payroll_adjustments row, never a direct edit to the entry.
        insert into public.payroll_adjustments (tenant_id, payroll_entry_id, amount, reason, created_by)
        values (v_tenant_id, v_payroll_entry_id, v_delta, 'Crew assignment corrected after job completion', v_created_by);
      end if;
    end if;

    v_entries_written := v_entries_written + 1;
  end loop;

  return jsonb_build_object(
    'job_id', p_job_id, 'rate', v_job_rate, 'pool', v_job_pool, 'crew_count', v_crew_count, 'entries_written', v_entries_written
  );
end;
$$;

grant execute on function public.recompute_job_commission(uuid) to authenticated;
