import { supabase } from '@/lib/supabase/client'
import { localDateString } from '@/lib/date'
import type { Database } from '@/lib/supabase/types'

export type Promotion = Database['public']['Tables']['promotions']['Row']

export async function listPromotions() {
  const { data, error } = await supabase.from('promotions').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function listPromotionServiceIds(promotionId: string) {
  const { data, error } = await supabase.from('promotion_services').select('service_id').eq('promotion_id', promotionId)
  if (error) throw error
  return (data ?? []).map((r) => r.service_id)
}

export interface PromotionInput {
  tenantId: string
  name: string
  description?: string
  discountType: 'percentage' | 'fixed_amount'
  discountValue: number
  minSpend?: number
  startsAt?: string
  endsAt?: string
  serviceIds: string[]
}

export async function createPromotion(input: PromotionInput) {
  const { data, error } = await supabase
    .from('promotions')
    .insert({
      tenant_id: input.tenantId,
      name: input.name,
      description: input.description || null,
      discount_type: input.discountType,
      discount_value: input.discountValue,
      min_spend: input.minSpend ?? null,
      starts_at: input.startsAt || null,
      ends_at: input.endsAt || null,
    })
    .select('id')
    .single()
  if (error) throw error

  if (input.serviceIds.length > 0) {
    const { error: linkError } = await supabase
      .from('promotion_services')
      .insert(input.serviceIds.map((serviceId) => ({ promotion_id: data.id, service_id: serviceId })))
    if (linkError) throw linkError
  }

  return data.id as string
}

export async function updatePromotion(id: string, input: Omit<PromotionInput, 'tenantId'>) {
  const { error } = await supabase
    .from('promotions')
    .update({
      name: input.name,
      description: input.description || null,
      discount_type: input.discountType,
      discount_value: input.discountValue,
      min_spend: input.minSpend ?? null,
      starts_at: input.startsAt || null,
      ends_at: input.endsAt || null,
    })
    .eq('id', id)
  if (error) throw error

  const { error: deleteError } = await supabase.from('promotion_services').delete().eq('promotion_id', id)
  if (deleteError) throw deleteError

  if (input.serviceIds.length > 0) {
    const { error: linkError } = await supabase
      .from('promotion_services')
      .insert(input.serviceIds.map((serviceId) => ({ promotion_id: id, service_id: serviceId })))
    if (linkError) throw linkError
  }
}

export async function setPromotionActive(id: string, isActive: boolean) {
  const { error } = await supabase.from('promotions').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}

// Active promotions eligible to apply "right now" -- used by the checkout screen. Filtered
// client-side against the date range since Supabase's query builder can't express
// "starts_at is null or starts_at <= today" as cleanly as a plain JS filter here.
// Also returns each promotion's service restriction (empty array = applies to the whole sale)
// so the checkout screen can preview the discount -- the server (create_sale) is still what
// actually computes and enforces it.
export async function listActivePromotionsWithServices() {
  const { data, error } = await supabase.from('promotions').select('*').eq('is_active', true)
  if (error) throw error
  const today = localDateString()
  const active = (data ?? []).filter((p) => (!p.starts_at || p.starts_at <= today) && (!p.ends_at || p.ends_at >= today))

  if (active.length === 0) return []

  const { data: links, error: linkError } = await supabase
    .from('promotion_services')
    .select('promotion_id, service_id')
    .in('promotion_id', active.map((p) => p.id))
  if (linkError) throw linkError

  const serviceIdsByPromotion = new Map<string, string[]>()
  for (const link of links ?? []) {
    const list = serviceIdsByPromotion.get(link.promotion_id) ?? []
    list.push(link.service_id)
    serviceIdsByPromotion.set(link.promotion_id, list)
  }

  return active.map((p) => ({ ...p, restrictedServiceIds: serviceIdsByPromotion.get(p.id) ?? [] }))
}
