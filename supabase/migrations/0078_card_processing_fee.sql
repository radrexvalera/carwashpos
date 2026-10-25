-- The card terminal takes a cut (2.5% today, configurable per tenant since processors/rates
-- change) on every card transaction -- the business absorbs it rather than surcharging the
-- customer, so the listed price and what the customer pays are both unchanged. What changes is
-- how much of that money actually counts as realized revenue: card_processing_fee is stored on
-- the sale (a visible line, not silently folded into the total) and the SAME percentage haircut
-- is applied to whatever commission is tied to the job, since commission is a share of revenue
-- the business actually keeps.
alter table public.settings add column card_processing_fee_rate numeric(5, 2) not null default 2.5 check (card_processing_fee_rate >= 0);
alter table public.sales add column card_processing_fee numeric(12, 2) not null default 0;

create or replace function public.prevent_sale_tampering()
returns trigger
language plpgsql
as $$
begin
  if new.sale_number is distinct from old.sale_number
    or new.subtotal is distinct from old.subtotal
    or new.discount_total is distinct from old.discount_total
    or new.tax_total is distinct from old.tax_total
    or new.total is distinct from old.total
    or new.tenant_id is distinct from old.tenant_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.customer_id is distinct from old.customer_id
    or new.promotion_id is distinct from old.promotion_id
    or new.promotion_discount_amount is distinct from old.promotion_discount_amount
    or new.loyalty_points_redeemed is distinct from old.loyalty_points_redeemed
    or new.loyalty_discount_amount is distinct from old.loyalty_discount_amount
    or new.billing_type is distinct from old.billing_type
    or new.membership_program_id is distinct from old.membership_program_id
    or new.membership_redeemed_job_service_id is distinct from old.membership_redeemed_job_service_id
    or new.membership_discount_amount is distinct from old.membership_discount_amount
    or new.manual_discount_type is distinct from old.manual_discount_type
    or new.manual_discount_value is distinct from old.manual_discount_value
    or new.manual_discount_amount is distinct from old.manual_discount_amount
    or new.card_processing_fee is distinct from old.card_processing_fee
  then
    raise exception 'Sale financial/identity fields can only be set by create_job/create_sale flows';
  end if;
  return new;
end;
$$;

-- Internal only (no grant to authenticated) -- same treatment as record_inventory_transaction
-- (0051): called via `perform` from complete_job()/create_sale(), which already run as the
-- elevated function owner, so they retain implicit execute rights regardless of this.
--
-- Idempotent by design (checks adjustment_reason before doing anything) so it's safe to call
-- unconditionally from both complete_job() and create_sale() regardless of which happens first --
-- whichever runs second is the one that actually finds both an existing sale AND existing
-- commission_ledger rows to haircut; the other is a no-op.
--
-- Known gap: a crew correction via recompute_job_commission() after this has already run writes
-- fresh commission at the FULL rate, not haircut -- that function doesn't know about card fees.
-- Acceptable for now (crew corrections after a card payment are rare); revisit if it matters.
create or replace function public.apply_card_fee_commission_adjustment(p_tenant_id uuid, p_job_id uuid, p_created_by uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_total numeric(12, 2);
  v_card_fee numeric(12, 2);
  v_fee_fraction numeric(8, 6);
  v_comm record;
  v_comm_period_id uuid;
  v_comm_period_status text;
  v_comm_payroll_entry_id uuid;
  v_delta numeric(12, 2);
begin
  if exists (select 1 from public.commission_ledger where job_id = p_job_id and adjustment_reason = 'Card processing fee') then
    return;
  end if;

  select coalesce(sum(line_total), 0) into v_job_total
  from public.job_services where job_id = p_job_id and status != 'cancelled';

  select coalesce(sum(card_processing_fee), 0) into v_card_fee
  from public.sales where job_id = p_job_id and status != 'voided';

  if v_job_total <= 0 or v_card_fee <= 0 then
    return;
  end if;

  v_fee_fraction := least(v_card_fee / v_job_total, 1);

  for v_comm in
    select
      employee_id, job_service_id, service_id, commission_rate,
      sum(commission_amount) as net_amount,
      max(gross_service_amount) as gross_amount,
      (array_agg(commission_type order by created_at desc))[1] as commission_type,
      (array_agg(id order by created_at desc))[1] as latest_ledger_id
    from public.commission_ledger
    where job_id = p_job_id
    group by employee_id, job_service_id, service_id, commission_rate
  loop
    v_delta := round(v_comm.net_amount * v_fee_fraction, 2);
    if abs(v_delta) < 0.01 then
      continue;
    end if;

    select payroll_period_id into v_comm_period_id
    from public.commission_ledger
    where job_id = p_job_id and employee_id = v_comm.employee_id
      and job_service_id is not distinct from v_comm.job_service_id
      and service_id is not distinct from v_comm.service_id
      and commission_rate = v_comm.commission_rate
      and payroll_period_id is not null
    limit 1;

    v_comm_period_status := null;
    v_comm_payroll_entry_id := null;
    if v_comm_period_id is not null then
      select status into v_comm_period_status from public.payroll_periods where id = v_comm_period_id;
    end if;

    if v_comm_period_status = 'paid' then
      continue;
    end if;

    if v_comm_period_id is not null then
      select id into v_comm_payroll_entry_id from public.payroll_entries
      where payroll_period_id = v_comm_period_id and employee_id = v_comm.employee_id;
    end if;

    insert into public.commission_ledger (
      tenant_id, employee_id, job_id, job_service_id, service_id,
      gross_service_amount, commission_type, commission_rate, commission_amount,
      status, payroll_period_id, reverses_ledger_id, adjustment_reason, created_by
    ) values (
      p_tenant_id, v_comm.employee_id, p_job_id, v_comm.job_service_id, v_comm.service_id,
      v_comm.gross_amount, v_comm.commission_type, v_comm.commission_rate, -v_delta,
      case when v_comm_payroll_entry_id is not null then 'approved' else 'earned' end,
      case when v_comm_payroll_entry_id is not null then v_comm_period_id else null end,
      v_comm.latest_ledger_id, 'Card processing fee', p_created_by
    );

    if v_comm_payroll_entry_id is not null then
      if v_comm_period_status = 'draft' then
        update public.payroll_entries set commission_total = commission_total - v_delta where id = v_comm_payroll_entry_id;
      elsif v_comm_period_status = 'locked' then
        insert into public.payroll_adjustments (tenant_id, payroll_entry_id, amount, reason, created_by)
        values (p_tenant_id, v_comm_payroll_entry_id, -v_delta, 'Card processing fee', p_created_by);
      end if;
    end if;
  end loop;
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

  -- Applied to the subtotal AFTER per-line discounts, same base a promotion would use, before
  -- promotion/loyalty/membership stack on top (those three are currently unreachable from the UI,
  -- so in practice this is the only discount layered on top of per-line discounts today).
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

  if v_job_id is not null then
    perform public.apply_card_fee_commission_adjustment(v_tenant_id, v_job_id, v_created_by);
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
