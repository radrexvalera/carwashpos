import { supabase } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

type VehicleSize = Database['public']['Tables']['vehicle_sizes']['Row']
type ServiceCategory = Database['public']['Tables']['service_categories']['Row']
type Service = Database['public']['Tables']['services']['Row']
type ServicePrice = Database['public']['Tables']['service_prices']['Row']
type Bay = Database['public']['Tables']['wash_bays']['Row']
type Location = Database['public']['Tables']['locations']['Row']

export async function listVehicleSizes() {
  const { data, error } = await supabase.from('vehicle_sizes').select('*').order('sort_order', { ascending: true })
  if (error) throw error
  return data
}

export async function createVehicleSize(input: { tenantId: string; name: string; sortOrder: number }) {
  const { error } = await supabase.from('vehicle_sizes').insert({
    tenant_id: input.tenantId,
    name: input.name,
    sort_order: input.sortOrder,
  })
  if (error) throw error
}

export async function setVehicleSizeActive(id: string, isActive: boolean) {
  const { error } = await supabase.from('vehicle_sizes').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}

export async function updateVehicleSizeSortOrder(id: string, sortOrder: number) {
  const { error } = await supabase.from('vehicle_sizes').update({ sort_order: sortOrder }).eq('id', id)
  if (error) throw error
}

export async function listServiceCategories() {
  const { data, error } = await supabase.from('service_categories').select('*').order('sort_order', { ascending: true })
  if (error) throw error
  return data
}

export async function createServiceCategory(input: { tenantId: string; name: string; sortOrder: number; isCarwash: boolean }) {
  const { error } = await supabase.from('service_categories').insert({
    tenant_id: input.tenantId,
    name: input.name,
    sort_order: input.sortOrder,
    is_carwash: input.isCarwash,
  })
  if (error) throw error
}

export async function setServiceCategoryActive(id: string, isActive: boolean) {
  const { error } = await supabase.from('service_categories').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}

export async function setServiceCategoryCarwash(id: string, isCarwash: boolean) {
  const { error } = await supabase.from('service_categories').update({ is_carwash: isCarwash }).eq('id', id)
  if (error) throw error
}

export async function updateServiceCategorySortOrder(id: string, sortOrder: number) {
  const { error } = await supabase.from('service_categories').update({ sort_order: sortOrder }).eq('id', id)
  if (error) throw error
}

export async function listServices() {
  const { data, error } = await supabase.from('services').select('*').order('name', { ascending: true })
  if (error) throw error
  return data
}

export async function createService(input: {
  tenantId: string
  name: string
  categoryId: string | null
  defaultDurationMinutes: number | null
}) {
  const { error } = await supabase.from('services').insert({
    tenant_id: input.tenantId,
    name: input.name,
    category_id: input.categoryId,
    default_duration_minutes: input.defaultDurationMinutes,
  })
  if (error) throw error
}

export async function setServiceActive(id: string, isActive: boolean) {
  const { error } = await supabase.from('services').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}

export async function listServicePrices() {
  const { data, error } = await supabase.from('service_prices').select('*')
  if (error) throw error
  return data
}

export async function upsertServicePrice(input: {
  tenantId: string
  serviceId: string
  vehicleSizeId: string
  price: number
}) {
  const { error } = await supabase.from('service_prices').upsert(
    {
      tenant_id: input.tenantId,
      service_id: input.serviceId,
      vehicle_size_id: input.vehicleSizeId,
      price: input.price,
    },
    { onConflict: 'service_id,vehicle_size_id' },
  )
  if (error) throw error
}

export async function listLocations() {
  const { data, error } = await supabase.from('locations').select('*').order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function listBays() {
  const { data, error } = await supabase.from('wash_bays').select('*').order('sort_order', { ascending: true })
  if (error) throw error
  return data
}

export async function createBay(input: {
  tenantId: string
  locationId: string
  name: string
  sortOrder: number
}) {
  const { error } = await supabase.from('wash_bays').insert({
    tenant_id: input.tenantId,
    location_id: input.locationId,
    name: input.name,
    sort_order: input.sortOrder,
  })
  if (error) throw error
}

export async function setBayActive(id: string, isActive: boolean) {
  const { error } = await supabase.from('wash_bays').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}

export async function deleteBay(id: string) {
  const { error } = await supabase.rpc('delete_bay', { p_bay_id: id })
  if (error) throw error
}

export async function updateBaySortOrder(id: string, sortOrder: number) {
  const { error } = await supabase.from('wash_bays').update({ sort_order: sortOrder }).eq('id', id)
  if (error) throw error
}

export type { VehicleSize, ServiceCategory, Service, ServicePrice, Bay, Location }
