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

export async function listPurchaseOrders() {
  const { data, error } = await supabase.from('purchase_orders').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data
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
