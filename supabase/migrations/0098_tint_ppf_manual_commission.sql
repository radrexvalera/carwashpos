-- Ceramic Tint & PPF gets the same treatment Repaint already has (0094/0095): its own Sales
-- Report / Expenses tab, excluded from "All sales", and manual (not auto-calculated) commission at
-- Collect Payment. Unlike Repaint, which already lived in one clean service category, Test123's
-- PPF service sat inside "Detailing" while ceramic tint had its own "Tint" category -- the owner
-- chose to fold them together: rename "Tint" to "Tint & PPF" and move "PPF" into it, so this
-- feature can key off a single category name exactly like Repaint does.
update public.service_categories set name = 'Tint & PPF'
where tenant_id = '8a1042d4-1a0c-41a0-8eb9-79253e9f5cb3' and name = 'Tint';

update public.services set category_id = (
  select id from public.service_categories where tenant_id = '8a1042d4-1a0c-41a0-8eb9-79253e9f5cb3' and name = 'Tint & PPF'
)
where tenant_id = '8a1042d4-1a0c-41a0-8eb9-79253e9f5cb3' and name = 'PPF';

-- job_has_repaint_line() (0094/0095) only ever checked one hardcoded category behind one hardcoded
-- feature flag. Generalizes it to a small registry of (feature flag, category name) pairs, so a
-- future third manually-commissioned category group is a one-line addition here instead of a new
-- near-duplicate function and three more call-site edits. Same contract otherwise: true only when
-- the tenant has been granted the matching feature AND the job actually has a line in that category.
create or replace function public.job_has_manual_commission_line(p_tenant_id uuid, p_job_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from (values ('repaint', 'Repaint'), ('tint_ppf', 'Tint & PPF')) as groups(feature_key, category_name)
    join public.job_services js on js.tenant_id = p_tenant_id and js.job_id = p_job_id
    join public.services s on s.id = js.service_id
    join public.service_categories sc on sc.id = s.category_id and sc.name = groups.category_name
    where coalesce((select (settings.features ->> groups.feature_key)::boolean from public.settings where settings.tenant_id = p_tenant_id), false)
  );
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
  v_is_manual_commission_job boolean;
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

  v_is_manual_commission_job := public.job_has_manual_commission_line(v_tenant_id, p_job_id);

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

    if not v_is_manual_commission_job then
      if not public.job_service_uses_fixed_by_size(v_tenant_id, v_js.service_id) then
        v_rate := public.resolve_service_commission_rate(v_tenant_id, v_js.service_id, v_js.is_carwash, v_carwash_rate, v_other_rate);
        v_job_pool := v_job_pool + round(v_js.line_total * v_rate / 100, 2);
      end if;

      v_commission_count := v_commission_count + public.apply_job_service_bonus_commission(
        v_tenant_id, p_job_id, v_js.id, v_js.service_id, v_js.unit_price, v_js.quantity, v_js.line_total,
        v_job.vehicle_size_id, v_created_by
      );
    end if;

    update public.job_services set status = 'completed', completed_at = now() where id = v_js.id;
  end loop;

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

  perform public.apply_discount_commission_adjustment(v_tenant_id, p_job_id, v_created_by);
  perform public.apply_card_fee_commission_adjustment(v_tenant_id, p_job_id, v_created_by);

  return jsonb_build_object('id', p_job_id, 'status', 'completed', 'commission_entries_created', v_commission_count);
end;
$$;

grant execute on function public.complete_job(uuid) to authenticated;

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
  v_card_amount numeric(12, 2) := 0;
  v_card_fee_rate numeric(5, 2);
  v_card_processing_fee numeric(12, 2) := 0;
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
  v_manual_discount_type text := nullif(payload ->> 'manual_discount_type', '');
  v_manual_discount_value numeric(12, 2) := coalesce((payload ->> 'manual_discount_value')::numeric, 0);
  v_manual_discount numeric(12, 2) := 0;
  v_pre_manual_discount_base numeric(12, 2);
  v_manual_commissions jsonb := coalesce(payload -> 'manual_commissions', '[]'::jsonb);
  v_mc jsonb;
  v_mc_employee_id uuid;
  v_mc_amount numeric(12, 2);
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

  if v_manual_discount_type is not null and v_manual_discount_type not in ('percentage', 'fixed') then
    raise exception 'Unknown manual_discount_type %', v_manual_discount_type;
  end if;

  if v_manual_discount_value < 0 then
    raise exception 'manual_discount_value cannot be negative';
  end if;

  if v_manual_discount_type = 'percentage' and v_manual_discount_value > 100 then
    raise exception 'manual_discount_value cannot exceed 100 for a percentage discount';
  end if;

  select id into v_existing_sale_id from public.sales
  where tenant_id = v_tenant_id and client_generated_id = v_client_generated_id;

  if v_existing_sale_id is not null then
    return (
      select jsonb_build_object(
        'id', s.id, 'sale_number', s.sale_number, 'status', s.status, 'total', s.total, 'created_at', s.created_at,
        'promotion_discount_amount', s.promotion_discount_amount, 'loyalty_discount_amount', s.loyalty_discount_amount,
        'loyalty_points_redeemed', s.loyalty_points_redeemed, 'billing_type', s.billing_type, 'payment_status', s.payment_status,
        'membership_discount_amount', s.membership_discount_amount, 'manual_discount_amount', s.manual_discount_amount,
        'card_processing_fee', s.card_processing_fee
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

  if jsonb_array_length(v_manual_commissions) > 0 then
    if v_job_id is null then
      raise exception 'manual_commissions requires a job_id';
    end if;

    if not public.job_has_manual_commission_line(v_tenant_id, v_job_id) then
      raise exception 'Manual commission entries are only allowed for jobs with a manually-commissioned service line';
    end if;

    for v_mc in select * from jsonb_array_elements(v_manual_commissions)
    loop
      v_mc_employee_id := (v_mc ->> 'employee_id')::uuid;
      v_mc_amount := (v_mc ->> 'amount')::numeric;

      if v_mc_employee_id is null or v_mc_amount is null or v_mc_amount < 0 then
        raise exception 'Each manual commission entry needs a valid employee_id and a non-negative amount';
      end if;

      if not exists (
        select 1 from public.job_service_attendants jsa
        join public.job_services js on js.id = jsa.job_service_id
        where js.job_id = v_job_id and jsa.employee_id = v_mc_employee_id
      ) then
        raise exception 'Employee % is not assigned as crew on this job', v_mc_employee_id;
      end if;
    end loop;
  end if;

  select id into v_location_id from public.locations where tenant_id = v_tenant_id limit 1;

  select loyalty_earn_rate, loyalty_redemption_value, card_processing_fee_rate
  into v_loyalty_earn_rate, v_loyalty_redemption_value, v_card_fee_rate
  from public.settings where tenant_id = v_tenant_id;
  v_card_fee_rate := coalesce(v_card_fee_rate, 2.5);

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

  if v_manual_discount_type is not null and v_manual_discount_value > 0 then
    v_pre_manual_discount_base := greatest(v_subtotal - v_discount_total, 0);
    v_manual_discount := case
      when v_manual_discount_type = 'percentage' then round(v_pre_manual_discount_base * v_manual_discount_value / 100, 2)
      else least(v_manual_discount_value, v_pre_manual_discount_base)
    end;
  end if;

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

    v_remaining_after_promotion := round(v_subtotal - v_discount_total - v_manual_discount - v_promotion_discount, 2);

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

  v_total := round(v_subtotal - v_discount_total - v_manual_discount - v_promotion_discount - v_loyalty_discount - v_membership_discount, 2);
  if v_total < 0 then
    v_total := 0;
  end if;

  for v_payment in select * from jsonb_array_elements(coalesce(payload -> 'payments', '[]'::jsonb))
  loop
    v_payments_sum := v_payments_sum + (v_payment ->> 'amount')::numeric;
    if v_payment ->> 'method' = 'card' then
      v_card_amount := v_card_amount + (v_payment ->> 'amount')::numeric;
    end if;
  end loop;

  v_card_processing_fee := round(v_card_amount * v_card_fee_rate / 100, 2);

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
    billing_type, payment_status, membership_program_id, membership_redeemed_job_service_id, membership_discount_amount,
    manual_discount_type, manual_discount_value, manual_discount_amount, card_processing_fee
  )
  values (
    v_sale_id, v_tenant_id, v_location_id, v_client_generated_id, v_sale_number, v_job_id, v_shift_id,
    v_subtotal, v_discount_total, 0, v_total, v_created_by,
    v_customer_id, v_promotion_id, v_promotion_discount, v_loyalty_points_redeemed, v_loyalty_discount,
    v_billing_type, v_payment_status, v_membership_program_id, v_membership_job_service_id, v_membership_discount,
    v_manual_discount_type, case when v_manual_discount_type is not null then v_manual_discount_value else null end, v_manual_discount,
    v_card_processing_fee
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

  if v_membership_program_id is not null then
    insert into public.membership_stamps (tenant_id, customer_id, program_id, transaction_type, stamp_delta, sale_id, created_by)
    values (v_tenant_id, v_customer_id, v_membership_program_id, 'redeem', -v_membership_program.stamps_required, v_sale_id, v_created_by);
  end if;

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

  if v_job_id is not null then
    perform public.apply_discount_commission_adjustment(v_tenant_id, v_job_id, v_created_by);
    perform public.apply_card_fee_commission_adjustment(v_tenant_id, v_job_id, v_created_by);

    if jsonb_array_length(v_manual_commissions) > 0 then
      for v_mc in select * from jsonb_array_elements(v_manual_commissions)
      loop
        insert into public.commission_ledger (
          tenant_id, employee_id, job_id, job_service_id, service_id,
          gross_service_amount, commission_type, commission_rate, commission_amount,
          status, created_by
        ) values (
          v_tenant_id, (v_mc ->> 'employee_id')::uuid, v_job_id, null, null,
          v_total, 'manual', 0, (v_mc ->> 'amount')::numeric,
          'earned', v_created_by
        );
      end loop;
    end if;
  end if;

  return jsonb_build_object(
    'id', v_sale_id, 'sale_number', v_sale_number, 'status', 'completed', 'total', v_total, 'created_at', now(),
    'promotion_discount_amount', v_promotion_discount, 'loyalty_discount_amount', v_loyalty_discount,
    'loyalty_points_redeemed', v_loyalty_points_redeemed, 'loyalty_points_earned', v_points_earned,
    'billing_type', v_billing_type, 'payment_status', v_payment_status,
    'membership_discount_amount', v_membership_discount, 'manual_discount_amount', v_manual_discount,
    'card_processing_fee', v_card_processing_fee
  );
end;
$$;

grant execute on function public.create_sale(jsonb) to authenticated;

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

  if public.job_has_manual_commission_line(v_tenant_id, p_job_id) then
    raise exception 'This job''s commission was entered manually at Collect Payment -- crew changes here can''t recompute it automatically';
  end if;

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

  select count(distinct jsa.employee_id) into v_crew_count
  from public.job_service_attendants jsa
  join public.job_services js on js.id = jsa.job_service_id
  where js.job_id = p_job_id and js.status != 'cancelled';

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
      where js.job_id = p_job_id and jsa.employee_id = v_emp.employee_id and js.status != 'cancelled'
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

  perform public.apply_discount_commission_adjustment(v_tenant_id, p_job_id, v_created_by);
  perform public.apply_card_fee_commission_adjustment(v_tenant_id, p_job_id, v_created_by);

  return jsonb_build_object(
    'job_id', p_job_id, 'rate', v_effective_rate, 'pool', v_job_pool, 'crew_count', v_crew_count,
    'entries_written', v_entries_written, 'bonus_entries_created', v_bonus_count
  );
end;
$$;

grant execute on function public.recompute_job_commission(uuid) to authenticated;

drop function if exists public.job_has_repaint_line(uuid, uuid);

-- Test123 is the tenant actually using this -- keep behavior unchanged for every other tenant
-- (an absent key defaults to off). Disable/enable the tamper-guard trigger (0095) around this
-- backfill: it correctly blocks a normal tenant-scoped UPDATE, but a plain migration run carries
-- no service_role JWT context either, so it would reject this one too without the bypass.
alter table public.settings disable trigger settings_prevent_features_tampering;
update public.settings set features = features || '{"tint_ppf": true}'::jsonb
where tenant_id = '8a1042d4-1a0c-41a0-8eb9-79253e9f5cb3';
alter table public.settings enable trigger settings_prevent_features_tampering;
