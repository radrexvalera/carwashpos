import { supabase } from '@/lib/supabase/client'

// The vehicle, not the customer record, is this shop's actual primary identifier (same as
// Register's "by plate number" default mode -- most jobs are rung up on a walk-in plate with no
// customer record at all). So this list is one row per VEHICLE, with whatever customer info is
// linked folded in -- never a customers-table-only list, which would silently hide every
// plate-only walk-in.
export interface VehicleCustomerRow {
  vehicleId: string
  plateNumber: string
  plateIsPlaceholder: boolean
  make: string | null
  model: string | null
  color: string | null
  vehicleSizeId: string | null
  vehicleActive: boolean
  customerId: string | null
  customerType: 'individual' | 'company' | null
  customerName: string | null
  mobile: string | null
  email: string | null
  address: string | null
  notes: string | null
  customerActive: boolean
}

// Manual join, same reason as salesApi.ts -- types.ts has empty Relationships everywhere. A
// search matches EITHER the plate or the linked customer's name/mobile -- two separate queries
// merged client-side rather than one combined or() filter, since the free-text query itself may
// contain characters (commas) that would break a hand-built in.(...) filter string.
export async function listVehicleCustomers(query?: string): Promise<VehicleCustomerRow[]> {
  const trimmed = query?.trim()

  let vehicles: { id: string; plate_number: string; plate_is_placeholder: boolean; make: string | null; model: string | null; color: string | null; vehicle_size_id: string | null; is_active: boolean; customer_id: string | null }[]

  if (trimmed) {
    const [byPlateRes, matchingCustomersRes] = await Promise.all([
      supabase.from('vehicles').select('*').ilike('plate_number', `%${trimmed}%`).order('created_at', { ascending: false }).limit(300),
      supabase.from('customers').select('id').or(`full_name.ilike.%${trimmed}%,mobile.ilike.%${trimmed}%`),
    ])
    if (byPlateRes.error) throw byPlateRes.error
    if (matchingCustomersRes.error) throw matchingCustomersRes.error
    const customerIds = (matchingCustomersRes.data ?? []).map((c) => c.id)
    const byCustomerRes = customerIds.length
      ? await supabase.from('vehicles').select('*').in('customer_id', customerIds)
      : { data: [], error: null }
    if (byCustomerRes.error) throw byCustomerRes.error
    const merged = new Map((byPlateRes.data ?? []).map((v) => [v.id, v]))
    for (const v of byCustomerRes.data ?? []) merged.set(v.id, v)
    vehicles = [...merged.values()]
  } else {
    const { data, error } = await supabase.from('vehicles').select('*').order('created_at', { ascending: false }).limit(300)
    if (error) throw error
    vehicles = data ?? []
  }

  const customerIds = [...new Set(vehicles.map((v) => v.customer_id).filter((id): id is string => !!id))]
  const { data: customers, error: customersError } = customerIds.length
    ? await supabase.from('customers').select('*').in('id', customerIds)
    : { data: [], error: null }
  if (customersError) throw customersError
  const customerById = new Map((customers ?? []).map((c) => [c.id, c]))

  return vehicles.map((v) => {
    const customer = v.customer_id ? customerById.get(v.customer_id) : undefined
    return {
      vehicleId: v.id,
      plateNumber: v.plate_number,
      plateIsPlaceholder: v.plate_is_placeholder,
      make: v.make,
      model: v.model,
      color: v.color,
      vehicleSizeId: v.vehicle_size_id,
      vehicleActive: v.is_active,
      customerId: v.customer_id,
      customerType: customer?.customer_type ?? null,
      customerName: customer?.full_name ?? null,
      mobile: customer?.mobile ?? null,
      email: customer?.email ?? null,
      address: customer?.address ?? null,
      notes: customer?.notes ?? null,
      customerActive: customer?.is_active ?? true,
    }
  })
}

// Links a vehicle to a customer created after the fact (e.g. adding contact info to a plate-only
// walk-in through the edit dialog). RLS's vehicles_update policy is plain tenant-scoped, same as
// updateVehicle() in vehiclesApi.ts.
export async function linkVehicleCustomer(vehicleId: string, customerId: string) {
  const { error } = await supabase.from('vehicles').update({ customer_id: customerId }).eq('id', vehicleId)
  if (error) throw error
}

export interface CustomerVehicle {
  id: string
  plateNumber: string
  plateIsPlaceholder: boolean
  make: string | null
  model: string | null
  color: string | null
  isActive: boolean
}

export async function listCustomerVehicles(customerId: string): Promise<CustomerVehicle[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, plate_number, plate_is_placeholder, make, model, color, is_active')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((v) => ({
    id: v.id,
    plateNumber: v.plate_number,
    plateIsPlaceholder: v.plate_is_placeholder,
    make: v.make,
    model: v.model,
    color: v.color,
    isActive: v.is_active,
  }))
}

export async function createCustomer(input: {
  tenantId: string
  customerType: 'individual' | 'company'
  fullName: string
  mobile: string | null
  email: string | null
  address: string | null
  notes: string | null
}) {
  const { data, error } = await supabase
    .from('customers')
    .insert({
      tenant_id: input.tenantId,
      customer_type: input.customerType,
      full_name: input.fullName,
      mobile: input.mobile,
      email: input.email,
      address: input.address,
      notes: input.notes,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function updateCustomer(
  customerId: string,
  input: {
    customerType: 'individual' | 'company'
    fullName: string
    mobile: string | null
    email: string | null
    address: string | null
    notes: string | null
    isActive: boolean
  },
) {
  const { error } = await supabase
    .from('customers')
    .update({
      customer_type: input.customerType,
      full_name: input.fullName,
      mobile: input.mobile,
      email: input.email,
      address: input.address,
      notes: input.notes,
      is_active: input.isActive,
    })
    .eq('id', customerId)
  if (error) throw error
}
