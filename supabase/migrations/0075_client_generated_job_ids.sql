-- Lets a job (and its service lines) be paid for offline immediately after being created offline
-- -- previously impossible, since job_services only ever got real ids once create_job() actually
-- ran server-side, so a payment queued before that synced had nothing to reference.
--
-- The fix: the client already generates a stable client_generated_id for the job itself (used for
-- idempotent resubmission); this now ALSO becomes the job's real id (jobs.id), honored here
-- instead of always calling gen_random_uuid(). Each service line gets the same treatment -- the
-- client can supply its own id per line, used as job_services.id directly. Both fall back to
-- gen_random_uuid() when not supplied, so this is backward compatible with any caller that
-- doesn't send one.
--
-- With job ids and job_service ids known deterministically the moment a job is created (synced or
-- not), create_sale() can be queued referencing them immediately -- no "wait for the job to sync,
-- then go back and patch in the real id" indirection needed. The only remaining requirement is
-- ordering: the job_create mutation must actually reach the server before its job_payment, which
-- the offline queue already guarantees by processing mutations in creation order.
create or replace function public.create_job(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_created_by uuid := auth.uid();
  v_location_id uuid;
  v_client_generated_id uuid := (payload ->> 'client_generated_id')::uuid;
  v_existing_job_id uuid;
  v_job_id uuid := coalesce((payload ->> 'job_id')::uuid, gen_random_uuid());
  v_job_number text;
  v_vehicle_id uuid := (payload ->> 'vehicle_id')::uuid;
  v_vehicle_size_id uuid := (payload ->> 'vehicle_size_id')::uuid;
  v_service jsonb;
  v_service_row record;
  v_unit_price numeric(12, 2);
  v_quantity numeric(10, 2);
  v_line_total numeric(12, 2);
  v_job_service_id uuid;
  v_attendant jsonb;
  v_seq int;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_jobs') then
    raise exception 'Not authorized to create jobs';
  end if;

  if public.tenant_trial_expired() then
    raise exception 'Your free trial has ended. Please contact us to continue.';
  end if;

  if v_client_generated_id is null or v_vehicle_id is null or v_vehicle_size_id is null then
    raise exception 'client_generated_id, vehicle_id, and vehicle_size_id are required';
  end if;

  select id into v_existing_job_id from public.jobs
  where tenant_id = v_tenant_id and client_generated_id = v_client_generated_id;

  if v_existing_job_id is not null then
    return (
      select jsonb_build_object('id', j.id, 'job_number', j.job_number, 'status', j.status, 'created_at', j.created_at)
      from public.jobs j where j.id = v_existing_job_id
    );
  end if;

  if not exists (select 1 from public.vehicles where id = v_vehicle_id and tenant_id = v_tenant_id) then
    raise exception 'Vehicle % not found for this tenant', v_vehicle_id;
  end if;

  select id into v_location_id from public.locations where tenant_id = v_tenant_id limit 1;
  if v_location_id is null then
    raise exception 'Tenant has no location configured';
  end if;

  if jsonb_array_length(coalesce(payload -> 'services', '[]'::jsonb)) = 0 then
    raise exception 'A job needs at least one service';
  end if;

  insert into public.tenant_job_counters (tenant_id, job_date, next_number)
  values (v_tenant_id, current_date, 2)
  on conflict (tenant_id, job_date) do update set next_number = tenant_job_counters.next_number + 1
  returning next_number - 1 into v_seq;

  v_job_number := 'JOB-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0');

  insert into public.jobs (id, tenant_id, location_id, client_generated_id, job_number, vehicle_id, vehicle_size_id, status, created_by)
  values (v_job_id, v_tenant_id, v_location_id, v_client_generated_id, v_job_number, v_vehicle_id, v_vehicle_size_id, 'waiting', v_created_by);

  insert into public.job_status_history (tenant_id, job_id, from_status, to_status, changed_by)
  values (v_tenant_id, v_job_id, null, 'waiting', v_created_by);

  for v_service in select * from jsonb_array_elements(payload -> 'services')
  loop
    select id, pricing_type, flat_price, is_active into v_service_row
    from public.services
    where id = (v_service ->> 'service_id')::uuid and tenant_id = v_tenant_id;

    if v_service_row.id is null or not v_service_row.is_active then
      raise exception 'Service % not found or inactive', v_service ->> 'service_id';
    end if;

    v_quantity := coalesce((v_service ->> 'quantity')::numeric, 1);
    if v_quantity <= 0 then
      raise exception 'Service quantity must be positive';
    end if;

    if v_service_row.pricing_type = 'matrix' then
      select price into v_unit_price
      from public.service_prices
      where service_id = v_service_row.id and vehicle_size_id = v_vehicle_size_id and is_active = true and tenant_id = v_tenant_id;

      if v_unit_price is null then
        raise exception 'No active price for service % at this vehicle size', v_service_row.id;
      end if;
    elsif v_service_row.pricing_type in ('flat', 'starting_at') then
      v_unit_price := v_service_row.flat_price;
      if v_unit_price is null then
        raise exception 'Service % has no flat_price configured', v_service_row.id;
      end if;
    elsif v_service_row.pricing_type = 'quoted' then
      v_unit_price := (v_service ->> 'manual_price')::numeric;
      if v_unit_price is null or v_unit_price < 0 then
        raise exception 'Service % requires a manual_price (quoted pricing)', v_service_row.id;
      end if;
    else
      raise exception 'Unknown pricing_type for service %', v_service_row.id;
    end if;

    v_line_total := round(v_unit_price * v_quantity, 2);
    v_job_service_id := coalesce((v_service ->> 'id')::uuid, gen_random_uuid());

    insert into public.job_services (id, tenant_id, job_id, service_id, unit_price, quantity, line_total)
    values (v_job_service_id, v_tenant_id, v_job_id, v_service_row.id, v_unit_price, v_quantity, v_line_total);

    for v_attendant in select * from jsonb_array_elements(coalesce(v_service -> 'attendant_employee_ids', '[]'::jsonb))
    loop
      insert into public.job_service_attendants (tenant_id, job_service_id, employee_id)
      values (v_tenant_id, v_job_service_id, (v_attendant #>> '{}')::uuid);
    end loop;
  end loop;

  return jsonb_build_object('id', v_job_id, 'job_number', v_job_number, 'status', 'waiting', 'created_at', now());
end;
$$;
