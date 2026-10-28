import { supabase } from '@/lib/supabase/client'
import type { Database, Json } from '@/lib/supabase/types'

type InventoryCategory = Database['public']['Tables']['inventory_categories']['Row']
type InventoryUnit = Database['public']['Tables']['inventory_units']['Row']
type InventoryItem = Database['public']['Tables']['inventory_items']['Row']
type InventoryStockLevel = Database['public']['Views']['inventory_stock_levels']['Row']
type InventoryTransaction = Database['public']['Tables']['inventory_transactions']['Row']
type Supplier = Database['public']['Tables']['suppliers']['Row']
type PurchaseOrder = Database['public']['Tables']['purchase_orders']['Row']
type ServiceRecipeItem = Database['public']['Tables']['service_recipe_items']['Row']

export async function listInventoryCategories() {
  const { data, error } = await supabase.from('inventory_categories').select('*').order('sort_order', { ascending: true })
  if (error) throw error
  return data
}

export async function createInventoryCategory(input: { tenantId: string; name: string; sortOrder: number }) {
  const { error } = await supabase
    .from('inventory_categories')
    .insert({ tenant_id: input.tenantId, name: input.name, sort_order: input.sortOrder })
  if (error) throw error
}

export async function setInventoryCategoryActive(id: string, isActive: boolean) {
  const { error } = await supabase.from('inventory_categories').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}

export async function updateInventoryCategorySortOrder(id: string, sortOrder: number) {
  const { error } = await supabase.from('inventory_categories').update({ sort_order: sortOrder }).eq('id', id)
  if (error) throw error
}

export async function listInventoryUnits() {
  const { data, error } = await supabase.from('inventory_units').select('*').order('name', { ascending: true })
  if (error) throw error
  return data
}

export async function createInventoryUnit(input: {
  tenantId: string
  name: string
  abbreviation: string
  baseUnitId: string | null
  conversionFactor: number
}) {
  const { error } = await supabase.from('inventory_units').insert({
    tenant_id: input.tenantId,
    name: input.name,
    abbreviation: input.abbreviation,
    base_unit_id: input.baseUnitId,
    conversion_factor: input.conversionFactor,
  })
  if (error) throw error
}

export async function listStockLevels() {
  const { data, error } = await supabase.from('inventory_stock_levels').select('*').order('name', { ascending: true })
  if (error) throw error
  return data
}

// Enriches stock levels with each item's most recent supplier, derived from its latest
// 'purchase' transaction -- inventory_items has no supplier_id of its own (an item can be
// bought from different suppliers over time), so "the supplier" is always "the last one used".
export async function listStockLevelsWithSupplier() {
  const items = await listStockLevels()

  const itemIds = (items ?? []).map((i) => i.id)
  const { data: purchases, error: purchasesError } = itemIds.length
    ? await supabase
        .from('inventory_transactions')
        .select('item_id, reference_id, created_at')
        .eq('transaction_type', 'purchase')
        .eq('reference_type', 'purchase_order')
        .in('item_id', itemIds)
        .order('created_at', { ascending: false })
    : { data: [], error: null }
  if (purchasesError) throw purchasesError

  const poIds = [...new Set((purchases ?? []).map((p) => p.reference_id).filter((id): id is string => !!id))]
  const { data: orders, error: ordersError } = poIds.length
    ? await supabase.from('purchase_orders').select('id, supplier_id').in('id', poIds)
    : { data: [], error: null }
  if (ordersError) throw ordersError
  const supplierIdByOrderId = new Map((orders ?? []).map((o) => [o.id, o.supplier_id]))

  const supplierIds = [...new Set((orders ?? []).map((o) => o.supplier_id))]
  const { data: suppliers, error: suppliersError } = supplierIds.length
    ? await supabase.from('suppliers').select('id, name').in('id', supplierIds)
    : { data: [], error: null }
  if (suppliersError) throw suppliersError
  const supplierNameById = new Map((suppliers ?? []).map((s) => [s.id, s.name]))

  const lastSupplierByItemId = new Map<string, string>()
  for (const p of purchases ?? []) {
    if (lastSupplierByItemId.has(p.item_id)) continue
    const supplierId = p.reference_id ? supplierIdByOrderId.get(p.reference_id) : undefined
    if (supplierId) lastSupplierByItemId.set(p.item_id, supplierNameById.get(supplierId) ?? 'Unknown supplier')
  }

  return (items ?? []).map((row) => ({ ...row, lastSupplierName: lastSupplierByItemId.get(row.id) ?? null }))
}

export async function createInventoryItem(input: {
  tenantId: string
  categoryId: string | null
  name: string
  sku: string | null
  itemType: 'retail' | 'consumable' | 'reusable_equipment' | 'asset'
  unitId: string
  retailPrice: number | null
  minStock: number | null
  reorderLevel: number | null
  targetStock: number | null
}) {
  const { error } = await supabase.from('inventory_items').insert({
    tenant_id: input.tenantId,
    category_id: input.categoryId,
    name: input.name,
    sku: input.sku,
    item_type: input.itemType,
    unit_id: input.unitId,
    retail_price: input.retailPrice,
    min_stock: input.minStock,
    reorder_level: input.reorderLevel,
    target_stock: input.targetStock,
  })
  if (error) throw error
}

export async function setInventoryItemActive(id: string, isActive: boolean) {
  const { error } = await supabase.from('inventory_items').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}

export async function updateInventoryItem(input: {
  id: string
  name: string
  categoryId: string | null
  itemType: 'retail' | 'consumable' | 'reusable_equipment' | 'asset'
  unitId: string
  retailPrice: number | null
  reorderLevel: number | null
}) {
  const { error } = await supabase.rpc('update_inventory_item', {
    p_item_id: input.id,
    p_name: input.name,
    p_category_id: input.categoryId,
    p_item_type: input.itemType,
    p_unit_id: input.unitId,
    p_retail_price: input.retailPrice,
    p_reorder_level: input.reorderLevel,
  })
  if (error) throw error
}

export async function deleteInventoryItem(id: string) {
  const { error } = await supabase.rpc('delete_inventory_item', { p_item_id: id })
  if (error) throw error
}

export async function adjustInventoryStock(input: { itemId: string; transactionType: string; quantityDelta: number; reason: string }) {
  const { error } = await supabase.rpc('adjust_inventory_stock', {
    p_item_id: input.itemId,
    p_transaction_type: input.transactionType,
    p_quantity_delta: input.quantityDelta,
    p_reason: input.reason,
  })
  if (error) throw error
}

export async function listItemTransactions(itemId: string) {
  const { data, error } = await supabase
    .from('inventory_transactions')
    .select('*')
    .eq('item_id', itemId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data
}

export async function listSuppliers() {
  const { data, error } = await supabase.from('suppliers').select('*').order('name', { ascending: true })
  if (error) throw error
  return data
}

export async function createSupplier(input: { tenantId: string; name: string; contactPerson: string | null; mobile: string | null }) {
  const { error } = await supabase
    .from('suppliers')
    .insert({ tenant_id: input.tenantId, name: input.name, contact_person: input.contactPerson, mobile: input.mobile })
  if (error) throw error
}

// Manual joins (not an embedded select) for the same reason as everywhere else in this codebase --
// types.ts's hand-written Relationships are empty. Adds the supplier name and a short items summary
// so the Recent purchases list is actually readable, not just a bare date/reference/total row.
export async function listPurchaseOrders() {
  const { data: orders, error } = await supabase.from('purchase_orders').select('*').order('created_at', { ascending: false })
  if (error) throw error

  const supplierIds = [...new Set((orders ?? []).map((o) => o.supplier_id))]
  const { data: suppliers, error: suppliersError } = supplierIds.length
    ? await supabase.from('suppliers').select('id, name').in('id', supplierIds)
    : { data: [], error: null }
  if (suppliersError) throw suppliersError
  const supplierNameById = new Map((suppliers ?? []).map((s) => [s.id, s.name]))

  const orderIds = (orders ?? []).map((o) => o.id)
  const { data: lines, error: linesError } = orderIds.length
    ? await supabase.from('purchase_order_items').select('purchase_order_id, item_id, quantity').in('purchase_order_id', orderIds)
    : { data: [], error: null }
  if (linesError) throw linesError

  const itemIds = [...new Set((lines ?? []).map((l) => l.item_id))]
  const { data: inventoryItems, error: itemsError } = itemIds.length
    ? await supabase.from('inventory_items').select('id, name').in('id', itemIds)
    : { data: [], error: null }
  if (itemsError) throw itemsError
  const itemNameById = new Map((inventoryItems ?? []).map((i) => [i.id, i.name]))

  const linesByOrderId = new Map<string, string[]>()
  for (const l of lines ?? []) {
    const list = linesByOrderId.get(l.purchase_order_id) ?? []
    list.push(`${itemNameById.get(l.item_id) ?? 'Item'} ×${l.quantity}`)
    linesByOrderId.set(l.purchase_order_id, list)
  }

  return (orders ?? []).map((o) => ({
    ...o,
    supplierName: supplierNameById.get(o.supplier_id) ?? 'Unknown supplier',
    itemsSummary: (linesByOrderId.get(o.id) ?? []).join(', '),
  }))
}

const REFERENCE_TYPE_LABELS: Record<string, string> = {
  purchase_order: 'Purchase order',
  sale: 'Sale',
  job_service: 'Job service',
  manual: 'Manual',
}

const INVENTORY_LOGS_PAGE_SIZE = 100

// Tenant-wide feed over inventory_transactions (the append-only stock ledger) so stock changes
// are auditable in one place instead of only per-item inside the Adjust dialog's history list.
// Paginated (oldest-first offset) rather than a single hard cap, so older history -- purchases,
// adjustments, consumption from months back -- stays reachable via "Load more", not truncated.
export async function listInventoryLogs(itemId?: string, page = 0) {
  let query = supabase
    .from('inventory_transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .range(page * INVENTORY_LOGS_PAGE_SIZE, page * INVENTORY_LOGS_PAGE_SIZE + INVENTORY_LOGS_PAGE_SIZE - 1)
  if (itemId) query = query.eq('item_id', itemId)
  const { data, error } = await query
  if (error) throw error
  const hasMore = (data ?? []).length === INVENTORY_LOGS_PAGE_SIZE

  const itemIds = [...new Set((data ?? []).map((t) => t.item_id))]
  const { data: itemsData, error: itemsError } = itemIds.length
    ? await supabase.from('inventory_items').select('id, name').in('id', itemIds)
    : { data: [], error: null }
  if (itemsError) throw itemsError
  const itemNameById = new Map((itemsData ?? []).map((i) => [i.id, i.name]))

  const userIds = [...new Set((data ?? []).map((t) => t.created_by))]
  const { data: users, error: usersError } = userIds.length
    ? await supabase.from('user_profiles').select('id, full_name').in('id', userIds)
    : { data: [], error: null }
  if (usersError) throw usersError
  const userNameById = new Map((users ?? []).map((u) => [u.id, u.full_name]))

  const poIds = [
    ...new Set(
      (data ?? [])
        .filter((t) => t.reference_type === 'purchase_order' && t.reference_id)
        .map((t) => t.reference_id as string),
    ),
  ]
  const { data: orders, error: ordersError } = poIds.length
    ? await supabase.from('purchase_orders').select('id, reference_number').in('id', poIds)
    : { data: [], error: null }
  if (ordersError) throw ordersError
  const poRefById = new Map((orders ?? []).map((o) => [o.id, o.reference_number]))

  return {
    rows: (data ?? []).map((t) => ({
      ...t,
      itemName: itemNameById.get(t.item_id) ?? 'Unknown item',
      createdByName: userNameById.get(t.created_by) ?? 'Unknown',
      referenceLabel:
        t.reference_type === 'purchase_order' && t.reference_id && poRefById.get(t.reference_id)
          ? `Purchase order ${poRefById.get(t.reference_id)}`
          : (t.reference_type && REFERENCE_TYPE_LABELS[t.reference_type]) || '—',
    })),
    hasMore,
  }
}

export async function createPurchaseOrder(input: {
  supplierId: string
  referenceNumber: string | null
  orderDate: string
  deliveryCharge: number
  items: { itemId: string; quantity: number; unitCost: number; discountAmount: number }[]
}) {
  const payload = {
    supplier_id: input.supplierId,
    reference_number: input.referenceNumber,
    order_date: input.orderDate,
    delivery_charge: input.deliveryCharge,
    items: input.items.map((i) => ({
      item_id: i.itemId,
      quantity: i.quantity,
      unit_cost: i.unitCost,
      discount_amount: i.discountAmount,
    })),
  }
  const { data, error } = await supabase.rpc('create_purchase_order', { payload: payload as unknown as Json })
  if (error) throw error
  return data as { id: string; total: number }
}

export async function listServiceRecipeItems(serviceId: string) {
  const { data, error } = await supabase.from('service_recipe_items').select('*').eq('service_id', serviceId)
  if (error) throw error
  return data
}

export async function addServiceRecipeItem(input: {
  tenantId: string
  serviceId: string
  vehicleSizeId: string | null
  itemId: string
  quantityUsed: number
}) {
  const { error } = await supabase.from('service_recipe_items').insert({
    tenant_id: input.tenantId,
    service_id: input.serviceId,
    vehicle_size_id: input.vehicleSizeId,
    item_id: input.itemId,
    quantity_used: input.quantityUsed,
  })
  if (error) throw error
}

export async function deleteServiceRecipeItem(id: string) {
  const { error } = await supabase.from('service_recipe_items').delete().eq('id', id)
  if (error) throw error
}

export type {
  InventoryCategory,
  InventoryUnit,
  InventoryItem,
  InventoryStockLevel,
  InventoryTransaction,
  Supplier,
  PurchaseOrder,
  ServiceRecipeItem,
}
