-- Phase 8a security hardening. Findings from a full RLS/authorization audit across all prior
-- migrations, verified by direct inspection before writing this fix (not applied speculatively).
-- All changes here are additive (create or replace / drop+create policy) -- no data migration,
-- nothing destructive.

-- Fix 1 (critical): has_permission() had no tenant scoping -- it joined employees on
-- e.user_id = auth.uid() alone, with no e.tenant_id = current_tenant_id() filter, unlike its
-- sibling current_employee_id() which already gets this right. employees.user_id is only unique
-- PER TENANT (unique (tenant_id, user_id) where user_id is not null), so the same real user can
-- legitimately hold an employees row in more than one tenant -- without this filter, a permission
-- granted to that user in ANY tenant they belong to would apply while they operate in ANY OTHER
-- tenant too. Inert today (only one real tenant exists), but a live cross-tenant privilege-
-- escalation vector the instant a second tenant is ever onboarded, which this app's architecture
-- explicitly anticipates. Fixing now while inert is far safer than fixing after a second tenant's
-- data is on the line.
create or replace function public.has_permission(perm_key text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.employees e
    join public.employee_roles er on er.employee_id = e.id
    join public.role_permissions rp on rp.role_id = er.role_id
    where e.user_id = auth.uid() and e.tenant_id = public.current_tenant_id() and rp.permission_key = perm_key
  );
$$;

-- Fix 2 (critical): record_inventory_transaction() has zero authorization check in its own body
-- and was never revoked from PUBLIC (Postgres grants EXECUTE on new functions to PUBLIC by
-- default; every other write-capable function in this codebase got an explicit
-- `grant execute ... to authenticated` marking the author's intent -- this one has neither a
-- grant nor a revoke, despite its own comment claiming "not exposed to authenticated directly").
-- Exploitable today by ANY authenticated user regardless of role: a direct
-- supabase.rpc('record_inventory_transaction', {...}) call could fabricate arbitrary stock-ledger
-- entries, bypassing the can_manage_inventory gate adjust_inventory_stock() is supposed to
-- enforce. This is an internal helper for adjust_inventory_stock()/create_purchase_order()/
-- complete_job()/create_sale() -- each already does its OWN permission check (four different
-- permissions depending on context) before calling it, so revoking direct client access is the
-- correct fix, not adding one hardcoded internal check here. Internal `perform` calls from those
-- SECURITY DEFINER callers are unaffected -- they execute as the function owner, which always
-- retains implicit execute rights on its own functions regardless of this revoke.
revoke execute on function public.record_inventory_transaction(uuid, text, numeric, numeric, text, uuid, text) from public, authenticated;

-- Fix 3 (moderate): same treatment for the dead complete_ticket() RPC -- its underlying tables
-- (products/consumables/service_bom) were dropped in migration 0035, so it's not currently
-- exploitable (calling it now errors on the missing tables), but it's a live trust-boundary gap
-- (SECURITY DEFINER, granted to authenticated, zero permission check) that would silently
-- reactivate if anything ever touched those table names again.
revoke execute on function public.complete_ticket(jsonb) from public, authenticated;

-- Fix 4 (moderate): 7 insert/update policies checked only their own row's tenant_id column, never
-- that the parent row their foreign key points at actually belongs to that tenant -- a pattern
-- every OTHER child/junction table in this codebase already gets right (promotion_services,
-- membership_program_services, role_permissions, employee_roles). Adding the same
-- exists(select 1 from <parent> where id = <fk> and tenant_id = current_tenant_id()) guard here.
drop policy job_service_attendants_insert on public.job_service_attendants;
create policy job_service_attendants_insert on public.job_service_attendants
  for insert with check (
    tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs')
    and exists (select 1 from public.job_services js where js.id = job_service_id and js.tenant_id = public.current_tenant_id())
  );

drop policy job_status_history_insert on public.job_status_history;
create policy job_status_history_insert on public.job_status_history
  for insert with check (
    tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs')
    and exists (select 1 from public.jobs j where j.id = job_id and j.tenant_id = public.current_tenant_id())
  );

drop policy payroll_adjustments_insert on public.payroll_adjustments;
create policy payroll_adjustments_insert on public.payroll_adjustments
  for insert with check (
    tenant_id = public.current_tenant_id() and public.has_permission('can_approve_commission')
    and exists (select 1 from public.payroll_entries pe where pe.id = payroll_entry_id and pe.tenant_id = public.current_tenant_id())
  );

drop policy appointments_insert on public.appointments;
create policy appointments_insert on public.appointments
  for insert with check (
    tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs')
    and exists (select 1 from public.vehicles v where v.id = vehicle_id and v.tenant_id = public.current_tenant_id())
    and exists (select 1 from public.vehicle_sizes vs where vs.id = vehicle_size_id and vs.tenant_id = public.current_tenant_id())
  );

drop policy vehicle_inspections_insert on public.vehicle_inspections;
create policy vehicle_inspections_insert on public.vehicle_inspections
  for insert with check (
    tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs')
    and exists (select 1 from public.jobs j where j.id = job_id and j.tenant_id = public.current_tenant_id())
  );

drop policy vehicle_inspection_photos_insert on public.vehicle_inspection_photos;
create policy vehicle_inspection_photos_insert on public.vehicle_inspection_photos
  for insert with check (
    tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs')
    and exists (select 1 from public.vehicle_inspections vi where vi.id = inspection_id and vi.tenant_id = public.current_tenant_id())
  );

-- customers/vehicles writes are deliberately left permission-ungated (confirmed with the user --
-- front-desk/walk-in data, gating it would add friction to the most common daily action for no
-- real security benefit) -- only the missing parent-ownership check is added here.
drop policy vehicles_insert on public.vehicles;
create policy vehicles_insert on public.vehicles
  for insert with check (
    tenant_id = public.current_tenant_id()
    and (customer_id is null or exists (select 1 from public.customers c where c.id = customer_id and c.tenant_id = public.current_tenant_id()))
    and (vehicle_size_id is null or exists (select 1 from public.vehicle_sizes vs where vs.id = vehicle_size_id and vs.tenant_id = public.current_tenant_id()))
  );
drop policy vehicles_update on public.vehicles;
create policy vehicles_update on public.vehicles
  for update using (tenant_id = public.current_tenant_id())
  with check (
    tenant_id = public.current_tenant_id()
    and (customer_id is null or exists (select 1 from public.customers c where c.id = customer_id and c.tenant_id = public.current_tenant_id()))
    and (vehicle_size_id is null or exists (select 1 from public.vehicle_sizes vs where vs.id = vehicle_size_id and vs.tenant_id = public.current_tenant_id()))
  );

-- Fix 5 (minor): standard null-tenant guard every other RPC in this codebase has -- harmless today
-- (a null tenant just makes the sale lookup below return nothing), but inconsistent with the
-- established defensive style. Full body otherwise reproduced verbatim from migration 0048.
create or replace function public.record_fleet_settlement(p_sale_id uuid, p_method text, p_amount numeric, p_reference_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_sale record;
  v_already_paid numeric(12, 2);
  v_remaining numeric(12, 2);
  v_new_status text;
  v_loyalty_earn_rate numeric(6, 4);
  v_points_earned int := 0;
  v_earn_program record;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_fleet_accounts') then
    raise exception 'Not authorized to settle a fleet invoice';
  end if;

  select * into v_sale from public.sales
  where id = p_sale_id and tenant_id = v_tenant_id and billing_type = 'on_account';
  if v_sale.id is null then
    raise exception 'On-account sale not found';
  end if;
  if v_sale.payment_status = 'paid' then
    raise exception 'This invoice is already fully paid';
  end if;
  if coalesce(p_method, '') not in ('cash', 'gcash', 'maya', 'bank_transfer', 'card') then
    raise exception 'Invalid payment method';
  end if;

  select coalesce(sum(amount), 0) into v_already_paid from public.payments where sale_id = p_sale_id;
  v_remaining := round(v_sale.total - v_already_paid, 2);

  if p_amount is null or p_amount <= 0 or p_amount > v_remaining + 0.01 then
    raise exception 'Settlement amount must be between 0 and the remaining balance of %', v_remaining;
  end if;

  insert into public.payments (tenant_id, sale_id, method, amount, reference_note, recorded_by)
  values (v_tenant_id, p_sale_id, p_method, p_amount, p_reference_note, auth.uid());

  v_new_status := case when round(v_already_paid + p_amount, 2) >= v_sale.total - 0.01 then 'paid' else 'partial' end;
  update public.sales set payment_status = v_new_status where id = p_sale_id;

  if v_new_status = 'paid' and v_sale.customer_id is not null then
    if v_sale.total > 0 then
      select loyalty_earn_rate into v_loyalty_earn_rate from public.settings where tenant_id = v_tenant_id;
      v_points_earned := floor(v_sale.total * v_loyalty_earn_rate);
      if v_points_earned > 0 then
        insert into public.loyalty_transactions (tenant_id, customer_id, transaction_type, points_delta, sale_id, created_by)
        values (v_tenant_id, v_sale.customer_id, 'earn', v_points_earned, p_sale_id, auth.uid());
      end if;
    end if;

    for v_earn_program in (
      select mps.program_id, count(*) as qty
      from public.sale_items si
      join public.job_services js on js.id = si.job_service_id
      join public.membership_program_services mps on mps.service_id = js.service_id
      join public.membership_programs mp on mp.id = mps.program_id and mp.tenant_id = v_tenant_id and mp.is_active = true
      where si.sale_id = p_sale_id and si.line_type = 'job_service'
        and (v_sale.membership_redeemed_job_service_id is null or si.job_service_id != v_sale.membership_redeemed_job_service_id)
      group by mps.program_id
    )
    loop
      insert into public.membership_stamps (tenant_id, customer_id, program_id, transaction_type, stamp_delta, sale_id, created_by)
      values (v_tenant_id, v_sale.customer_id, v_earn_program.program_id, 'earn', v_earn_program.qty, p_sale_id, auth.uid());
    end loop;
  end if;

  return jsonb_build_object('remaining', greatest(v_remaining - p_amount, 0), 'status', v_new_status, 'loyalty_points_earned', v_points_earned);
end;
$$;
