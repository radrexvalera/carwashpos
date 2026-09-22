import { supabase } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

export type Customer = Database['public']['Tables']['customers']['Row']
export type LoyaltyTransaction = Database['public']['Tables']['loyalty_transactions']['Row']

export async function searchCustomers(query: string) {
  if (!query.trim()) return []
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .or(`full_name.ilike.%${query}%,mobile.ilike.%${query}%`)
    .eq('is_active', true)
    .limit(20)
  if (error) throw error
  return data
}

export async function getLoyaltyBalance(customerId: string) {
  const { data, error } = await supabase.from('loyalty_balances').select('balance').eq('customer_id', customerId).maybeSingle()
  if (error) throw error
  return data?.balance ?? 0
}

export async function listLoyaltyTransactions(customerId: string) {
  const { data, error } = await supabase
    .from('loyalty_transactions')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data
}

export async function adjustLoyaltyPoints(customerId: string, pointsDelta: number, reason: string) {
  const { error } = await supabase.rpc('adjust_loyalty_points', {
    p_customer_id: customerId,
    p_points_delta: pointsDelta,
    p_reason: reason,
  })
  if (error) throw error
}
