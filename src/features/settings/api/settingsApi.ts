import { supabase } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

type Settings = Database['public']['Tables']['settings']['Row']

export async function getSettings(tenantId: string) {
  const { data, error } = await supabase.from('settings').select('*').eq('tenant_id', tenantId).single()
  if (error) throw error
  return data
}

export async function updateSettings(tenantId: string, input: Partial<Database['public']['Tables']['settings']['Update']>) {
  const { error } = await supabase.from('settings').update(input).eq('tenant_id', tenantId)
  if (error) throw error
}

// null trial_ends_at means "not on a trial" (every tenant created before self-serve signup
// existed, or one an operator has manually converted) -- never gated by the banner or the
// server-side RPC checks.
export async function getTenantTrialStatus(tenantId: string) {
  const { data, error } = await supabase.from('tenants').select('trial_ends_at').eq('id', tenantId).single()
  if (error) throw error
  const expired = data.trial_ends_at !== null && new Date(data.trial_ends_at) < new Date()
  return { trialEndsAt: data.trial_ends_at, expired }
}

export type { Settings }
