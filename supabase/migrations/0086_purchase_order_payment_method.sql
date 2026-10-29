-- Purchase orders had no payment method of their own -- the auto-created expense (0084) always
-- hardcoded 'cash', even though a purchase might actually be paid via GCash, bank transfer, etc.
-- Reuses the exact same method list as expenses.payment_method so the two stay interchangeable.
alter table public.purchase_orders add column payment_method text not null default 'cash'
  check (payment_method in ('cash', 'gcash', 'maya', 'bank_transfer', 'card', 'maribank', 'gotyme', 'rcbc', 'bpi', 'unionbank', 'qrph'));

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
  v_supplier_name text;
  v_payment_method text := coalesce(payload ->> 'payment_method', 'cash');
  v_line jsonb;
  v_quantity numeric(14, 4);
  v_unit_cost numeric(12, 4);
  v_discount numeric(12, 2);
  v_line_total numeric(12, 2);
  v_subtotal numeric(12, 2) := 0;
  v_discount_total numeric(12, 2) := 0;
  v_delivery_charge numeric(12, 2) := coalesce((payload ->> 'delivery_charge')::numeric, 0);
  v_total numeric(12, 2);
  v_category_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_inventory') then
    raise exception 'Not authorized to record purchases';
  end if;

  if v_payment_method not in ('cash', 'gcash', 'maya', 'bank_transfer', 'card', 'maribank', 'gotyme', 'rcbc', 'bpi', 'unionbank', 'qrph') then
    raise exception 'Unknown payment_method %', v_payment_method;
  end if;

  select name into v_supplier_name from public.suppliers where id = v_supplier_id and tenant_id = v_tenant_id;
  if v_supplier_name is null then
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
    delivery_charge, total, payment_method, created_by
  ) values (
    v_po_id, v_tenant_id, v_supplier_id, payload ->> 'reference_number',
    coalesce((payload ->> 'order_date')::date, current_date), v_subtotal, v_discount_total,
    v_delivery_charge, v_total, v_payment_method, v_created_by
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

  if v_total > 0 then
    select id into v_category_id from public.expense_categories
    where tenant_id = v_tenant_id and name = 'Inventory Purchases';

    if v_category_id is null then
      insert into public.expense_categories (tenant_id, name, sort_order, is_active)
      values (v_tenant_id, 'Inventory Purchases', 999, true)
      returning id into v_category_id;
    end if;

    insert into public.expenses (
      tenant_id, category_id, description, amount, expense_date, payment_method, paid_to, created_by
    ) values (
      v_tenant_id, v_category_id,
      'Purchase order' || coalesce(' ' || (payload ->> 'reference_number'), '') || ' from ' || v_supplier_name,
      v_total, coalesce((payload ->> 'order_date')::date, current_date), v_payment_method, v_supplier_name, v_created_by
    );
  end if;

  return jsonb_build_object('id', v_po_id, 'total', v_total);
end;
$$;

grant execute on function public.create_purchase_order(jsonb) to authenticated;
