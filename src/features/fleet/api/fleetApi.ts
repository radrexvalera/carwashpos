import { supabase } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

export type FleetAccount = Database['public']['Tables']['fleet_accounts']['Row']
export type Sale = Database['public']['Tables']['sales']['Row']

export interface FleetAccountWithDetails extends FleetAccount {
  customerName: string
  outstandingBalance: number
}

export async function listFleetAccounts(): Promise<FleetAccountWithDetails[]> {
  const { data: accounts, error } = await supabase.from('fleet_accounts').select('*').order('created_at', { ascending: false })
  if (error) throw error
  if (!accounts || accounts.length === 0) return []

  const [customersRes, balancesRes] = await Promise.all([
    supabase.from('customers').select('id, full_name').in('id', accounts.map((a) => a.customer_id)),
    supabase.from('fleet_account_balances').select('fleet_account_id, outstanding_balance').in('fleet_account_id', accounts.map((a) => a.id)),
  ])
  if (customersRes.error) throw customersRes.error
  if (balancesRes.error) throw balancesRes.error

  const nameByCustomerId = new Map((customersRes.data ?? []).map((c) => [c.id, c.full_name]))
  const balanceByAccountId = new Map((balancesRes.data ?? []).map((b) => [b.fleet_account_id, b.outstanding_balance]))

  return accounts.map((a) => ({
    ...a,
    customerName: nameByCustomerId.get(a.customer_id) ?? 'Unknown',
    outstandingBalance: balanceByAccountId.get(a.id) ?? 0,
  }))
}

// Fetched from Collect Payment for the job's resolved customer -- null means "not a fleet
// vehicle," which is the common case and shouldn't show any fleet UI at all.
export async function getFleetAccountForCustomer(customerId: string) {
  const { data, error } = await supabase
    .from('fleet_accounts')
    .select('*')
    .eq('customer_id', customerId)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  let outstandingBalance = 0
  if (data.credit_limit != null) {
    const { data: balance, error: balanceError } = await supabase
      .from('fleet_account_balances')
      .select('outstanding_balance')
      .eq('fleet_account_id', data.id)
      .maybeSingle()
    if (balanceError) throw balanceError
    outstandingBalance = balance?.outstanding_balance ?? 0
  }

  return { ...data, outstandingBalance }
}

export interface CreateFleetAccountInput {
  tenantId: string
  customerId: string
  creditLimit?: number
  paymentTermsDays: number
}

export async function createFleetAccount(input: CreateFleetAccountInput) {
  // Tag the customer as a company so it's clear from the customer record too, not just here.
  const { error: customerError } = await supabase.from('customers').update({ customer_type: 'company' }).eq('id', input.customerId)
  if (customerError) throw customerError

  const { error } = await supabase.from('fleet_accounts').insert({
    tenant_id: input.tenantId,
    customer_id: input.customerId,
    credit_limit: input.creditLimit ?? null,
    payment_terms_days: input.paymentTermsDays,
  })
  if (error) throw error
}

export interface NewCompanyCustomerInput {
  tenantId: string
  fullName: string
  mobile?: string
  email?: string
  address?: string
}

export async function createCompanyCustomer(input: NewCompanyCustomerInput) {
  const { data, error } = await supabase
    .from('customers')
    .insert({
      tenant_id: input.tenantId,
      customer_type: 'company',
      full_name: input.fullName,
      mobile: input.mobile || null,
      email: input.email || null,
      address: input.address || null,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export async function setFleetAccountActive(id: string, isActive: boolean) {
  const { error } = await supabase.from('fleet_accounts').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}

export async function updateFleetAccountTerms(id: string, creditLimit: number | null, paymentTermsDays: number) {
  const { error } = await supabase
    .from('fleet_accounts')
    .update({ credit_limit: creditLimit, payment_terms_days: paymentTermsDays })
    .eq('id', id)
  if (error) throw error
}

export async function listOutstandingInvoices(customerId: string) {
  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .eq('customer_id', customerId)
    .eq('billing_type', 'on_account')
    .neq('payment_status', 'paid')
    .order('created_at', { ascending: true })
  if (error) throw error

  const saleIds = (data ?? []).map((s) => s.id)
  const { data: payments, error: paymentsError } = saleIds.length
    ? await supabase.from('payments').select('sale_id, amount').in('sale_id', saleIds)
    : { data: [] as { sale_id: string; amount: number }[], error: null }
  if (paymentsError) throw paymentsError

  const paidBySale = new Map<string, number>()
  for (const p of payments ?? []) {
    paidBySale.set(p.sale_id, (paidBySale.get(p.sale_id) ?? 0) + p.amount)
  }

  return (data ?? []).map((s) => ({
    ...s,
    paidSoFar: paidBySale.get(s.id) ?? 0,
    remaining: s.total - (paidBySale.get(s.id) ?? 0),
  }))
}

export async function recordFleetSettlement(saleId: string, method: string, amount: number, referenceNote?: string) {
  const { data, error } = await supabase.rpc('record_fleet_settlement', {
    p_sale_id: saleId,
    p_method: method,
    p_amount: amount,
    p_reference_note: referenceNote || null,
  })
  if (error) throw error
  return data as { remaining: number; status: string; loyalty_points_earned: number }
}
