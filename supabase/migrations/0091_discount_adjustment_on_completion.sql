-- Bug: apply_discount_commission_adjustment() (0090) was only called from create_sale(). That's
-- fine when a job is completed ("Picked up") BEFORE it's billed ("Collect Payment") -- the
-- adjustment finds the commission already posted and corrects it. But for this business, the
-- real-world order is the opposite in practice: payment is collected first, completion happens
-- later (seconds to hours later, confirmed against real Test123 data -- every sampled discounted
-- job had sale_created_at before completed_at). When create_sale() ran, complete_job() hadn't
-- posted anything yet, so there was nothing to adjust -- the call silently found zero ledger rows
-- and did nothing, and nothing ever ran it again afterward.
--
-- apply_card_fee_commission_adjustment() already avoided this exact trap by being called from
-- BOTH create_sale() and complete_job() -- whichever runs second is the one that actually finds
-- something to correct. This migration gives apply_discount_commission_adjustment() the same
-- second call site. Both functions are already idempotent per job (checked via their own
-- adjustment_reason marker), so calling from both sites is safe regardless of ordering.
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

  -- Discount first, then the card fee -- same ordering/reasoning as create_sale()'s own pair of
  -- calls (0090): the fee is assessed on the already-discounted amount, so it should compound on
  -- top of the discount correction, not the other way around.
  perform public.apply_discount_commission_adjustment(v_tenant_id, p_job_id, v_created_by);
  perform public.apply_card_fee_commission_adjustment(v_tenant_id, p_job_id, v_created_by);

  return jsonb_build_object('id', p_job_id, 'status', 'completed', 'commission_entries_created', v_commission_count);
end;
$$;

grant execute on function public.complete_job(uuid) to authenticated;
