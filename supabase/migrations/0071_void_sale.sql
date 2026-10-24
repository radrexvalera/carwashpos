-- Voids a sale (transaction) -- the sales/sale_items/payments rows are never deleted, only
-- flagged (same "ledger, not edit" discipline as every other financial record in this app). Once
-- voided:
--   * the job's billed service lines become billable again automatically -- create_sale()'s
--     "already billed" check already excludes voided sales, nothing else to touch there.
--   * the job itself goes back to "unpaid" and (if still open) editable again -- both
--     job_board_entries.is_paid and job_is_editable() already compute off "exists a non-voided
--     sale", so this falls out for free.
--   * close_shift()'s cash reconciliation already excludes voided sales too.
--   * retail stock this sale consumed is given back via a 'returned' inventory transaction.
--   * any loyalty points / membership stamps this sale earned or redeemed are reversed with a
--     compensating (negated) ledger row -- loyalty accrual is zeroed tenant-wide now and
--     membership redemption isn't reachable from the UI, so this only ever matters for an older
--     sale that predates that, but it's cheap and keeps those balances honest either way.
create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_reason text := trim(coalesce(p_reason, ''));
  v_sale record;
  v_item record;
  v_loyalty record;
  v_stamp record;
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

  return jsonb_build_object('id', p_sale_id, 'status', 'voided');
end;
$$;

grant execute on function public.void_sale(uuid, text) to authenticated;
