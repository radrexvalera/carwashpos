-- Self-serve 14-day trial signup. Previously tenant provisioning was explicitly operator-only
-- (see 0001_init_schema.sql's own header comment) -- seed_new_tenant_defaults() already seeds a
-- new tenant's locations/vehicle_sizes/settings/roles/role_permissions on `tenants` insert, but
-- nothing has ever created the first admin PERSON (user_profiles + employees + employee_roles).
-- That's the missing piece wired up here, triggered off auth.users so a public marketing site can
-- call supabase.auth.signUp() directly (safe with the anon key) with no Edge Function or
-- service-role key exposure needed.

alter table public.tenants add column trial_ends_at timestamptz;

create or replace function public.handle_new_user_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_name text := new.raw_user_meta_data ->> 'business_name';
  v_full_name text := coalesce(new.raw_user_meta_data ->> 'full_name', v_business_name);
  v_tenant_id uuid;
  v_slug text;
  v_employee_id uuid;
  v_admin_role_id uuid;
begin
  -- Only a signup-driven auth user carries business_name in its metadata -- an auth user created
  -- some other way (e.g. a future staff-invite flow) should not spawn a new tenant.
  if v_business_name is null or trim(v_business_name) = '' then
    return new;
  end if;

  v_slug := lower(regexp_replace(trim(v_business_name), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(new.id::text, 1, 8);

  insert into public.tenants (name, slug, trial_ends_at)
  values (trim(v_business_name), v_slug, now() + interval '14 days')
  returning id into v_tenant_id;
  -- Fires the existing tenants_seed_defaults trigger: locations, vehicle_sizes, settings, roles,
  -- role_permissions are all seeded automatically from here.

  insert into public.user_profiles (id, tenant_id, role, full_name)
  values (new.id, v_tenant_id, 'admin', v_full_name);

  insert into public.employees (tenant_id, user_id, full_name, active)
  values (v_tenant_id, new.id, v_full_name, true)
  returning id into v_employee_id;

  select id into v_admin_role_id from public.roles where tenant_id = v_tenant_id and key = 'admin';
  insert into public.employee_roles (employee_id, role_id) values (v_employee_id, v_admin_role_id);

  return new;
end;
$$;

create trigger on_auth_user_created_provision_tenant
  after insert on auth.users
  for each row execute function public.handle_new_user_signup();

-- Soft-lock gate: true once a trial tenant's window has passed. A tenant with no trial_ends_at
-- (every tenant created before this feature, or one an operator has manually cleared to convert a
-- trial into a real account) is never gated -- no billing integration exists yet, so "converting"
-- a trial today is a manual, sales-assisted action, not an automated one.
create or replace function public.tenant_trial_expired()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.tenants
    where id = public.current_tenant_id()
      and trial_ends_at is not null
      and trial_ends_at < now()
  );
$$;

-- The three RPCs below are reproduced verbatim from their current live definitions (confirmed via
-- pg_get_functiondef immediately before writing this migration) with exactly one addition each: a
-- trial-expired guard near the top. This is deliberately NOT applied to every other RLS
-- policy/RPC in the schema -- gating the handful of RPCs that create new business value (a job, a
-- sale, marking a job picked up) is the meaningful soft-lock enforcement point for a v1 trial gate;
-- every other screen (admin CRUD, reports, etc.) stays read-accessible, matching the "read-only,
-- not blocked outright" behavior confirmed with the user.

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
  v_job_id uuid := gen_random_uuid();
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
    v_job_service_id := gen_random_uuid();

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

  if public.tenant_trial_expired() then
    raise exception 'Your free trial has ended. Please contact us to continue.';
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

create or replace function public.create_sale(payload jsonb)
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
  v_existing_sale_id uuid;
  v_sale_id uuid := gen_random_uuid();
  v_sale_number text;
  v_shift_id uuid := (payload ->> 'shift_id')::uuid;
  v_job_id uuid := nullif(payload ->> 'job_id', '')::uuid;
  v_subtotal numeric(12, 2) := 0;
  v_discount_total numeric(12, 2) := 0;
  v_total numeric(12, 2);
  v_payments_sum numeric(12, 2) := 0;
  v_line jsonb;
  v_payment jsonb;
  v_description text;
  v_unit_price numeric(12, 2);
  v_quantity numeric(10, 2);
  v_discount numeric(12, 2);
  v_line_total numeric(12, 2);
  v_line_service_id uuid;
  v_enriched_lines jsonb := '[]'::jsonb;
  v_seq int;
  v_job_service record;
  v_item record;
  v_customer_id uuid;
  v_promotion_id uuid := nullif(payload ->> 'promotion_id', '')::uuid;
  v_promotion record;
  v_promotion_has_restriction boolean;
  v_eligible_base numeric(12, 2);
  v_promotion_discount numeric(12, 2) := 0;
  v_loyalty_points_redeemed int := coalesce((payload ->> 'loyalty_points_redeemed')::int, 0);
  v_loyalty_balance int;
  v_loyalty_discount numeric(12, 2) := 0;
  v_loyalty_earn_rate numeric(6, 4);
  v_loyalty_redemption_value numeric(6, 4);
  v_max_redeemable_points int;
  v_remaining_after_promotion numeric(12, 2);
  v_points_earned int := 0;
  v_billing_type text := coalesce(payload ->> 'billing_type', 'immediate');
  v_fleet_account record;
  v_fleet_outstanding numeric(12, 2);
  v_payment_status text := 'paid';
  v_membership_program_id uuid := nullif(payload #>> '{membership_redemption,program_id}', '')::uuid;
  v_membership_job_service_id uuid := nullif(payload #>> '{membership_redemption,job_service_id}', '')::uuid;
  v_membership_program record;
  v_membership_discount numeric(12, 2) := 0;
  v_stamp_balance int;
  v_earn_program record;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_shift') then
    raise exception 'Not authorized to record a sale';
  end if;

  if public.tenant_trial_expired() then
    raise exception 'Your free trial has ended. Please contact us to continue.';
  end if;

  if v_client_generated_id is null or v_shift_id is null then
    raise exception 'client_generated_id and shift_id are required';
  end if;

  if v_loyalty_points_redeemed < 0 then
    raise exception 'loyalty_points_redeemed cannot be negative';
  end if;

  if v_billing_type not in ('immediate', 'on_account') then
    raise exception 'Unknown billing_type %', v_billing_type;
  end if;

  if v_membership_program_id is not null and v_membership_job_service_id is null then
    raise exception 'membership_redemption requires job_service_id';
  end if;

  select id into v_existing_sale_id from public.sales
  where tenant_id = v_tenant_id and client_generated_id = v_client_generated_id;

  if v_existing_sale_id is not null then
    return (
      select jsonb_build_object(
        'id', s.id, 'sale_number', s.sale_number, 'status', s.status, 'total', s.total, 'created_at', s.created_at,
        'promotion_discount_amount', s.promotion_discount_amount, 'loyalty_discount_amount', s.loyalty_discount_amount,
        'loyalty_points_redeemed', s.loyalty_points_redeemed, 'billing_type', s.billing_type, 'payment_status', s.payment_status,
        'membership_discount_amount', s.membership_discount_amount
      )
      from public.sales s where s.id = v_existing_sale_id
    );
  end if;

  if not exists (select 1 from public.cashier_shifts where id = v_shift_id and tenant_id = v_tenant_id and status = 'open') then
    raise exception 'Shift % is not open', v_shift_id;
  end if;

  if v_job_id is not null and not exists (select 1 from public.jobs where id = v_job_id and tenant_id = v_tenant_id) then
    raise exception 'Job % not found', v_job_id;
  end if;

  select id into v_location_id from public.locations where tenant_id = v_tenant_id limit 1;

  select loyalty_earn_rate, loyalty_redemption_value into v_loyalty_earn_rate, v_loyalty_redemption_value
  from public.settings where tenant_id = v_tenant_id;

  if jsonb_array_length(coalesce(payload -> 'line_items', '[]'::jsonb)) = 0 then
    raise exception 'A sale needs at least one line item';
  end if;

  for v_line in select * from jsonb_array_elements(payload -> 'line_items')
  loop
    v_discount := coalesce((v_line ->> 'discount_amount')::numeric, 0);
    if v_discount < 0 then
      raise exception 'discount_amount cannot be negative';
    end if;

    if v_line ->> 'line_type' = 'job_service' then
      select js.id, js.unit_price, js.quantity, js.line_total, js.service_id, s.name as service_name
      into v_job_service
      from public.job_services js
      join public.services s on s.id = js.service_id
      where js.id = (v_line ->> 'job_service_id')::uuid and js.tenant_id = v_tenant_id;

      if v_job_service.id is null then
        raise exception 'job_service % not found', v_line ->> 'job_service_id';
      end if;

      if exists (
        select 1 from public.sale_items si join public.sales s on s.id = si.sale_id
        where si.job_service_id = v_job_service.id and s.status != 'voided'
      ) then
        raise exception 'job_service % has already been billed on another sale', v_job_service.id;
      end if;

      v_description := v_job_service.service_name;
      v_unit_price := v_job_service.unit_price;
      v_quantity := v_job_service.quantity;
      v_line_total := round(v_job_service.line_total - v_discount, 2);
      v_line_service_id := v_job_service.service_id;
    elsif v_line ->> 'line_type' = 'product' then
      select id, name, retail_price into v_item
      from public.inventory_items
      where id = (v_line ->> 'product_id')::uuid and tenant_id = v_tenant_id and is_active = true and item_type = 'retail';

      if v_item.id is null then
        raise exception 'No active retail item %', v_line ->> 'product_id';
      end if;
      if v_item.retail_price is null then
        raise exception 'Retail item % has no retail_price set', v_item.id;
      end if;

      v_quantity := coalesce((v_line ->> 'quantity')::numeric, 1);
      if v_quantity <= 0 then
        raise exception 'Product quantity must be positive';
      end if;

      v_description := v_item.name;
      v_unit_price := v_item.retail_price;
      v_line_total := round(v_unit_price * v_quantity - v_discount, 2);
      v_line_service_id := null;
    else
      raise exception 'Unknown line_type %', v_line ->> 'line_type';
    end if;

    v_subtotal := v_subtotal + (v_unit_price * v_quantity);
    v_discount_total := v_discount_total + v_discount;

    v_enriched_lines := v_enriched_lines || jsonb_build_array(
      v_line || jsonb_build_object(
        'description', v_description, 'unit_price', v_unit_price, 'quantity', v_quantity,
        'discount_amount', v_discount, 'line_total', v_line_total, 'service_id', v_line_service_id
      )
    );
  end loop;

  if v_job_id is not null then
    select ve.customer_id into v_customer_id
    from public.jobs j join public.vehicles ve on ve.id = j.vehicle_id
    where j.id = v_job_id;
  end if;

  if v_promotion_id is not null then
    select * into v_promotion from public.promotions
    where id = v_promotion_id and tenant_id = v_tenant_id and is_active = true;

    if v_promotion.id is null then
      raise exception 'Promotion not found or inactive';
    end if;

    if not (
      (v_promotion.starts_at is null or v_promotion.starts_at <= current_date)
      and (v_promotion.ends_at is null or v_promotion.ends_at >= current_date)
    ) then
      raise exception 'Promotion "%" is not active for today''s date', v_promotion.name;
    end if;

    v_promotion_has_restriction := exists (
      select 1 from public.promotion_services where promotion_id = v_promotion_id
    );

    select coalesce(sum((line ->> 'line_total')::numeric), 0) into v_eligible_base
    from jsonb_array_elements(v_enriched_lines) as line
    where not v_promotion_has_restriction
      or (
        line ->> 'line_type' = 'job_service'
        and exists (
          select 1 from public.promotion_services ps
          where ps.promotion_id = v_promotion_id and ps.service_id = (line ->> 'service_id')::uuid
        )
      );

    if v_promotion.min_spend is not null and v_eligible_base < v_promotion.min_spend then
      raise exception 'Sale does not meet the minimum spend of % for this promotion', v_promotion.min_spend;
    end if;

    if v_promotion.discount_type = 'percentage' then
      v_promotion_discount := round(v_eligible_base * v_promotion.discount_value / 100, 2);
    else
      v_promotion_discount := least(v_promotion.discount_value, v_eligible_base);
    end if;
  end if;

  if v_loyalty_points_redeemed > 0 then
    if v_customer_id is null then
      raise exception 'No customer on this sale to redeem loyalty points for';
    end if;

    select coalesce(balance, 0) into v_loyalty_balance
    from public.loyalty_balances where customer_id = v_customer_id and tenant_id = v_tenant_id;

    if coalesce(v_loyalty_balance, 0) < v_loyalty_points_redeemed then
      raise exception 'Customer only has % loyalty points available', coalesce(v_loyalty_balance, 0);
    end if;

    v_remaining_after_promotion := round(v_subtotal - v_discount_total - v_promotion_discount, 2);

    if v_loyalty_redemption_value <= 0 then
      v_loyalty_points_redeemed := 0;
    else
      v_max_redeemable_points := floor(v_remaining_after_promotion / v_loyalty_redemption_value);
      if v_loyalty_points_redeemed > v_max_redeemable_points then
        v_loyalty_points_redeemed := greatest(v_max_redeemable_points, 0);
      end if;
      v_loyalty_discount := round(v_loyalty_points_redeemed * v_loyalty_redemption_value, 2);
    end if;
  end if;

  if v_membership_program_id is not null then
    if not exists (
      select 1 from jsonb_array_elements(v_enriched_lines) as line
      where line ->> 'line_type' = 'job_service' and (line ->> 'job_service_id')::uuid = v_membership_job_service_id
    ) then
      raise exception 'membership_redemption job_service_id is not part of this sale';
    end if;

    select * into v_membership_program from public.membership_programs
    where id = v_membership_program_id and tenant_id = v_tenant_id and is_active = true;

    if v_membership_program.id is null then
      raise exception 'Membership program not found or inactive';
    end if;

    if not exists (
      select 1 from jsonb_array_elements(v_enriched_lines) as line
      join public.membership_program_services mps
        on mps.program_id = v_membership_program_id and mps.service_id = (line ->> 'service_id')::uuid
      where (line ->> 'job_service_id')::uuid = v_membership_job_service_id
    ) then
      raise exception 'This service is not covered by the selected membership program';
    end if;

    if v_customer_id is null then
      raise exception 'No customer on this sale to redeem a membership stamp for';
    end if;

    select coalesce(stamps, 0) into v_stamp_balance
    from public.membership_stamp_balances
    where customer_id = v_customer_id and program_id = v_membership_program_id and tenant_id = v_tenant_id;

    if coalesce(v_stamp_balance, 0) < v_membership_program.stamps_required then
      raise exception 'Customer only has % of % stamps required for this program', coalesce(v_stamp_balance, 0), v_membership_program.stamps_required;
    end if;

    select (line ->> 'line_total')::numeric into v_membership_discount
    from jsonb_array_elements(v_enriched_lines) as line
    where (line ->> 'job_service_id')::uuid = v_membership_job_service_id;
  end if;

  v_total := round(v_subtotal - v_discount_total - v_promotion_discount - v_loyalty_discount - v_membership_discount, 2);
  if v_total < 0 then
    v_total := 0;
  end if;

  for v_payment in select * from jsonb_array_elements(coalesce(payload -> 'payments', '[]'::jsonb))
  loop
    v_payments_sum := v_payments_sum + (v_payment ->> 'amount')::numeric;
  end loop;

  if v_billing_type = 'on_account' then
    if v_customer_id is null then
      raise exception 'No customer on this sale to bill to a fleet account';
    end if;

    select * into v_fleet_account from public.fleet_accounts
    where customer_id = v_customer_id and tenant_id = v_tenant_id and is_active = true;

    if v_fleet_account.id is null then
      raise exception 'This customer has no active fleet account';
    end if;

    if v_payments_sum > v_total + 0.01 then
      raise exception 'Payments (%) cannot exceed the sale total (%)', v_payments_sum, v_total;
    end if;

    if v_fleet_account.credit_limit is not null then
      select coalesce(sum(outstanding_balance), 0) into v_fleet_outstanding
      from public.fleet_account_balances where fleet_account_id = v_fleet_account.id;

      if coalesce(v_fleet_outstanding, 0) + (v_total - v_payments_sum) > v_fleet_account.credit_limit then
        raise exception 'This sale would exceed the fleet account''s credit limit of % (currently owes %)',
          v_fleet_account.credit_limit, coalesce(v_fleet_outstanding, 0);
      end if;
    end if;

    v_payment_status := case
      when v_payments_sum >= v_total - 0.01 then 'paid'
      when v_payments_sum > 0 then 'partial'
      else 'unpaid'
    end;
  else
    if abs(v_payments_sum - v_total) > 0.01 then
      raise exception 'Payments (%) do not cover the sale total (%)', v_payments_sum, v_total;
    end if;
    v_payment_status := 'paid';
  end if;

  insert into public.tenant_sale_counters (tenant_id, sale_date, next_number)
  values (v_tenant_id, current_date, 2)
  on conflict (tenant_id, sale_date) do update set next_number = tenant_sale_counters.next_number + 1
  returning next_number - 1 into v_seq;

  v_sale_number := 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0');

  insert into public.sales (
    id, tenant_id, location_id, client_generated_id, sale_number, job_id, shift_id,
    subtotal, discount_total, tax_total, total, created_by,
    customer_id, promotion_id, promotion_discount_amount, loyalty_points_redeemed, loyalty_discount_amount,
    billing_type, payment_status, membership_program_id, membership_redeemed_job_service_id, membership_discount_amount
  )
  values (
    v_sale_id, v_tenant_id, v_location_id, v_client_generated_id, v_sale_number, v_job_id, v_shift_id,
    v_subtotal, v_discount_total, 0, v_total, v_created_by,
    v_customer_id, v_promotion_id, v_promotion_discount, v_loyalty_points_redeemed, v_loyalty_discount,
    v_billing_type, v_payment_status, v_membership_program_id, v_membership_job_service_id, v_membership_discount
  );

  for v_line in select * from jsonb_array_elements(v_enriched_lines)
  loop
    insert into public.sale_items (tenant_id, sale_id, line_type, job_service_id, item_id, description, unit_price, quantity, discount_amount, line_total)
    values (
      v_tenant_id, v_sale_id, v_line ->> 'line_type',
      case when v_line ->> 'line_type' = 'job_service' then (v_line ->> 'job_service_id')::uuid else null end,
      case when v_line ->> 'line_type' = 'product' then (v_line ->> 'product_id')::uuid else null end,
      v_line ->> 'description', (v_line ->> 'unit_price')::numeric, (v_line ->> 'quantity')::numeric,
      (v_line ->> 'discount_amount')::numeric, (v_line ->> 'line_total')::numeric
    );

    if v_line ->> 'line_type' = 'product' then
      perform public.record_inventory_transaction(
        (v_line ->> 'product_id')::uuid, 'retail_sale', -((v_line ->> 'quantity')::numeric),
        null, 'sale', v_sale_id, null
      );
    end if;
  end loop;

  for v_payment in select * from jsonb_array_elements(coalesce(payload -> 'payments', '[]'::jsonb))
  loop
    insert into public.payments (tenant_id, sale_id, method, amount, reference_note, tendered_amount, change_given, recorded_by)
    values (
      v_tenant_id, v_sale_id, v_payment ->> 'method', (v_payment ->> 'amount')::numeric, v_payment ->> 'reference_note',
      nullif(v_payment ->> 'tendered_amount', '')::numeric, nullif(v_payment ->> 'change_given', '')::numeric, v_created_by
    );
  end loop;

  if v_loyalty_points_redeemed > 0 then
    insert into public.loyalty_transactions (tenant_id, customer_id, transaction_type, points_delta, sale_id, created_by)
    values (v_tenant_id, v_customer_id, 'redeem', -v_loyalty_points_redeemed, v_sale_id, v_created_by);
  end if;

  -- Membership redemption is NOT gated on payment_status -- the customer receives the free
  -- service today regardless of when the rest of the invoice (if on_account) gets paid, same
  -- as loyalty point redemption is never deferred either.
  if v_membership_program_id is not null then
    insert into public.membership_stamps (tenant_id, customer_id, program_id, transaction_type, stamp_delta, sale_id, created_by)
    values (v_tenant_id, v_customer_id, v_membership_program_id, 'redeem', -v_membership_program.stamps_required, v_sale_id, v_created_by);
  end if;

  -- Only earn once the sale is actually fully paid -- an on_account sale that's still unpaid
  -- or partial hasn't collected any money yet; record_fleet_settlement() posts the earn once
  -- settlement brings it to 'paid'.
  if v_customer_id is not null and v_total > 0 and v_payment_status = 'paid' then
    v_points_earned := floor(v_total * v_loyalty_earn_rate);
    if v_points_earned > 0 then
      insert into public.loyalty_transactions (tenant_id, customer_id, transaction_type, points_delta, sale_id, created_by)
      values (v_tenant_id, v_customer_id, 'earn', v_points_earned, v_sale_id, v_created_by);
    end if;
  end if;

  if v_customer_id is not null and v_payment_status = 'paid' then
    for v_earn_program in (
      select mps.program_id, count(*) as qty
      from jsonb_array_elements(v_enriched_lines) as line
      join public.membership_program_services mps on mps.service_id = (line ->> 'service_id')::uuid
      join public.membership_programs mp on mp.id = mps.program_id and mp.tenant_id = v_tenant_id and mp.is_active = true
      where line ->> 'line_type' = 'job_service'
        and (v_membership_job_service_id is null or (line ->> 'job_service_id')::uuid != v_membership_job_service_id)
      group by mps.program_id
    )
    loop
      insert into public.membership_stamps (tenant_id, customer_id, program_id, transaction_type, stamp_delta, sale_id, created_by)
      values (v_tenant_id, v_customer_id, v_earn_program.program_id, 'earn', v_earn_program.qty, v_sale_id, v_created_by);
    end loop;
  end if;

  return jsonb_build_object(
    'id', v_sale_id, 'sale_number', v_sale_number, 'status', 'completed', 'total', v_total, 'created_at', now(),
    'promotion_discount_amount', v_promotion_discount, 'loyalty_discount_amount', v_loyalty_discount,
    'loyalty_points_redeemed', v_loyalty_points_redeemed, 'loyalty_points_earned', v_points_earned,
    'billing_type', v_billing_type, 'payment_status', v_payment_status,
    'membership_discount_amount', v_membership_discount
  );
end;
$$;
