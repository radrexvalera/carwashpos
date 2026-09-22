import { supabase } from '@/lib/supabase/client'

// Registering a new vehicle/customer is online-only for now (unlike ringing up a known plate,
// which reads from the offline cache) -- a reasonable v1 scope line, since it's a comparatively
// rare action (most transactions are repeat vehicles) and keeps the outbox from having to also
// reconcile brand-new vehicle/customer records created on multiple offline devices.

export async function createCustomer(input: { tenantId: string; fullName: string; mobile: string | null }) {
  const { data, error } = await supabase
    .from('customers')
    .insert({ tenant_id: input.tenantId, full_name: input.fullName, mobile: input.mobile })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

// Plain online search (unlike RegisterPage's Dexie-backed local cache) -- appointments are
// booked ahead of time, an inherently online administrative action, same as everything else in
// this feature. Manual join (not a nested select) since this codebase's hand-written types.ts
// doesn't model embedded relations.
export async function searchVehicles(query: string) {
  if (!query.trim()) return []
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .ilike('plate_number', `%${query.trim()}%`)
    .eq('is_active', true)
    .limit(10)
  if (error) throw error

  const customerIds = [...new Set((data ?? []).map((v) => v.customer_id).filter((id): id is string => !!id))]
  const { data: customers, error: customerError } = customerIds.length
    ? await supabase.from('customers').select('id, full_name').in('id', customerIds)
    : { data: [] as { id: string; full_name: string }[], error: null }
  if (customerError) throw customerError
  const nameByCustomer = new Map((customers ?? []).map((c) => [c.id, c.full_name]))

  return (data ?? []).map((v) => ({ ...v, customerName: v.customer_id ? (nameByCustomer.get(v.customer_id) ?? null) : null }))
}

export async function createVehicle(input: {
  tenantId: string
  customerId: string | null
  plateNumber: string
  make: string | null
  model: string | null
  color: string | null
  vehicleType: string | null
  vehicleSizeId: string | null
}) {
  const { data, error } = await supabase
    .from('vehicles')
    .insert({
      tenant_id: input.tenantId,
      customer_id: input.customerId,
      plate_number: input.plateNumber,
      make: input.make,
      model: input.model,
      color: input.color,
      vehicle_type: input.vehicleType,
      vehicle_size_id: input.vehicleSizeId,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}
