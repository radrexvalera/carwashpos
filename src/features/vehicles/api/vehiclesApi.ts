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
