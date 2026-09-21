-- The single atomic entrypoint for ringing up a sale, called by the POS live or via the offline
-- sync-queue flush. Prices every line item server-side (never trusts a client-supplied price),
-- validates payments sum to the total, assigns the ticket number, and applies stock/consumable
-- deltas -- all in one transaction. SECURITY DEFINER so it can decrement products/consumables
-- regardless of the calling cashier's own (admin/manager-only) catalog UPDATE permissions, since
-- this is a controlled side effect of a sale, not a catalog edit.
create or replace function public.complete_ticket(payload jsonb)
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
  v_existing_ticket_id uuid;
  v_ticket_id uuid := gen_random_uuid();
  v_ticket_number bigint;
  v_subtotal numeric(10, 2) := 0;
  v_total numeric(10, 2);
  v_payments_sum numeric(10, 2) := 0;
  v_enriched_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_payment jsonb;
  v_quantity numeric(10, 2);
  v_unit_price numeric(10, 2);
  v_line_total numeric(10, 2);
  v_bom record;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if v_client_generated_id is null then
    raise exception 'client_generated_id is required';
  end if;

  -- Idempotent retry: if this exact offline mutation already landed (e.g. the client never saw
  -- the response and re-flushed it), return the existing ticket instead of erroring or duplicating.
  select id into v_existing_ticket_id
  from public.tickets
  where tenant_id = v_tenant_id and client_generated_id = v_client_generated_id;

  if v_existing_ticket_id is not null then
    return (
      select jsonb_build_object(
        'id', t.id, 'ticket_number', t.ticket_number, 'status', t.status,
        'subtotal', t.subtotal, 'total', t.total, 'created_at', t.created_at
      )
      from public.tickets t
      where t.id = v_existing_ticket_id
    );
  end if;

  select id into v_location_id from public.locations where tenant_id = v_tenant_id limit 1;
  if v_location_id is null then
    raise exception 'Tenant has no location configured';
  end if;

  if jsonb_array_length(coalesce(payload -> 'line_items', '[]'::jsonb)) = 0 then
    raise exception 'A ticket needs at least one line item';
  end if;

  -- Pass 1: price every line item server-side and accumulate the subtotal. Nothing is written yet
  -- -- payment validation below needs the final total first.
  for v_line in select * from jsonb_array_elements(payload -> 'line_items')
  loop
    v_quantity := coalesce((v_line ->> 'quantity')::numeric, 1);
    if v_quantity <= 0 then
      raise exception 'Line item quantity must be positive';
    end if;

    if v_line ->> 'line_type' = 'service' then
      select price into v_unit_price
      from public.service_prices
      where tenant_id = v_tenant_id
        and service_id = (v_line ->> 'service_id')::uuid
        and vehicle_size_class_id = (v_line ->> 'vehicle_size_class_id')::uuid
        and is_active = true;

      if v_unit_price is null then
        raise exception 'No active price for service % at vehicle size %',
          v_line ->> 'service_id', v_line ->> 'vehicle_size_class_id';
      end if;
    elsif v_line ->> 'line_type' = 'product' then
      select price into v_unit_price
      from public.products
      where tenant_id = v_tenant_id and id = (v_line ->> 'product_id')::uuid and is_active = true;

      if v_unit_price is null then
        raise exception 'No active product %', v_line ->> 'product_id';
      end if;
    else
      raise exception 'Unknown line_type %', v_line ->> 'line_type';
    end if;

    v_line_total := round(v_unit_price * v_quantity, 2);
    v_subtotal := v_subtotal + v_line_total;

    v_enriched_lines := v_enriched_lines || jsonb_build_array(
      v_line || jsonb_build_object('unit_price', v_unit_price, 'line_total', v_line_total)
    );
  end loop;

  -- discount_total/tax_total stay 0 until promotions (Phase 5) and tax configuration exist.
  v_total := v_subtotal;

  for v_payment in select * from jsonb_array_elements(coalesce(payload -> 'payments', '[]'::jsonb))
  loop
    v_payments_sum := v_payments_sum + (v_payment ->> 'amount')::numeric;
  end loop;

  if abs(v_payments_sum - v_total) > 0.01 then
    raise exception 'Payments (%) do not cover the ticket total (%)', v_payments_sum, v_total;
  end if;

  insert into public.tenant_ticket_counters (tenant_id, next_number)
  values (v_tenant_id, 2)
  on conflict (tenant_id) do update set next_number = tenant_ticket_counters.next_number + 1
  returning next_number - 1 into v_ticket_number;

  insert into public.tickets (
    id, tenant_id, location_id, client_generated_id, ticket_number, status,
    subtotal, discount_total, tax_total, total, created_by
  ) values (
    v_ticket_id, v_tenant_id, v_location_id, v_client_generated_id, v_ticket_number, 'waiting',
    v_subtotal, 0, 0, v_total, v_created_by
  );

  -- Pass 2: insert the priced line items and apply stock/consumable deltas as relative decrements
  -- (never absolute writes) -- this is what makes two offline cashiers safe to sync in either order.
  for v_line in select * from jsonb_array_elements(v_enriched_lines)
  loop
    v_unit_price := (v_line ->> 'unit_price')::numeric;
    v_line_total := (v_line ->> 'line_total')::numeric;
    v_quantity := (v_line ->> 'quantity')::numeric;

    if v_line ->> 'line_type' = 'service' then
      insert into public.ticket_line_items (
        tenant_id, ticket_id, line_type, service_id, vehicle_size_class_id, unit_price, quantity, line_total
      ) values (
        v_tenant_id, v_ticket_id, 'service',
        (v_line ->> 'service_id')::uuid, (v_line ->> 'vehicle_size_class_id')::uuid,
        v_unit_price, v_quantity, v_line_total
      );

      for v_bom in
        select consumable_id, quantity_used from public.service_bom
        where tenant_id = v_tenant_id and service_id = (v_line ->> 'service_id')::uuid
      loop
        update public.consumables
        set stock_qty_book = stock_qty_book - (v_bom.quantity_used * v_quantity)
        where id = v_bom.consumable_id and tenant_id = v_tenant_id;
      end loop;
    else
      insert into public.ticket_line_items (
        tenant_id, ticket_id, line_type, product_id, unit_price, quantity, line_total
      ) values (
        v_tenant_id, v_ticket_id, 'product', (v_line ->> 'product_id')::uuid,
        v_unit_price, v_quantity, v_line_total
      );

      -- Allowed to go negative -- soft-warn only, enforced client-side against the cached stock
      -- figure, never blocked server-side. See plan doc "Confirmed Design Decisions" #6.
      update public.products
      set stock_qty = stock_qty - v_quantity
      where id = (v_line ->> 'product_id')::uuid and tenant_id = v_tenant_id;
    end if;
  end loop;

  for v_payment in select * from jsonb_array_elements(coalesce(payload -> 'payments', '[]'::jsonb))
  loop
    insert into public.ticket_payments (tenant_id, ticket_id, method, amount, reference_note, recorded_by)
    values (
      v_tenant_id, v_ticket_id, v_payment ->> 'method', (v_payment ->> 'amount')::numeric,
      v_payment ->> 'reference_note', v_created_by
    );
  end loop;

  return jsonb_build_object(
    'id', v_ticket_id, 'ticket_number', v_ticket_number, 'status', 'waiting',
    'subtotal', v_subtotal, 'total', v_total, 'created_at', now()
  );
end;
$$;

grant execute on function public.complete_ticket(jsonb) to authenticated;
