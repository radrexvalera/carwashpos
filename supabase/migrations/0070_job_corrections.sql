-- Lets staff correct a still-open, not-yet-paid job: add a forgotten service, remove one added by
-- mistake (soft -- marked 'cancelled', same convention job_services already uses, never hard
-- deleted), fix a wrong quantity, or fix a wrong vehicle size (reprices matrix-priced lines against
-- the corrected size; flat/quoted-price lines don't depend on size so they're left alone). All four
-- are blocked once the job is completed/cancelled or already has a non-voided sale against it --
-- past that point the job total and the sale it was billed from must stay in agreement, so a real
-- correction has to go through a void + redo instead.
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
      and status not in ('completed', 'cancelled')
  )
  and not exists (
    select 1 from public.sales where job_id = p_job_id and status != 'voided'
  );
$$;

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
    raise exception 'This job can no longer be edited -- it is completed, cancelled, or already paid for';
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
    raise exception 'This job can no longer be edited -- it is completed, cancelled, or already paid for';
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
    raise exception 'This job can no longer be edited -- it is completed, cancelled, or already paid for';
  end if;

  v_line_total := round(v_job_service.unit_price * p_quantity - v_job_service.discount_amount, 2);

  update public.job_services set quantity = p_quantity, line_total = v_line_total where id = p_job_service_id;

  return jsonb_build_object('id', p_job_service_id, 'quantity', p_quantity, 'line_total', v_line_total);
end;
$$;

grant execute on function public.update_job_service_quantity(uuid, numeric) to authenticated;

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
    raise exception 'This job can no longer be edited -- it is completed, cancelled, or already paid for';
  end if;

  if not exists (select 1 from public.vehicle_sizes where id = p_vehicle_size_id and tenant_id = v_tenant_id) then
    raise exception 'Vehicle size not found';
  end if;

  update public.jobs set vehicle_size_id = p_vehicle_size_id where id = p_job_id;

  for v_js in
    select js.id, js.service_id, js.quantity, js.discount_amount
    from public.job_services js
    join public.services s on s.id = js.service_id
    where js.job_id = p_job_id and js.status not in ('completed', 'cancelled') and s.pricing_type = 'matrix'
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

-- A cancelled line's crew no longer belongs in the summary once the service itself was removed.
create or replace view public.job_board_entries
with (security_invoker = true) as
select
  j.id,
  j.tenant_id,
  j.client_generated_id,
  j.job_number,
  j.status,
  j.bay_id,
  b.name as bay_name,
  j.bay_entered_at,
  j.created_at,
  j.completed_at,
  v.plate_number,
  v.make as vehicle_make,
  v.model as vehicle_model,
  vs.name as vehicle_size_name,
  (
    select coalesce(sum(js.line_total), 0)
    from public.job_services js
    where js.job_id = j.id and js.status != 'cancelled'
  ) as estimated_total,
  (
    select string_agg(
      s.name || case when js.quantity > 1 then ' x' || js.quantity::text else '' end,
      ', ' order by js.created_at
    )
    from public.job_services js
    join public.services s on s.id = js.service_id
    where js.job_id = j.id and js.status != 'cancelled'
  ) as services_summary,
  (
    select string_agg(distinct e.full_name, ', ')
    from public.job_service_attendants jsa
    join public.job_services js on js.id = jsa.job_service_id
    join public.employees e on e.id = jsa.employee_id
    where js.job_id = j.id and js.status != 'cancelled'
  ) as attendants_summary,
  exists (
    select 1 from public.sales s where s.job_id = j.id and s.status != 'voided'
  ) as is_paid
from public.jobs j
join public.vehicles v on v.id = j.vehicle_id
join public.vehicle_sizes vs on vs.id = j.vehicle_size_id
left join public.wash_bays b on b.id = j.bay_id
where j.status != 'cancelled';
