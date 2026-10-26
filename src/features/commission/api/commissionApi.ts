import { supabase } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

type CommissionRule = Database['public']['Tables']['service_commission_rules']['Row']
type CommissionSize = Database['public']['Tables']['service_commission_sizes']['Row']

export async function listCommissionRules() {
  const { data, error } = await supabase.from('service_commission_rules').select('*')
  if (error) throw error
  return data
}

export async function upsertCommissionRule(input: {
  tenantId: string
  serviceId: string | null
  commissionType: 'fixed_pool' | 'percentage' | 'fixed_per_attendant' | 'points' | 'fixed_pool_by_size'
  rate: number
  basis: 'original_price' | 'discounted_price'
}) {
  let existingQuery = supabase.from('service_commission_rules').select('id').eq('tenant_id', input.tenantId)
  existingQuery = input.serviceId === null ? existingQuery.is('service_id', null) : existingQuery.eq('service_id', input.serviceId)
  const existing = await existingQuery.maybeSingle()

  if (existing.data) {
    const { error } = await supabase
      .from('service_commission_rules')
      .update({ commission_type: input.commissionType, rate: input.rate, basis: input.basis })
      .eq('id', existing.data.id)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('service_commission_rules').insert({
    tenant_id: input.tenantId,
    service_id: input.serviceId,
    commission_type: input.commissionType,
    rate: input.rate,
    basis: input.basis,
  })
  if (error) throw error
}

export async function deleteCommissionRule(id: string) {
  const { error } = await supabase.from('service_commission_rules').delete().eq('id', id)
  if (error) throw error
}

export async function listCommissionSizes(serviceId: string) {
  const { data, error } = await supabase.from('service_commission_sizes').select('*').eq('service_id', serviceId)
  if (error) throw error
  return data
}

// One upsert per vehicle size -- a manager fills in a handful of inputs (one per active size) and
// saves them all at once, so the caller loops this rather than needing a bulk-upsert RPC.
export async function upsertCommissionSize(input: { tenantId: string; serviceId: string; vehicleSizeId: string; amount: number }) {
  const existing = await supabase
    .from('service_commission_sizes')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('service_id', input.serviceId)
    .eq('vehicle_size_id', input.vehicleSizeId)
    .maybeSingle()

  if (existing.data) {
    const { error } = await supabase.from('service_commission_sizes').update({ amount: input.amount }).eq('id', existing.data.id)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('service_commission_sizes').insert({
    tenant_id: input.tenantId,
    service_id: input.serviceId,
    vehicle_size_id: input.vehicleSizeId,
    amount: input.amount,
  })
  if (error) throw error
}

export type { CommissionRule, CommissionSize }
