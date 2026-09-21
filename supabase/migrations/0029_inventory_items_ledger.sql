-- Consumable, retail item, reusable equipment, and asset all live in one table (item_type
-- distinguishes them) so a single ledger/UI covers both of the old car-wash POS's separate
-- "products" and "consumables" tables. Deliberately NO stock_qty column here -- on-hand quantity
-- is always derived from inventory_transactions (never a mutable running total that could drift
-- from the ledger it's meant to summarize), same discipline already applied to customers'
-- total_visits/spend. retail_price only means something for item_type='retail'; unit_cost is
-- likewise not stored here -- see inventory_stock_levels (next migration) for latest/average cost.
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid references public.inventory_categories(id),
  name text not null,
  sku text,
  item_type text not null check (item_type in ('retail', 'consumable', 'reusable_equipment', 'asset')),
  unit_id uuid not null references public.inventory_units(id),
  retail_price numeric(12, 2) check (retail_price is null or retail_price >= 0),
  min_stock numeric(12, 3),
  reorder_level numeric(12, 3),
  target_stock numeric(12, 3),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index inventory_items_tenant_id_idx on public.inventory_items(tenant_id);
create unique index inventory_items_tenant_sku_key on public.inventory_items(tenant_id, sku) where sku is not null;

-- The stock ledger (spec section 22). Every row is an immutable fact -- previous_qty/new_qty are
-- computed once, server-side, inside record_inventory_transaction() below, never client-supplied
-- and never edited afterward. A correction is a NEW row (transaction_type
-- 'adjustment_positive'/'adjustment_negative'/'manual_correction'/etc), never a change to an
-- existing one.
create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id),
  transaction_type text not null check (transaction_type in (
    'opening_balance', 'purchase', 'stock_in', 'service_consumption', 'retail_sale',
    'adjustment_positive', 'adjustment_negative', 'damaged', 'expired', 'lost', 'returned',
    'transfer', 'manual_correction'
  )),
  quantity_delta numeric(14, 4) not null,
  previous_qty numeric(14, 4) not null,
  new_qty numeric(14, 4) not null,
  unit_cost_at_time numeric(12, 4),
  reference_type text,
  reference_id uuid,
  reason text,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now()
);
create index inventory_transactions_tenant_id_idx on public.inventory_transactions(tenant_id);
create index inventory_transactions_item_id_idx on public.inventory_transactions(item_id, created_at);

-- The single path every stock change goes through, regardless of reason (purchase, consumption,
-- sale, damage, manual count correction, ...). Not exposed to authenticated directly -- callers
-- (adjust_inventory_stock, create_purchase_order, complete_job, create_sale) are the gated public
-- entrypoints; this just guarantees previous_qty/new_qty/quantity math can never be gotten wrong
-- or duplicated by having every write path recompute it independently.
create function public.record_inventory_transaction(
  p_item_id uuid,
  p_transaction_type text,
  p_quantity_delta numeric,
  p_unit_cost numeric default null,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_reason text default null
)
returns public.inventory_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_previous numeric(14, 4);
  v_new numeric(14, 4);
  v_row public.inventory_transactions;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not exists (select 1 from public.inventory_items where id = p_item_id and tenant_id = v_tenant_id) then
    raise exception 'Inventory item % not found for this tenant', p_item_id;
  end if;

  -- Serializes concurrent transactions against the SAME item within this transaction's scope, so
  -- two simultaneous job completions consuming the same consumable can't both read the same
  -- previous_qty and silently lose one delta.
  perform pg_advisory_xact_lock(hashtext(p_item_id::text));

  select coalesce(sum(quantity_delta), 0) into v_previous
  from public.inventory_transactions where item_id = p_item_id;

  v_new := v_previous + p_quantity_delta;

  insert into public.inventory_transactions (
    tenant_id, item_id, transaction_type, quantity_delta, previous_qty, new_qty,
    unit_cost_at_time, reference_type, reference_id, reason, created_by
  ) values (
    v_tenant_id, p_item_id, p_transaction_type, p_quantity_delta, v_previous, v_new,
    p_unit_cost, p_reference_type, p_reference_id, p_reason, auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- The only directly client-callable write path for a manual stock action (count correction,
-- damage, loss, etc.) -- purchases/consumption/sales go through their own dedicated flows instead.
create function public.adjust_inventory_stock(
  p_item_id uuid,
  p_transaction_type text,
  p_quantity_delta numeric,
  p_reason text
)
returns public.inventory_transactions
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('can_manage_inventory') then
    raise exception 'Not authorized to adjust inventory';
  end if;

  if p_transaction_type not in (
    'opening_balance', 'adjustment_positive', 'adjustment_negative', 'damaged', 'expired', 'lost',
    'returned', 'transfer', 'manual_correction'
  ) then
    raise exception 'Invalid manual transaction type %', p_transaction_type;
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required for a manual stock adjustment';
  end if;

  return public.record_inventory_transaction(p_item_id, p_transaction_type, p_quantity_delta, null, 'manual', null, p_reason);
end;
$$;

grant execute on function public.adjust_inventory_stock(uuid, text, numeric, text) to authenticated;

alter table public.inventory_items enable row level security;

create policy inventory_items_select on public.inventory_items
  for select using (tenant_id = public.current_tenant_id());

create policy inventory_items_insert on public.inventory_items
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_inventory'));

create policy inventory_items_update on public.inventory_items
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_inventory'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_inventory'));

alter table public.inventory_transactions enable row level security;

create policy inventory_transactions_select on public.inventory_transactions
  for select using (tenant_id = public.current_tenant_id());
-- No insert/update policy: only record_inventory_transaction() (security definer) writes here.
