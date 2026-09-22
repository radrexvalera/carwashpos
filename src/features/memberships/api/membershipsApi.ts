import { supabase } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

export type MembershipProgram = Database['public']['Tables']['membership_programs']['Row']

export async function listMembershipPrograms() {
  const { data, error } = await supabase.from('membership_programs').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function listProgramServiceIds(programId: string) {
  const { data, error } = await supabase.from('membership_program_services').select('service_id').eq('program_id', programId)
  if (error) throw error
  return (data ?? []).map((r) => r.service_id)
}

export interface MembershipProgramInput {
  tenantId: string
  name: string
  description?: string
  stampsRequired: number
  serviceIds: string[]
}

export async function createMembershipProgram(input: MembershipProgramInput) {
  const { data, error } = await supabase
    .from('membership_programs')
    .insert({
      tenant_id: input.tenantId,
      name: input.name,
      description: input.description || null,
      stamps_required: input.stampsRequired,
    })
    .select('id')
    .single()
  if (error) throw error

  if (input.serviceIds.length > 0) {
    const { error: linkError } = await supabase
      .from('membership_program_services')
      .insert(input.serviceIds.map((serviceId) => ({ program_id: data.id, service_id: serviceId })))
    if (linkError) throw linkError
  }

  return data.id as string
}

export async function updateMembershipProgram(id: string, input: Omit<MembershipProgramInput, 'tenantId'>) {
  const { error } = await supabase
    .from('membership_programs')
    .update({
      name: input.name,
      description: input.description || null,
      stamps_required: input.stampsRequired,
    })
    .eq('id', id)
  if (error) throw error

  const { error: deleteError } = await supabase.from('membership_program_services').delete().eq('program_id', id)
  if (deleteError) throw deleteError

  if (input.serviceIds.length > 0) {
    const { error: linkError } = await supabase
      .from('membership_program_services')
      .insert(input.serviceIds.map((serviceId) => ({ program_id: id, service_id: serviceId })))
    if (linkError) throw linkError
  }
}

export async function setMembershipProgramActive(id: string, isActive: boolean) {
  const { error } = await supabase.from('membership_programs').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}

export interface StampBalance {
  programId: string
  programName: string
  stampsRequired: number
  stamps: number
}

export async function getStampBalances(customerId: string): Promise<StampBalance[]> {
  const { data: programs, error } = await supabase.from('membership_programs').select('*').eq('is_active', true)
  if (error) throw error
  if (!programs || programs.length === 0) return []

  const { data: balances, error: balanceError } = await supabase
    .from('membership_stamp_balances')
    .select('program_id, stamps')
    .eq('customer_id', customerId)
  if (balanceError) throw balanceError

  const stampsByProgram = new Map((balances ?? []).map((b) => [b.program_id, b.stamps]))

  return programs.map((p) => ({
    programId: p.id,
    programName: p.name,
    stampsRequired: p.stamps_required,
    stamps: stampsByProgram.get(p.id) ?? 0,
  }))
}

export async function adjustMembershipStamps(customerId: string, programId: string, stampDelta: number, reason: string) {
  const { error } = await supabase.rpc('adjust_membership_stamps', {
    p_customer_id: customerId,
    p_program_id: programId,
    p_stamp_delta: stampDelta,
    p_reason: reason,
  })
  if (error) throw error
}

// Used by Collect Payment: for a job's services, which active programs are eligible and does the
// customer have enough stamps to redeem right now.
export async function getRedeemableProgramsForServices(customerId: string, serviceIds: string[]) {
  if (serviceIds.length === 0) return []

  const { data: links, error } = await supabase
    .from('membership_program_services')
    .select('program_id, service_id')
    .in('service_id', serviceIds)
  if (error) throw error
  if (!links || links.length === 0) return []

  const programIds = [...new Set(links.map((l) => l.program_id))]
  const { data: programs, error: programsError } = await supabase
    .from('membership_programs')
    .select('*')
    .in('id', programIds)
    .eq('is_active', true)
  if (programsError) throw programsError

  const { data: balances, error: balanceError } = await supabase
    .from('membership_stamp_balances')
    .select('program_id, stamps')
    .eq('customer_id', customerId)
    .in('program_id', programIds)
  if (balanceError) throw balanceError
  const stampsByProgram = new Map((balances ?? []).map((b) => [b.program_id, b.stamps]))

  const serviceIdsByProgram = new Map<string, string[]>()
  for (const link of links) {
    const list = serviceIdsByProgram.get(link.program_id) ?? []
    list.push(link.service_id)
    serviceIdsByProgram.set(link.program_id, list)
  }

  return (programs ?? []).map((p) => ({
    ...p,
    eligibleServiceIds: serviceIdsByProgram.get(p.id) ?? [],
    stamps: stampsByProgram.get(p.id) ?? 0,
    redeemable: (stampsByProgram.get(p.id) ?? 0) >= p.stamps_required,
  }))
}
