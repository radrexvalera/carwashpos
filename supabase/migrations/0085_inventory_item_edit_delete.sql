-- Inventory items had no edit or delete at all (only the is_active toggle). Same treatment as
-- update_service()/delete_service(): dedicated RPCs instead of a raw RLS-gated update/delete, so a
-- tenant/permission mismatch raises instead of silently affecting 0 rows. inventory_transactions/
-- purchase_order_items/service_recipe_items/sale_items all reference inventory_items with NO
-- ACTION on delete, so an item that's ever actually been used raises a foreign-key error -- caught
-- here and turned into a friendly message pointing at the existing inactive toggle instead.
create or replace function public.update_inventory_item(
  p_item_id uuid, p_name text, p_category_id uuid, p_item_type text, p_unit_id uuid,
  p_retail_price numeric, p_reorder_level numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_inventory') then
    raise exception 'Not authorized to edit inventory items';
  end if;

  if not exists (select 1 from public.inventory_items where id = p_item_id and tenant_id = v_tenant_id) then
    raise exception 'Inventory item not found';
  end if;

  if p_name is null or trim(p_name) = '' then
    raise exception 'Name is required';
  end if;

  if p_item_type not in ('retail', 'consumable', 'reusable_equipment', 'asset') then
    raise exception 'Unknown item_type %', p_item_type;
  end if;

  if not exists (select 1 from public.inventory_units where id = p_unit_id and tenant_id = v_tenant_id) then
    raise exception 'Unit not found';
  end if;

  if p_category_id is not null and not exists (
    select 1 from public.inventory_categories where id = p_category_id and tenant_id = v_tenant_id
  ) then
    raise exception 'Category not found';
  end if;

  update public.inventory_items
  set name = trim(p_name), category_id = p_category_id, item_type = p_item_type, unit_id = p_unit_id,
      retail_price = p_retail_price, reorder_level = p_reorder_level
  where id = p_item_id and tenant_id = v_tenant_id;

  return jsonb_build_object('id', p_item_id);
end;
$$;

grant execute on function public.update_inventory_item(uuid, text, uuid, text, uuid, numeric, numeric) to authenticated;

create or replace function public.delete_inventory_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_inventory') then
    raise exception 'Not authorized to delete inventory items';
  end if;

  if not exists (select 1 from public.inventory_items where id = p_item_id and tenant_id = v_tenant_id) then
    raise exception 'Inventory item not found';
  end if;

  begin
    delete from public.inventory_items where id = p_item_id and tenant_id = v_tenant_id;
  exception when foreign_key_violation then
    raise exception 'This item has stock history or has been used elsewhere and can''t be deleted -- set it inactive instead.';
  end;

  return jsonb_build_object('id', p_item_id, 'deleted', true);
end;
$$;

grant execute on function public.delete_inventory_item(uuid) to authenticated;
