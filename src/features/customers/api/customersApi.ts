import { supabase } from '@/lib/supabase/client'

export interface CustomerRow {
  id: string
  customerType: 'individual' | 'company'
  fullName: string
  mobile: string | null
  email: string | null
  address: string | null
  notes: string | null
  isActive: boolean
  createdAt: string
  plates: string[]
}

// Manual join, same reason as salesApi.ts -- types.ts has empty Relationships everywhere.
export async function listCustomers(query?: string): Promise<CustomerRow[]> {
  let builder = supabase.from('customers').select('*').order('full_name').limit(300)
  const trimmed = query?.trim()
  if (trimmed) builder = builder.or(`full_name.ilike.%${trimmed}%,mobile.ilike.%${trimmed}%`)
  const { data: customers, error } = await builder
  if (error) throw error

  const customerIds = (customers ?? []).map((c) => c.id)
  const { data: vehicles, error: vehiclesError } = customerIds.length
    ? await supabase.from('vehicles').select('customer_id, plate_number').in('customer_id', customerIds).eq('is_active', true)
    : { data: [], error: null }
  if (vehiclesError) throw vehiclesError

  const platesByCustomer = new Map<string, string[]>()
  for (const v of vehicles ?? []) {
    if (!v.customer_id) continue
    const list = platesByCustomer.get(v.customer_id) ?? []
    list.push(v.plate_number)
    platesByCustomer.set(v.customer_id, list)
  }

  return (customers ?? []).map((c) => ({
    id: c.id,
    customerType: c.customer_type,
    fullName: c.full_name,
    mobile: c.mobile,
    email: c.email,
    address: c.address,
    notes: c.notes,
    isActive: c.is_active,
    createdAt: c.created_at,
    plates: platesByCustomer.get(c.id) ?? [],
  }))
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
