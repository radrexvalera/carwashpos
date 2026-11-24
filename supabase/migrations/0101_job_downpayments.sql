-- Downpayments: money taken against a job before it's done (common on long Repaint/Tint/PPF jobs).
--
-- Business rules (confirmed with the owner):
--   * Taken at registration or any time from the Job Queue until the job is paid; a job can have
--     several (e.g. P2,000 Monday + P3,000 Wednesday), each with its own method.
--   * It is NOT a sale. Revenue is recognized when the job is paid: create_sale() folds every
--     'held' downpayment into that sale as ordinary payments rows (tagged job_downpayment_id, with
--     paid_at = when the money actually came in), so Sales/Payment-method reports count the full
--     job on the completion day, exactly like a job paid in one go.
--   * The DRAWER, however, is counted when the money physically arrived: get_shift_summary() adds a
--     cash downpayment to the shift it was taken on, and skips those same rows when they later
--     reappear as payments on the final sale, so no shift counts the cash twice or misses it.
--   * Cancelling a job that holds downpayments makes the cashier choose: refund (cash leaves the
--     canceller's open drawer) or keep (forfeited -- the business keeps it as income).
--   * Voiding the final sale puts its downpayments back to 'held' (the job is unpaid again).

create table public.job_downpayments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_generated_id uuid not null,
  job_id uuid not null references public.jobs(id),
  shift_id uuid not null references public.cashier_shifts(id),
  method text not null check (method in ('cash', 'gcash', 'maya', 'bank_transfer', 'card', 'maribank', 'gotyme', 'rcbc', 'bpi', 'unionbank', 'qrph')),
  amount numeric(12, 2) not null check (amount > 0),
  reference_note text,
  tendered_amount numeric(12, 2),
  change_given numeric(12, 2),
  status text not null default 'held' check (status in ('held', 'applied', 'refunded', 'forfeited')),
  sale_id uuid references public.sales(id),
  resolved_at timestamptz,
  resolved_by uuid references public.user_profiles(id),
  -- The drawer a refund was paid out of (null for keep/applied).
  resolved_shift_id uuid references public.cashier_shifts(id),
  resolution_note text,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, client_generated_id)
);
create index job_downpayments_tenant_id_idx on public.job_downpayments(tenant_id);
create index job_downpayments_job_id_idx on public.job_downpayments(job_id);
create index job_downpayments_shift_id_idx on public.job_downpayments(shift_id);
create index job_downpayments_resolved_shift_id_idx on public.job_downpayments(resolved_shift_id);
create index job_downpayments_sale_id_idx on public.job_downpayments(sale_id);

alter table public.job_downpayments enable row level security;

create policy job_downpayments_select on public.job_downpayments
  for select using (tenant_id = public.current_tenant_id());
-- No insert/update policies -- writes only through the RPCs below, same as sales/payments.

alter table public.payments add column job_downpayment_id uuid references public.job_downpayments(id);
create index payments_job_downpayment_id_idx on public.payments(job_downpayment_id);

-- Open-board view gains downpayment_total (appended last -- create or replace view can only add
-- columns at the end). Otherwise identical to 0070.
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
  ) as is_paid,
  (
    select coalesce(sum(d.amount), 0)
    from public.job_downpayments d
    where d.job_id = j.id and d.status = 'held'
  ) as downpayment_total
from public.jobs j
join public.vehicles v on v.id = j.vehicle_id
join public.vehicle_sizes vs on vs.id = j.vehicle_size_id
left join public.wash_bays b on b.id = j.bay_id
where j.status != 'cancelled';

-- payload: client_generated_id, job_id, method, amount, [shift_id], [reference_note],
-- [tendered_amount], [change_given]. Idempotent on client_generated_id (it can arrive through the
-- offline queue, right behind the create_job() of a job registered with a downpayment).
create or replace function public.record_job_downpayment(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_client_generated_id uuid := (payload ->> 'client_generated_id')::uuid;
  v_job_id uuid := (payload ->> 'job_id')::uuid;
  v_shift_id uuid := nullif(payload ->> 'shift_id', '')::uuid;
  v_method text := payload ->> 'method';
  v_amount numeric(12, 2) := (payload ->> 'amount')::numeric;
  v_job record;
  v_job_total numeric(12, 2);
  v_held_total numeric(12, 2);
  v_existing record;
  v_id uuid := gen_random_uuid();
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_shift') then
    raise exception 'Not authorized to take payments';
  end if;

  if v_client_generated_id is null or v_job_id is null then
    raise exception 'client_generated_id and job_id are required';
  end if;

  select * into v_existing from public.job_downpayments
  where tenant_id = v_tenant_id and client_generated_id = v_client_generated_id;
  if v_existing.id is not null then
    return jsonb_build_object('id', v_existing.id, 'job_id', v_existing.job_id, 'amount', v_existing.amount, 'status', v_existing.status);
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'Downpayment amount must be greater than zero';
  end if;

  if v_shift_id is not null then
    if not exists (select 1 from public.cashier_shifts where id = v_shift_id and tenant_id = v_tenant_id and status = 'open') then
      v_shift_id := null;
    end if;
  end if;
  if v_shift_id is null then
    select id into v_shift_id from public.cashier_shifts
    where tenant_id = v_tenant_id and cashier_id = public.current_employee_id() and status = 'open';
  end if;
  if v_shift_id is null then
    raise exception 'You need an open shift before taking a downpayment';
  end if;

  select * into v_job from public.jobs where id = v_job_id and tenant_id = v_tenant_id for update;
  if v_job.id is null then
    raise exception 'Job not found';
  end if;
  if v_job.status = 'cancelled' then
    raise exception 'This job was cancelled';
  end if;
  if exists (select 1 from public.sales where job_id = v_job_id and status != 'voided') then
    raise exception 'This job has already been paid';
  end if;

  select coalesce(sum(line_total), 0) into v_job_total
  from public.job_services where job_id = v_job_id and status != 'cancelled';
  select coalesce(sum(amount), 0) into v_held_total
  from public.job_downpayments where job_id = v_job_id and status = 'held';

  if v_held_total + v_amount > v_job_total + 0.01 then
    raise exception 'Downpayments (%) would be more than the job total (%)', v_held_total + v_amount, v_job_total;
  end if;

  insert into public.job_downpayments (
    id, tenant_id, client_generated_id, job_id, shift_id, method, amount, reference_note,
    tendered_amount, change_given, created_by
  ) values (
    v_id, v_tenant_id, v_client_generated_id, v_job_id, v_shift_id, v_method, v_amount,
    nullif(trim(coalesce(payload ->> 'reference_note', '')), ''),
    nullif(payload ->> 'tendered_amount', '')::numeric, nullif(payload ->> 'change_given', '')::numeric, auth.uid()
  );

  return jsonb_build_object('id', v_id, 'job_id', v_job_id, 'amount', v_amount, 'status', 'held');
end;
$$;

grant execute on function public.record_job_downpayment(jsonb) to authenticated;

-- Shared by cancel_job() and refund_job_downpayment(). p_downpayment_id null = every held
-- downpayment on the job. A cash refund has to come out of a drawer, so it needs the caller's open
-- shift; a non-cash refund (sent back over GCash etc.) records the shift only if there is one.
create or replace function public.resolve_job_downpayments(p_tenant_id uuid, p_job_id uuid, p_downpayment_id uuid, p_action text, p_note text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift_id uuid;
  v_total numeric(12, 2) := 0;
begin
  if p_action not in ('refund', 'keep') then
    raise exception 'Choose whether to refund or keep the downpayment';
  end if;

  select id into v_shift_id from public.cashier_shifts
  where tenant_id = p_tenant_id and cashier_id = public.current_employee_id() and status = 'open';

  if p_action = 'refund' and v_shift_id is null and exists (
    select 1 from public.job_downpayments
    where job_id = p_job_id and tenant_id = p_tenant_id and status = 'held' and method = 'cash'
      and (p_downpayment_id is null or id = p_downpayment_id)
  ) then
    raise exception 'You need an open shift to refund a cash downpayment -- the cash comes out of your drawer';
  end if;

  select coalesce(sum(amount), 0) into v_total from public.job_downpayments
  where job_id = p_job_id and tenant_id = p_tenant_id and status = 'held'
    and (p_downpayment_id is null or id = p_downpayment_id);

  update public.job_downpayments
  set status = case when p_action = 'refund' then 'refunded' else 'forfeited' end,
      resolved_at = now(), resolved_by = auth.uid(),
      resolved_shift_id = case when p_action = 'refund' then v_shift_id else null end,
      resolution_note = p_note
  where job_id = p_job_id and tenant_id = p_tenant_id and status = 'held'
    and (p_downpayment_id is null or id = p_downpayment_id);

  return v_total;
end;
$$;

revoke execute on function public.resolve_job_downpayments(uuid, uuid, uuid, text, text) from public, anon, authenticated;

-- Refund one held downpayment without cancelling the job (taken by mistake, or a discount/removed
-- service left the job total below what was already paid down).
create or replace function public.refund_job_downpayment(p_downpayment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_reason text := trim(coalesce(p_reason, ''));
  v_dp record;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_shift') then
    raise exception 'Not authorized to refund downpayments';
  end if;

  if v_reason = '' then
    raise exception 'A refund reason is required';
  end if;

  select * into v_dp from public.job_downpayments where id = p_downpayment_id and tenant_id = v_tenant_id for update;
  if v_dp.id is null then
    raise exception 'Downpayment not found';
  end if;
  if v_dp.status != 'held' then
    raise exception 'This downpayment was already %', v_dp.status;
  end if;

  perform public.resolve_job_downpayments(v_tenant_id, v_dp.job_id, v_dp.id, 'refund', v_reason);

  return jsonb_build_object('id', v_dp.id, 'status', 'refunded', 'amount', v_dp.amount);
end;
$$;

grant execute on function public.refund_job_downpayment(uuid, text) to authenticated;

-- cancel_job() gains p_downpayment_action ('refund' | 'keep'), required only when the job still
-- holds downpayments. New signature, so drop 0076's two-arg version first (otherwise a two-arg call
-- would be ambiguous between the two).
drop function if exists public.cancel_job(uuid, text);

create or replace function public.cancel_job(p_job_id uuid, p_reason text, p_downpayment_action text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_reason text := trim(coalesce(p_reason, ''));
  v_job record;
  v_held numeric(12, 2);
  v_resolved numeric(12, 2) := 0;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_jobs') then
    raise exception 'Not authorized to cancel jobs';
  end if;

  if v_reason = '' then
    raise exception 'A cancellation reason is required';
  end if;

  select * into v_job from public.jobs where id = p_job_id and tenant_id = v_tenant_id for update;
  if v_job.id is null then
    raise exception 'Job not found';
  end if;

  if not public.job_is_editable(p_job_id, v_tenant_id) then
    raise exception 'This job can no longer be cancelled -- it is completed, cancelled, or already paid for';
  end if;

  select coalesce(sum(amount), 0) into v_held from public.job_downpayments
  where job_id = p_job_id and tenant_id = v_tenant_id and status = 'held';

  if v_held > 0 then
    if p_downpayment_action is null then
      raise exception 'This job has a downpayment of % -- choose whether to refund it or keep it', v_held;
    end if;
    v_resolved := public.resolve_job_downpayments(v_tenant_id, p_job_id, null, p_downpayment_action, 'Job cancelled: ' || v_reason);
  end if;

  update public.jobs set status = 'cancelled', bay_id = null, bay_entered_at = null where id = p_job_id;

  update public.job_services set status = 'cancelled' where job_id = p_job_id and status not in ('completed', 'cancelled');

  insert into public.job_status_history (tenant_id, job_id, from_status, to_status, changed_by, changed_at, note)
  values (v_tenant_id, p_job_id, v_job.status, 'cancelled', auth.uid(), now(), v_reason);

  return jsonb_build_object(
    'id', p_job_id, 'status', 'cancelled',
    'downpayment_action', case when v_held > 0 then p_downpayment_action else null end,
    'downpayment_amount', v_held
  );
end;
$$;

grant execute on function public.cancel_job(uuid, text, text) to authenticated;

-- Drawer math: a cash downpayment counts on the shift that took it; when it later lands on the final
-- sale as a payment (job_downpayment_id set) it is skipped there. Refunds paid from this drawer
-- come out. Otherwise identical to 0077.
create or replace function public.get_shift_summary(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_shift record;
  v_cash_sales numeric(12, 2);
  v_cash_downpayments numeric(12, 2);
  v_downpayment_refunds numeric(12, 2);
  v_cash_in numeric(12, 2);
  v_cash_out numeric(12, 2);
  v_cash_expenses numeric(12, 2);
  v_cash_advances numeric(12, 2);
  v_by_method jsonb;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  select * into v_shift from public.cashier_shifts where id = p_shift_id and tenant_id = v_tenant_id;
  if v_shift.id is null then
    raise exception 'Shift not found';
  end if;

  if v_shift.cashier_id != public.current_employee_id() and not public.has_permission('can_review_shifts') then
    raise exception 'Not authorized to view this shift';
  end if;

  select coalesce(sum(p.amount) filter (where p.method = 'cash'), 0) into v_cash_sales
  from public.payments p
  join public.sales s on s.id = p.sale_id
  where s.shift_id = p_shift_id and s.status != 'voided' and p.job_downpayment_id is null;

  select coalesce(sum(amount), 0) into v_cash_downpayments
  from public.job_downpayments where shift_id = p_shift_id and method = 'cash';

  select coalesce(sum(amount), 0) into v_downpayment_refunds
  from public.job_downpayments where resolved_shift_id = p_shift_id and status = 'refunded' and method = 'cash';

  select coalesce(sum(amount) filter (where type = 'cash_in'), 0), coalesce(sum(amount) filter (where type = 'cash_out'), 0)
  into v_cash_in, v_cash_out
  from public.cash_movements where shift_id = p_shift_id;

  select coalesce(sum(amount), 0) into v_cash_expenses
  from public.expenses where shift_id = p_shift_id and payment_method = 'cash' and is_voided = false;

  select coalesce(sum(amount), 0) into v_cash_advances
  from public.cash_advances where shift_id = p_shift_id;

  -- Everything this shift actually took in, per method: sale payments (minus ones that were
  -- downpayments taken earlier) plus downpayments taken on this shift.
  select coalesce(jsonb_object_agg(method, total), '{}'::jsonb) into v_by_method
  from (
    select method, sum(amount) as total
    from (
      select p.method, p.amount
      from public.payments p
      join public.sales s on s.id = p.sale_id
      where s.shift_id = p_shift_id and s.status != 'voided' and p.job_downpayment_id is null
      union all
      select d.method, d.amount from public.job_downpayments d where d.shift_id = p_shift_id
    ) taken
    group by method
  ) x;

  return jsonb_build_object(
    'opening_float', v_shift.opening_float,
    'cash_sales', v_cash_sales,
    'cash_downpayments', v_cash_downpayments,
    'downpayment_refunds', v_downpayment_refunds,
    'cash_in', v_cash_in,
    'cash_out', v_cash_out,
    'cash_expenses', v_cash_expenses,
    'cash_advances', v_cash_advances,
    'expected_cash', v_shift.opening_float + v_cash_sales + v_cash_downpayments - v_downpayment_refunds
      + v_cash_in - v_cash_out - v_cash_expenses - v_cash_advances,
    'by_method', v_by_method
  );
end;
$$;

grant execute on function public.get_shift_summary(uuid) to authenticated;

-- create_sale(): identical to 0098 except the downpayment handling (declare, before the card fee,
-- and right after the payments insert).
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
  v_downpayment record;
  v_downpayment_sum numeric(12, 2) := 0;
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

  -- Downpayments already taken on this job count toward covering the total (and a card one
  -- toward the card fee). Locked so a concurrent record/refund can't slip in mid-sale.
  if v_job_id is not null then
    for v_downpayment in
      select id, method, amount from public.job_downpayments
      where job_id = v_job_id and tenant_id = v_tenant_id and status = 'held'
      for update
    loop
      v_downpayment_sum := v_downpayment_sum + v_downpayment.amount;
      if v_downpayment.method = 'card' then
        v_card_amount := v_card_amount + v_downpayment.amount;
      end if;
    end loop;

    if v_downpayment_sum > v_total + 0.01 then
      raise exception 'Downpayments (%) are more than the sale total (%) -- refund the extra downpayment from the Job Queue first', v_downpayment_sum, v_total;
    end if;

    v_payments_sum := v_payments_sum + v_downpayment_sum;
  end if;

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

  if v_downpayment_sum > 0 then
    insert into public.payments (tenant_id, sale_id, method, amount, reference_note, tendered_amount, change_given, recorded_by, paid_at, job_downpayment_id)
    select tenant_id, v_sale_id, method, amount, reference_note, tendered_amount, change_given, created_by, created_at, id
    from public.job_downpayments
    where job_id = v_job_id and tenant_id = v_tenant_id and status = 'held';

    update public.job_downpayments
    set status = 'applied', sale_id = v_sale_id, resolved_at = now(), resolved_by = v_created_by
    where job_id = v_job_id and tenant_id = v_tenant_id and status = 'held';
  end if;

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

-- void_sale(): identical to 0072 except downpayments return to 'held'.
create or replace function public.void_sale(p_sale_id uuid, p_reason text, p_reverse_commission boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_created_by uuid := auth.uid();
  v_reason text := trim(coalesce(p_reason, ''));
  v_sale record;
  v_item record;
  v_loyalty record;
  v_stamp record;
  v_comm record;
  v_comm_period_id uuid;
  v_comm_period_status text;
  v_comm_payroll_entry_id uuid;
  v_commission_reversed int := 0;
  v_commission_skipped int := 0;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_refund') then
    raise exception 'Not authorized to void transactions';
  end if;

  if v_reason = '' then
    raise exception 'A void reason is required';
  end if;

  select * into v_sale from public.sales where id = p_sale_id and tenant_id = v_tenant_id;
  if v_sale.id is null then
    raise exception 'Transaction not found';
  end if;

  if v_sale.status = 'voided' then
    raise exception 'This transaction is already voided';
  end if;

  update public.sales
  set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = v_reason
  where id = p_sale_id;

  for v_item in
    select item_id, quantity from public.sale_items where sale_id = p_sale_id and line_type = 'product'
  loop
    perform public.record_inventory_transaction(v_item.item_id, 'returned', v_item.quantity, null, 'sale_void', p_sale_id, v_reason);
  end loop;

  for v_loyalty in
    select transaction_type, points_delta from public.loyalty_transactions where sale_id = p_sale_id
  loop
    insert into public.loyalty_transactions (tenant_id, customer_id, transaction_type, points_delta, sale_id, created_by)
    values (v_tenant_id, v_sale.customer_id, v_loyalty.transaction_type, -v_loyalty.points_delta, p_sale_id, auth.uid());
  end loop;

  for v_stamp in
    select program_id, transaction_type, stamp_delta from public.membership_stamps where sale_id = p_sale_id
  loop
    insert into public.membership_stamps (tenant_id, customer_id, program_id, transaction_type, stamp_delta, sale_id, created_by)
    values (v_tenant_id, v_sale.customer_id, v_stamp.program_id, v_stamp.transaction_type, -v_stamp.stamp_delta, p_sale_id, auth.uid());
  end loop;

  if p_reverse_commission and v_sale.job_id is not null then
    for v_comm in
      select
        employee_id, job_service_id, service_id, commission_rate,
        sum(commission_amount) as net_amount,
        max(gross_service_amount) as gross_amount,
        (array_agg(commission_type order by created_at desc))[1] as commission_type,
        (array_agg(id order by created_at desc))[1] as latest_ledger_id
      from public.commission_ledger
      where job_id = v_sale.job_id
      group by employee_id, job_service_id, service_id, commission_rate
    loop
      if abs(v_comm.net_amount) < 0.01 then
        continue;
      end if;

      -- Every row in this group is claimed into the same payroll period in practice
      -- (generate_payroll_period() claims a whole date range per employee in one pass), so any one
      -- of them is representative.
      select payroll_period_id into v_comm_period_id
      from public.commission_ledger
      where job_id = v_sale.job_id and employee_id = v_comm.employee_id
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
        v_commission_skipped := v_commission_skipped + 1;
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
        v_tenant_id, v_comm.employee_id, v_sale.job_id, v_comm.job_service_id, v_comm.service_id,
        v_comm.gross_amount, v_comm.commission_type, v_comm.commission_rate, -v_comm.net_amount,
        case when v_comm_payroll_entry_id is not null then 'approved' else 'earned' end,
        case when v_comm_payroll_entry_id is not null then v_comm_period_id else null end,
        v_comm.latest_ledger_id, 'Commission reversed -- transaction voided: ' || v_reason, v_created_by
      );

      if v_comm_payroll_entry_id is not null then
        if v_comm_period_status = 'draft' then
          update public.payroll_entries set commission_total = commission_total - v_comm.net_amount where id = v_comm_payroll_entry_id;
        elsif v_comm_period_status = 'locked' then
          insert into public.payroll_adjustments (tenant_id, payroll_entry_id, amount, reason, created_by)
          values (v_tenant_id, v_comm_payroll_entry_id, -v_comm.net_amount, 'Commission reversed -- transaction voided: ' || v_reason, v_created_by);
        end if;
      end if;

      v_commission_reversed := v_commission_reversed + 1;
    end loop;
  end if;

  -- The job is unpaid again, so its downpayments go back to being held against it.
  update public.job_downpayments
  set status = 'held', sale_id = null, resolved_at = null, resolved_by = null
  where sale_id = p_sale_id and status = 'applied';

  return jsonb_build_object(
    'id', p_sale_id, 'status', 'voided',
    'commission_reversed_count', v_commission_reversed, 'commission_skipped_count', v_commission_skipped
  );
end;
$$;

grant execute on function public.void_sale(uuid, text, boolean) to authenticated;
