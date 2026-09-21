-- Atomically records a purchase order and posts one 'purchase' ledger transaction per line item
-- via record_inventory_transaction() -- stock-in and the financial record are the same action,
-- never two steps that could get out of sync.
create or replace function public.create_purchase_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_created_by uuid := auth.uid();
  v_po_id uuid := gen_random_uuid();
  v_supplier_id uuid := (payload ->> 'supplier_id')::uuid;
  v_line jsonb;
  v_quantity numeric(14, 4);
  v_unit_cost numeric(12, 4);
  v_discount numeric(12, 2);
  v_line_total numeric(12, 2);
  v_subtotal numeric(12, 2) := 0;
  v_discount_total numeric(12, 2) := 0;
  v_delivery_charge numeric(12, 2) := coalesce((payload ->> 'delivery_charge')::numeric, 0);
  v_total numeric(12, 2);
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_inventory') then
    raise exception 'Not authorized to record purchases';
  end if;

  if v_supplier_id is null or not exists (select 1 from public.suppliers where id = v_supplier_id and tenant_id = v_tenant_id) then
    raise exception 'Supplier not found';
  end if;

  if jsonb_array_length(coalesce(payload -> 'items', '[]'::jsonb)) = 0 then
    raise exception 'A purchase order needs at least one item';
  end if;

  for v_line in select * from jsonb_array_elements(payload -> 'items')
  loop
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_cost := (v_line ->> 'unit_cost')::numeric;
    v_discount := coalesce((v_line ->> 'discount_amount')::numeric, 0);

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Item quantity must be positive';
    end if;
    if v_unit_cost is null or v_unit_cost < 0 then
      raise exception 'Item unit cost must be non-negative';
    end if;

    v_line_total := round(v_quantity * v_unit_cost - v_discount, 2);
    v_subtotal := v_subtotal + (v_quantity * v_unit_cost);
    v_discount_total := v_discount_total + v_discount;
  end loop;

  v_total := round(v_subtotal - v_discount_total + v_delivery_charge, 2);

  insert into public.purchase_orders (
    id, tenant_id, supplier_id, reference_number, order_date, subtotal, discount_total,
    delivery_charge, total, created_by
  ) values (
    v_po_id, v_tenant_id, v_supplier_id, payload ->> 'reference_number',
    coalesce((payload ->> 'order_date')::date, current_date), v_subtotal, v_discount_total,
    v_delivery_charge, v_total, v_created_by
  );

  for v_line in select * from jsonb_array_elements(payload -> 'items')
  loop
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_cost := (v_line ->> 'unit_cost')::numeric;
    v_discount := coalesce((v_line ->> 'discount_amount')::numeric, 0);
    v_line_total := round(v_quantity * v_unit_cost - v_discount, 2);

    insert into public.purchase_order_items (tenant_id, purchase_order_id, item_id, quantity, unit_cost, discount_amount, line_total)
    values (v_tenant_id, v_po_id, (v_line ->> 'item_id')::uuid, v_quantity, v_unit_cost, v_discount, v_line_total);

    perform public.record_inventory_transaction(
      (v_line ->> 'item_id')::uuid, 'purchase', v_quantity, v_unit_cost, 'purchase_order', v_po_id, null
    );
  end loop;

  return jsonb_build_object('id', v_po_id, 'total', v_total);
end;
$$;

grant execute on function public.create_purchase_order(jsonb) to authenticated;
