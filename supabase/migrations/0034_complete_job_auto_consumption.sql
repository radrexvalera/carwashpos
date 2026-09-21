-- Extends complete_job() (Phase 3) to also auto-deduct consumables per the completed service's
-- recipe, in the SAME transaction as commission -- a job never ends up half-paying commission and
-- half-consuming stock. A size-specific recipe row takes precedence over a null-size default for
-- the same (service, item) pair, per service_recipe_items' design.
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
  v_recipe_item record;
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

  for v_js in
    select * from public.job_services
    where job_id = p_job_id and status not in ('completed', 'cancelled')
  loop
    select * into v_rule from public.service_commission_rules
    where tenant_id = v_tenant_id and service_id = v_js.service_id and is_active = true;

    if v_rule.id is null then
      select * into v_rule from public.service_commission_rules
      where tenant_id = v_tenant_id and service_id is null and is_active = true;
    end if;

    if v_rule.id is not null then
      select count(*) into v_attendant_count from public.job_service_attendants where job_service_id = v_js.id;

      if v_attendant_count > 0 then
        v_basis_amount := case when v_rule.basis = 'original_price' then v_js.unit_price * v_js.quantity else v_js.line_total end;

        select coalesce(sum(split_percentage), 0) into v_split_sum
        from public.job_service_attendants where job_service_id = v_js.id and split_percentage is not null;

        if v_rule.commission_type = 'fixed_pool' then
          v_pool := v_rule.rate;
        elsif v_rule.commission_type = 'percentage' then
          v_pool := round(v_basis_amount * v_rule.rate / 100, 2);
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

    -- Auto-consumption: size-specific recipe rows win over the null-size default for the same item.
    for v_recipe_item in
      select sri.item_id, sri.quantity_used
      from public.service_recipe_items sri
      where sri.tenant_id = v_tenant_id and sri.service_id = v_js.service_id
        and (
          sri.vehicle_size_id = v_job.vehicle_size_id
          or (
            sri.vehicle_size_id is null
            and not exists (
              select 1 from public.service_recipe_items sri2
              where sri2.service_id = v_js.service_id
                and sri2.vehicle_size_id = v_job.vehicle_size_id
                and sri2.item_id = sri.item_id
            )
          )
        )
    loop
      perform public.record_inventory_transaction(
        v_recipe_item.item_id, 'service_consumption', -(v_recipe_item.quantity_used * v_js.quantity),
        null, 'job_service', v_js.id, null
      );
    end loop;

    update public.job_services set status = 'completed', completed_at = now() where id = v_js.id;
  end loop;

  update public.jobs set status = 'completed', completed_at = now(), bay_id = null, bay_entered_at = null where id = p_job_id;

  return jsonb_build_object('id', p_job_id, 'status', 'completed', 'commission_entries_created', v_commission_count);
end;
$$;
