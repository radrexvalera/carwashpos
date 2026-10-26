-- Flexible commission, replacing the "whole job earns one blended rate based on composition"
-- model (0060) with a per-service one: Wash services always earn the fixed carwash rate; any other
-- service earns its own active percentage override if it has one, else the tenant-wide "other"
-- rate -- each computed off its OWN line revenue, then summed into one combined pool. Per the
-- owner's own workflow (crew is assigned once for the whole job and works every service on it
-- together, never split per line), that combined pool is still split evenly across the same shared
-- crew roster as before -- only how the pool itself is computed has changed, not how it's divided.
--
-- Also adds a new 'fixed_pool_by_size' commission type: a flat peso amount per vehicle size for one
-- service (built for PPF, but not hardcoded to it -- any service can use it). A line using this type
-- is commissioned ONLY by that fixed amount, excluded from the percentage pool above so it's never
-- double-counted.
create table public.service_commission_sizes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  vehicle_size_id uuid not null references public.vehicle_sizes(id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, service_id, vehicle_size_id)
);
create index service_commission_sizes_tenant_id_idx on public.service_commission_sizes(tenant_id);
create index service_commission_sizes_service_id_idx on public.service_commission_sizes(service_id);

alter table public.service_commission_sizes enable row level security;

create policy service_commission_sizes_select on public.service_commission_sizes
  for select using (tenant_id = public.current_tenant_id());

create policy service_commission_sizes_insert on public.service_commission_sizes
  for insert with check (
    tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog')
    and exists (select 1 from public.services s where s.id = service_id and s.tenant_id = public.current_tenant_id())
    and exists (select 1 from public.vehicle_sizes vs where vs.id = vehicle_size_id and vs.tenant_id = public.current_tenant_id())
  );

create policy service_commission_sizes_update on public.service_commission_sizes
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'));

create policy service_commission_sizes_delete on public.service_commission_sizes
  for delete using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'));

alter table public.service_commission_rules drop constraint service_commission_rules_commission_type_check;
alter table public.service_commission_rules add constraint service_commission_rules_commission_type_check
  check (commission_type in ('fixed_pool', 'percentage', 'fixed_per_attendant', 'points', 'fixed_pool_by_size'));

-- Pure lookup: Wash is always the fixed carwash rate; anything else uses its own active percentage
-- rule if one exists (that's the "or varies" part), else the tenant-wide other rate. The tenant-wide
-- DEFAULT rule row (service_id is null) is deliberately not consulted here for 'percentage' -- that
-- row predates this feature and settings.other_commission_rate is the one canonical "other" default
-- now, so as not to have two competing defaults.
create or replace function public.resolve_service_commission_rate(
  p_tenant_id uuid, p_service_id uuid, p_is_carwash boolean, p_carwash_rate numeric, p_other_rate numeric
)
returns numeric
language sql
security definer
stable
set search_path = public
as $$
  select case
    when p_is_carwash then p_carwash_rate
    else coalesce(
      (select rate from public.service_commission_rules
       where tenant_id = p_tenant_id and service_id = p_service_id and commission_type = 'percentage' and is_active = true),
      p_other_rate
    )
  end;
$$;

create or replace function public.job_service_uses_fixed_by_size(p_tenant_id uuid, p_service_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.service_commission_rules
    where tenant_id = p_tenant_id and service_id = p_service_id
      and commission_type = 'fixed_pool_by_size' and is_active = true
  );
$$;

-- The per-service bonus loop that used to live inline inside complete_job() -- extracted so
-- recompute_job_commission() can run the exact same logic for a line that never went through
-- complete_job() at all (one added to the job after it was already completed, via the Unpaid-tab
-- edit path). Returns how many ledger rows it wrote, so callers can fold that into their own count.
-- Internal only (no grant to authenticated) -- same treatment as record_inventory_transaction
-- (0051): called via `perform`/direct call from complete_job()/recompute_job_commission(), which
-- already run as the elevated function owner.
create or replace function public.apply_job_service_bonus_commission(
  p_tenant_id uuid, p_job_id uuid, p_job_service_id uuid, p_service_id uuid,
  p_unit_price numeric, p_quantity numeric, p_line_total numeric,
  p_vehicle_size_id uuid, p_created_by uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule record;
  v_attendant record;
  v_attendant_count int;
  v_basis_amount numeric(12, 2);
  v_pool numeric(12, 2);
  v_split_sum numeric(10, 2);
  v_share numeric(12, 2);
  v_points numeric(10, 2);
  v_count int := 0;
  v_size_amount numeric(12, 2);
begin
  select * into v_rule from public.service_commission_rules
  where tenant_id = p_tenant_id and service_id = p_service_id and is_active = true;

  if v_rule.id is null then
    select * into v_rule from public.service_commission_rules
    where tenant_id = p_tenant_id and service_id is null and is_active = true;
  end if;

  if v_rule.id is null or v_rule.commission_type = 'percentage' then
    return 0;
  end if;

  select count(*) into v_attendant_count from public.job_service_attendants where job_service_id = p_job_service_id;
  if v_attendant_count = 0 then
    return 0;
  end if;

  v_basis_amount := case when v_rule.basis = 'original_price' then p_unit_price * p_quantity else p_line_total end;

  if v_rule.commission_type = 'fixed_pool' then
    v_pool := v_rule.rate;
  elsif v_rule.commission_type = 'fixed_pool_by_size' then
    select amount into v_size_amount from public.service_commission_sizes
    where tenant_id = p_tenant_id and service_id = p_service_id and vehicle_size_id = p_vehicle_size_id and is_active = true;

    if v_size_amount is null then
      -- No amount configured for this vehicle size -- nothing to pay out rather than blocking the
      -- job, same "skip rather than block" precedent as update_job_vehicle_size()'s missing-price
      -- case.
      return 0;
    end if;

    v_pool := v_size_amount;
  end if;

  select coalesce(sum(split_percentage), 0) into v_split_sum
  from public.job_service_attendants where job_service_id = p_job_service_id and split_percentage is not null;

  for v_attendant in select * from public.job_service_attendants where job_service_id = p_job_service_id
  loop
    v_points := null;

    if v_rule.commission_type = 'fixed_per_attendant' then
      v_share := v_rule.rate;
    elsif v_rule.commission_type = 'points' then
      v_share := 0;
      v_points := v_rule.rate;
    elsif v_split_sum = 100 then
      v_share := round(v_pool * coalesce(v_attendant.split_percentage, 0) / 100, 2);
    else
      v_share := round(v_pool / v_attendant_count, 2);
    end if;

    insert into public.commission_ledger (
      tenant_id, employee_id, job_id, job_service_id, service_id,
      gross_service_amount, commission_type, commission_rate, commission_amount, points,
      created_by
    ) values (
      p_tenant_id, v_attendant.employee_id, p_job_id, p_job_service_id, p_service_id,
      v_basis_amount, v_rule.commission_type, v_rule.rate, v_share, v_points,
      p_created_by
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
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

  select carwash_commission_rate, other_commission_rate into v_carwash_rate, v_other_rate
  from public.settings where tenant_id = v_tenant_id;
  v_carwash_rate := coalesce(v_carwash_rate, 30);
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

  select carwash_commission_rate, other_commission_rate into v_carwash_rate, v_other_rate
  from public.settings where tenant_id = v_tenant_id;
  v_carwash_rate := coalesce(v_carwash_rate, 30);
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
