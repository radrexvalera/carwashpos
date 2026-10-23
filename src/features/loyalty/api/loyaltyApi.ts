import { supabase } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

export type Customer = Database['public']['Tables']['customers']['Row']

// Loyalty itself is disabled (see migration 0065) -- this function stays because Fleet Accounts
// still depends on it for plain customer lookup, unrelated to loyalty specifically.
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
