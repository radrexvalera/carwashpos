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

export async function getVehicle(vehicleId: string) {
  const { data, error } = await supabase.from('vehicles').select('*').eq('id', vehicleId).single()
  if (error) throw error
  return data
}

export async function updateVehicle(
  vehicleId: string,
  input: { plateNumber: string; make: string | null; model: string | null; color: string | null; vehicleSizeId: string | null },
) {
  const { error } = await supabase
    .from('vehicles')
    .update({
      plate_number: input.plateNumber,
      make: input.make,
      model: input.model,
      color: input.color,
      vehicle_size_id: input.vehicleSizeId,
      // Any manual edit through this form confirms whatever's now in the Plate field is a real
      // plate, not a stand-in -- clears the flag even if the text happens to be unchanged.
      plate_is_placeholder: false,
    })
    .eq('id', vehicleId)
  if (error) throw error
}

// A vehicle with no plate yet (brand new, not yet registered) still needs a unique identifier --
// unique(tenant_id, plate_number) is unchanged, so the customer's name is stored INTO plate_number
// itself when no real plate is given, deduped with a "(2)", "(3)", ... suffix on collision. Every
// existing display site that just shows plate_number as a string keeps working unchanged;
// plate_is_placeholder is purely a marker for the couple of UI spots that want to say "no plate".
export async function createVehicle(input: {
  tenantId: string
  customerId: string | null
  plateNumber: string | null
  placeholderBase?: string | null
  make: string | null
  model: string | null
  color: string | null
  vehicleType: string | null
  vehicleSizeId: string | null
}) {
  const realPlate = input.plateNumber?.trim()
  if (realPlate) {
    const { data, error } = await supabase
      .from('vehicles')
      .insert({
        tenant_id: input.tenantId,
        customer_id: input.customerId,
        plate_number: realPlate,
        make: input.make,
        model: input.model,
        color: input.color,
        vehicle_type: input.vehicleType,
        vehicle_size_id: input.vehicleSizeId,
        plate_is_placeholder: false,
      })
      .select('id')
      .single()
    if (error) throw error
    return { id: data.id, plateNumber: realPlate, plateIsPlaceholder: false }
  }

  const base = (input.placeholderBase || 'WALK-IN').trim().toUpperCase()
  let attempt = base
  // Bounded retry on unique_violation rather than a check-then-insert -- avoids a race between two
  // cashiers registering a same-named customer at the same moment; the DB's own unique constraint
  // is the actual arbiter.
  for (let suffix = 1; suffix <= 20; suffix++) {
    const { data, error } = await supabase
      .from('vehicles')
      .insert({
        tenant_id: input.tenantId,
        customer_id: input.customerId,
        plate_number: attempt,
        make: input.make,
        model: input.model,
        color: input.color,
        vehicle_type: input.vehicleType,
        vehicle_size_id: input.vehicleSizeId,
        plate_is_placeholder: true,
      })
      .select('id')
      .single()
    if (!error) return { id: data.id, plateNumber: attempt, plateIsPlaceholder: true }
    if (error.code !== '23505') throw error
    attempt = `${base} (${suffix + 1})`
  }
  throw new Error('Could not generate a unique identifier for this vehicle -- try entering a plate number instead')
}
