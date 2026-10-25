import { supabase } from '@/lib/supabase/client'

export interface JobEditLine {
  id: string
  serviceId: string
  serviceName: string
  unitPrice: number
  quantity: number
  lineTotal: number
}

export interface JobEditDetail {
  vehicleSizeId: string
  lines: JobEditLine[]
}

// Manual joins (not an embedded select) for the same reason as everywhere else in this codebase --
// types.ts's hand-written Relationships are empty.
export async function getJobEditDetail(jobId: string): Promise<JobEditDetail> {
  const { data: job, error: jobError } = await supabase.from('jobs').select('vehicle_size_id').eq('id', jobId).single()
  if (jobError) throw jobError

  const { data: jobServices, error: servicesError } = await supabase
    .from('job_services')
    .select('*')
    .eq('job_id', jobId)
    .neq('status', 'cancelled')
  if (servicesError) throw servicesError

  const serviceIds = (jobServices ?? []).map((js) => js.service_id)
  const { data: services, error: lookupError } = serviceIds.length
    ? await supabase.from('services').select('id, name').in('id', serviceIds)
    : { data: [], error: null }
  if (lookupError) throw lookupError

  const serviceNameById = new Map((services ?? []).map((s) => [s.id, s.name]))

  return {
    vehicleSizeId: job.vehicle_size_id,
    lines: (jobServices ?? []).map((js) => ({
      id: js.id,
      serviceId: js.service_id,
      serviceName: serviceNameById.get(js.service_id) ?? 'Service',
      unitPrice: js.unit_price,
      quantity: js.quantity,
      lineTotal: js.line_total,
    })),
  }
}

export async function addJobService(jobId: string, serviceId: string, quantity: number, manualPrice?: number) {
  const { data, error } = await supabase.rpc('add_job_service', {
    p_job_id: jobId,
    p_service_id: serviceId,
    p_quantity: quantity,
    p_manual_price: manualPrice ?? null,
  })
  if (error) throw error
  return data as { id: string; unit_price: number; line_total: number }
}

export async function removeJobService(jobServiceId: string) {
  const { error } = await supabase.rpc('remove_job_service', { p_job_service_id: jobServiceId })
  if (error) throw error
}

export async function updateJobServiceQuantity(jobServiceId: string, quantity: number) {
  const { data, error } = await supabase.rpc('update_job_service_quantity', {
    p_job_service_id: jobServiceId,
    p_quantity: quantity,
  })
  if (error) throw error
  return data as { id: string; quantity: number; line_total: number }
}

export async function updateJobVehicleSize(jobId: string, vehicleSizeId: string) {
  const { data, error } = await supabase.rpc('update_job_vehicle_size', {
    p_job_id: jobId,
    p_vehicle_size_id: vehicleSizeId,
  })
  if (error) throw error
  return data as { repriced_count: number; skipped_count: number }
}

export async function cancelJob(jobId: string, reason: string) {
  const { data, error } = await supabase.rpc('cancel_job', { p_job_id: jobId, p_reason: reason })
  if (error) throw error
  return data as { id: string; status: string }
}
