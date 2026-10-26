-- A job picked up (completed) but not paid yet (the Unpaid tab) had no way to fix a wrong service
-- before collecting payment -- job_is_editable() blocked ANY completed job regardless of payment
-- status, but the real risk it exists to prevent (the job total and the sale it was billed from
-- falling out of agreement) only applies once a sale actually exists. The "no active sale" clause
-- already covers that; blocking on status alone was unnecessarily broad. 'cancelled' stays blocked
-- -- there's nothing left on a cancelled job to edit.
create or replace function public.job_is_editable(p_job_id uuid, p_tenant_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.jobs
    where id = p_job_id
      and tenant_id = p_tenant_id
      and status != 'cancelled'
  )
  and not exists (
    select 1 from public.sales where job_id = p_job_id and status != 'voided'
  );
$$;

-- update_job_vehicle_size()'s reprice loop excluded already-'completed' job_service lines -- the
-- right call when a job could only be edited before completion, so nothing was ever completed yet.
-- Now that a completed-but-unpaid job is editable too, every one of its lines is already
-- 'completed' (complete_job() sets that), so excluding them meant a resize on a picked-up job
-- silently repriced nothing at all.
create or replace function public.update_job_vehicle_size(p_job_id uuid, p_vehicle_size_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_job record;
  v_js record;
  v_new_price numeric(12, 2);
  v_repriced_count int := 0;
  v_skipped_count int := 0;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_jobs') then
    raise exception 'Not authorized to edit jobs';
  end if;

  select * into v_job from public.jobs where id = p_job_id and tenant_id = v_tenant_id;
  if v_job.id is null then
    raise exception 'Job not found';
  end if;

  if not public.job_is_editable(p_job_id, v_tenant_id) then
    raise exception 'This job can no longer be edited -- it is cancelled or already paid for';
  end if;

  if not exists (select 1 from public.vehicle_sizes where id = p_vehicle_size_id and tenant_id = v_tenant_id) then
    raise exception 'Vehicle size not found';
  end if;

  update public.jobs set vehicle_size_id = p_vehicle_size_id where id = p_job_id;

  for v_js in
    select js.id, js.service_id, js.quantity, js.discount_amount
    from public.job_services js
    join public.services s on s.id = js.service_id
    where js.job_id = p_job_id and js.status != 'cancelled' and s.pricing_type = 'matrix'
  loop
    select price into v_new_price
    from public.service_prices
    where service_id = v_js.service_id and vehicle_size_id = p_vehicle_size_id and is_active = true and tenant_id = v_tenant_id;

    if v_new_price is null then
      -- No price configured for this service at the corrected size -- leave the line at its old
      -- price rather than blocking the whole correction; surfaced in the return count so the UI
      -- can tell staff to fix it manually (e.g. remove and re-add once a price exists).
      v_skipped_count := v_skipped_count + 1;
      continue;
    end if;

    update public.job_services
    set unit_price = v_new_price, line_total = round(v_new_price * v_js.quantity - v_js.discount_amount, 2)
    where id = v_js.id;

    v_repriced_count := v_repriced_count + 1;
  end loop;

  return jsonb_build_object('repriced_count', v_repriced_count, 'skipped_count', v_skipped_count);
end;
$$;

grant execute on function public.update_job_vehicle_size(uuid, uuid) to authenticated;

-- Same wording fix as above -- 'completed' alone no longer blocks an edit, so the message
-- shouldn't say it does.
create or replace function public.add_job_service(
  p_job_id uuid, p_service_id uuid, p_quantity numeric, p_manual_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_job record;
  v_service record;
  v_unit_price numeric(12, 2);
  v_line_total numeric(12, 2);
  v_job_service_id uuid := gen_random_uuid();
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_jobs') then
    raise exception 'Not authorized to edit jobs';
  end if;

  select * into v_job from public.jobs where id = p_job_id and tenant_id = v_tenant_id;
  if v_job.id is null then
    raise exception 'Job not found';
  end if;

  if not public.job_is_editable(p_job_id, v_tenant_id) then
    raise exception 'This job can no longer be edited -- it is cancelled or already paid for';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be positive';
  end if;

  select id, pricing_type, flat_price, is_active into v_service
  from public.services where id = p_service_id and tenant_id = v_tenant_id;

  if v_service.id is null or not v_service.is_active then
    raise exception 'Service not found or inactive';
  end if;

  if v_service.pricing_type = 'matrix' then
    select price into v_unit_price
    from public.service_prices
    where service_id = v_service.id and vehicle_size_id = v_job.vehicle_size_id and is_active = true and tenant_id = v_tenant_id;

    if v_unit_price is null then
      raise exception 'No active price for this service at this job''s vehicle size';
    end if;
  elsif v_service.pricing_type in ('flat', 'starting_at') then
    v_unit_price := v_service.flat_price;
    if v_unit_price is null then
      raise exception 'This service has no flat_price configured';
    end if;
  elsif v_service.pricing_type = 'quoted' then
    v_unit_price := p_manual_price;
    if v_unit_price is null or v_unit_price < 0 then
      raise exception 'This service requires a manual price (quoted pricing)';
    end if;
  else
    raise exception 'Unknown pricing_type for this service';
  end if;

  v_line_total := round(v_unit_price * p_quantity, 2);

  insert into public.job_services (id, tenant_id, job_id, service_id, unit_price, quantity, line_total)
  values (v_job_service_id, v_tenant_id, p_job_id, v_service.id, v_unit_price, p_quantity, v_line_total);

  return jsonb_build_object('id', v_job_service_id, 'unit_price', v_unit_price, 'line_total', v_line_total);
end;
$$;

grant execute on function public.add_job_service(uuid, uuid, numeric, numeric) to authenticated;

create or replace function public.remove_job_service(p_job_service_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_job_service record;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_jobs') then
    raise exception 'Not authorized to edit jobs';
  end if;

  select * into v_job_service from public.job_services where id = p_job_service_id and tenant_id = v_tenant_id;
  if v_job_service.id is null then
    raise exception 'Service line not found';
  end if;

  if not public.job_is_editable(v_job_service.job_id, v_tenant_id) then
    raise exception 'This job can no longer be edited -- it is cancelled or already paid for';
  end if;

  update public.job_services set status = 'cancelled' where id = p_job_service_id;

  return jsonb_build_object('id', p_job_service_id, 'status', 'cancelled');
end;
$$;

grant execute on function public.remove_job_service(uuid) to authenticated;

create or replace function public.update_job_service_quantity(p_job_service_id uuid, p_quantity numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_job_service record;
  v_line_total numeric(12, 2);
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_jobs') then
    raise exception 'Not authorized to edit jobs';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be positive';
  end if;

  select * into v_job_service from public.job_services where id = p_job_service_id and tenant_id = v_tenant_id;
  if v_job_service.id is null then
    raise exception 'Service line not found';
  end if;

  if not public.job_is_editable(v_job_service.job_id, v_tenant_id) then
    raise exception 'This job can no longer be edited -- it is cancelled or already paid for';
  end if;

  v_line_total := round(v_job_service.unit_price * p_quantity - v_job_service.discount_amount, 2);

  update public.job_services set quantity = p_quantity, line_total = v_line_total where id = p_job_service_id;

  return jsonb_build_object('id', p_job_service_id, 'quantity', p_quantity, 'line_total', v_line_total);
end;
$$;

grant execute on function public.update_job_service_quantity(uuid, numeric) to authenticated;
