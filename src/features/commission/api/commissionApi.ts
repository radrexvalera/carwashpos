import { supabase } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

type CommissionRule = Database['public']['Tables']['service_commission_rules']['Row']
type CommissionLedgerEntry = Database['public']['Tables']['commission_ledger']['Row']

export async function listCommissionRules() {
  const { data, error } = await supabase.from('service_commission_rules').select('*')
  if (error) throw error
  return data
}

export async function upsertCommissionRule(input: {
  tenantId: string
  serviceId: string | null
  commissionType: 'fixed_pool' | 'percentage' | 'fixed_per_attendant' | 'points'
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

// RLS already restricts this to the caller's own rows unless they have can_view_all_commissions,
// so no employeeId filter needs to be passed explicitly -- the server enforces it either way.
export async function listCommissionLedger(filters?: { employeeId?: string; from?: string; to?: string }) {
  let query = supabase.from('commission_ledger').select('*').order('created_at', { ascending: false })
  if (filters?.employeeId) query = query.eq('employee_id', filters.employeeId)
  if (filters?.from) query = query.gte('created_at', filters.from)
  if (filters?.to) query = query.lte('created_at', filters.to)
  const { data, error } = await query
  if (error) throw error
  return data
}

export type { CommissionRule, CommissionLedgerEntry }
