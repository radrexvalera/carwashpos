-- Replaces per-service percentage commission rules with one tenant-wide, job-composition-based
-- policy: a job made ONLY of "carwash" services earns carwash_commission_rate; a job that includes
-- any non-carwash service earns other_commission_rate on its ENTIRE revenue (not just the
-- non-carwash line). The pool is split evenly across every distinct crew member assigned anywhere
-- on the job. Non-percentage rule types (fixed_pool/fixed_per_attendant/points) on specific
-- services are untouched -- they still fire per service line, on top of this job-level pool.
alter table public.service_categories add column is_carwash boolean not null default false;

alter table public.settings add column carwash_commission_rate numeric(5, 2) not null default 30 check (carwash_commission_rate >= 0);
alter table public.settings add column other_commission_rate numeric(5, 2) not null default 40 check (other_commission_rate >= 0);

-- A job-level commission row isn't tied to one service line, so these can no longer be required.
alter table public.commission_ledger alter column job_service_id drop not null;
alter table public.commission_ledger alter column service_id drop not null;

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
  v_rule record;
  v_attendant record;
  v_attendant_count int;
  v_basis_amount numeric(12, 2);
  v_pool numeric(12, 2);
  v_split_sum numeric(10, 2);
  v_share numeric(12, 2);
  v_points numeric(10, 2);
  v_commission_count int := 0;
  v_job_service_ids uuid[];
  v_job_total numeric(12, 2);
  v_has_other boolean;
  v_carwash_rate numeric(5, 2);
  v_other_rate numeric(5, 2);
  v_job_rate numeric(5, 2);
  v_job_pool numeric(12, 2);
  v_crew_count int;
  v_crew_share numeric(12, 2);
  v_crew record;
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

  -- Snapshot composition + total revenue across the job's still-open lines before the loop below
  -- starts marking them completed.
  select coalesce(array_agg(js.id), '{}'), coalesce(sum(js.line_total), 0),
    coalesce(bool_or(sc.id is null or not sc.is_carwash), false)
  into v_job_service_ids, v_job_total, v_has_other
  from public.job_services js
  left join public.services s on s.id = js.service_id
  left join public.service_categories sc on sc.id = s.category_id
  where js.job_id = p_job_id and js.status not in ('completed', 'cancelled');

  for v_js in
    select * from public.job_services
    where job_id = p_job_id and status not in ('completed', 'cancelled')
  loop
    -- Service-specific rule first, else the tenant-wide default (service_id is null), else no
    -- per-line commission -- 'percentage' rules are skipped entirely, superseded by the job-level
    -- carwash/other pool computed below. fixed_pool/fixed_per_attendant/points still fire as before.
    select * into v_rule from public.service_commission_rules
    where tenant_id = v_tenant_id and service_id = v_js.service_id and is_active = true;

    if v_rule.id is null then
      select * into v_rule from public.service_commission_rules
      where tenant_id = v_tenant_id and service_id is null and is_active = true;
    end if;

    if v_rule.id is not null and v_rule.commission_type != 'percentage' then
      select count(*) into v_attendant_count from public.job_service_attendants where job_service_id = v_js.id;

      if v_attendant_count > 0 then
        v_basis_amount := case when v_rule.basis = 'original_price' then v_js.unit_price * v_js.quantity else v_js.line_total end;

        select coalesce(sum(split_percentage), 0) into v_split_sum
        from public.job_service_attendants where job_service_id = v_js.id and split_percentage is not null;

        if v_rule.commission_type = 'fixed_pool' then
          v_pool := v_rule.rate;
        end if;

        for v_attendant in select * from public.job_service_attendants where job_service_id = v_js.id
        loop
          v_points := null;

          if v_rule.commission_type = 'fixed_per_attendant' then
            v_share := v_rule.rate;
          elsif v_rule.commission_type = 'points' then
            v_share := 0;
            v_points := v_rule.rate;
          elsif v_split_sum = 100 then
            -- Custom split / role-based (spec methods D/E): explicit per-attendant percentages
            -- assigned at crew-assignment time override an even division of the pool.
            v_share := round(v_pool * coalesce(v_attendant.split_percentage, 0) / 100, 2);
          else
            v_share := round(v_pool / v_attendant_count, 2);
          end if;

          insert into public.commission_ledger (
            tenant_id, employee_id, job_id, job_service_id, service_id,
            gross_service_amount, commission_type, commission_rate, commission_amount, points,
            created_by
          ) values (
            v_tenant_id, v_attendant.employee_id, p_job_id, v_js.id, v_js.service_id,
            v_basis_amount, v_rule.commission_type, v_rule.rate, v_share, v_points,
            v_created_by
          );

          v_commission_count := v_commission_count + 1;
        end loop;
      end if;
    end if;

    update public.job_services set status = 'completed', completed_at = now() where id = v_js.id;
  end loop;

  if array_length(v_job_service_ids, 1) > 0 and v_job_total > 0 then
    v_job_rate := case when v_has_other then v_other_rate else v_carwash_rate end;
    v_job_pool := round(v_job_total * v_job_rate / 100, 2);

    select count(distinct employee_id) into v_crew_count
    from public.job_service_attendants where job_service_id = any(v_job_service_ids);

    if v_crew_count > 0 and v_job_pool > 0 then
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
          v_job_total, 'job_percentage', v_job_rate, v_crew_share, null,
          v_created_by
        );

        v_commission_count := v_commission_count + 1;
      end loop;
    end if;
  end if;

  update public.jobs set status = 'completed', completed_at = now(), bay_id = null, bay_entered_at = null where id = p_job_id;

  return jsonb_build_object('id', p_job_id, 'status', 'completed', 'commission_entries_created', v_commission_count);
end;
$$;

grant execute on function public.complete_job(uuid) to authenticated;
