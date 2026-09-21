import { supabase } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

type VehicleSizeClass = Database['public']['Tables']['vehicle_size_classes']['Row']
type Service = Database['public']['Tables']['services']['Row']
type ServicePrice = Database['public']['Tables']['service_prices']['Row']
type Bay = Database['public']['Tables']['bays']['Row']
type Location = Database['public']['Tables']['locations']['Row']

export async function listVehicleSizeClasses() {
  const { data, error } = await supabase
    .from('vehicle_size_classes')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data
}

export async function createVehicleSizeClass(input: {
  tenantId: string
  name: string
  sortOrder: number
}) {
  const { error } = await supabase.from('vehicle_size_classes').insert({
    tenant_id: input.tenantId,
    name: input.name,
    sort_order: input.sortOrder,
  })
  if (error) throw error
}

export async function setVehicleSizeClassActive(id: string, isActive: boolean) {
  const { error } = await supabase.from('vehicle_size_classes').update({ is_active: isActive }).eq('id', id)
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
  category: string | null
  defaultDurationMinutes: number | null
}) {
  const { error } = await supabase.from('services').insert({
    tenant_id: input.tenantId,
    name: input.name,
    category: input.category,
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
  vehicleSizeClassId: string
  price: number
}) {
  const { error } = await supabase.from('service_prices').upsert(
    {
      tenant_id: input.tenantId,
      service_id: input.serviceId,
      vehicle_size_class_id: input.vehicleSizeClassId,
      price: input.price,
    },
    { onConflict: 'service_id,vehicle_size_class_id' },
  )
  if (error) throw error
}

export async function listLocations() {
  const { data, error } = await supabase.from('locations').select('*').order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function listBays() {
  const { data, error } = await supabase.from('bays').select('*').order('sort_order', { ascending: true })
  if (error) throw error
  return data
}

export async function createBay(input: {
  tenantId: string
  locationId: string
  name: string
  sortOrder: number
}) {
  const { error } = await supabase.from('bays').insert({
    tenant_id: input.tenantId,
    location_id: input.locationId,
    name: input.name,
    sort_order: input.sortOrder,
  })
  if (error) throw error
}

export async function setBayActive(id: string, isActive: boolean) {
  const { error } = await supabase.from('bays').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}

export type { VehicleSizeClass, Service, ServicePrice, Bay, Location }
