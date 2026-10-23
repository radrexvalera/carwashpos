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

// A fresh filename per upload (not a fixed "logo.png") so the new logo's URL is never the one the
// browser (or an <img> on an already-open receipt/payslip) has cached under the old content.
export async function uploadBusinessLogo(tenantId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const path = `${tenantId}/logo-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('business-logos').upload(path, file, { contentType: file.type })
  if (error) throw error
  const { data } = supabase.storage.from('business-logos').getPublicUrl(path)
  return data.publicUrl
}

// Best-effort cleanup of the previous logo object so old uploads don't pile up in storage --
// never blocks on failure, since a stray orphaned file costs nothing but a few KB.
export async function removeBusinessLogoFile(logoUrl: string) {
  const marker = '/business-logos/'
  const idx = logoUrl.indexOf(marker)
  if (idx === -1) return
  const path = logoUrl.slice(idx + marker.length)
  try {
    await supabase.storage.from('business-logos').remove([path])
  } catch {
    // best-effort
  }
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
