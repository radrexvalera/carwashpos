import { supabase } from '@/lib/supabase/client'
import type { Json } from '@/lib/supabase/types'

// Payment collection is online-only for v1: by the time a job shows on the queue board it's
// already synced (the board only ever reads server data), and create_sale() needs real
// job_service ids to bill against -- so this deliberately doesn't go through the offline outbox
// the way job creation and status updates do.
export async function getJobForPayment(jobId: string) {
  const { data: job, error: jobError } = await supabase.from('jobs').select('*').eq('id', jobId).single()
  if (jobError) throw jobError

  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', job.vehicle_id)
    .single()
  if (vehicleError) throw vehicleError

  const { data: jobServices, error: servicesError } = await supabase
    .from('job_services')
    .select('*')
    .eq('job_id', jobId)
    .neq('status', 'cancelled')
  if (servicesError) throw servicesError

  const serviceIds = (jobServices ?? []).map((js) => js.service_id)
  const { data: services, error: servicesLookupError } = await supabase.from('services').select('id, name').in('id', serviceIds)
  if (servicesLookupError) throw servicesLookupError

  const serviceNameById = new Map((services ?? []).map((s) => [s.id, s.name]))

  return {
    job,
    vehicle,
    jobServices: (jobServices ?? []).map((js) => ({ ...js, serviceName: serviceNameById.get(js.service_id) ?? 'Service' })),
  }
}

interface CreateSaleInput {
  shiftId: string
  jobId: string
  lineItems: { jobServiceId: string; discountAmount: number }[]
  payments: { method: string; amount: number; referenceNote?: string }[]
}

export async function createSaleForJob(input: CreateSaleInput) {
  const payload = {
    client_generated_id: crypto.randomUUID(),
    shift_id: input.shiftId,
    job_id: input.jobId,
    line_items: input.lineItems.map((l) => ({
      line_type: 'job_service',
      job_service_id: l.jobServiceId,
      discount_amount: l.discountAmount,
    })),
    payments: input.payments.map((p) => ({ method: p.method, amount: p.amount, reference_note: p.referenceNote })),
  }

  const { data, error } = await supabase.rpc('create_sale', { payload: payload as unknown as Json })
  if (error) throw error
  return data as { id: string; sale_number: string; status: string; total: number; created_at: string }
}
