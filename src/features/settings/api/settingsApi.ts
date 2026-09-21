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

export type { Settings }
