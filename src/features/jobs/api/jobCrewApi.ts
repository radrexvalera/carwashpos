import { supabase } from '@/lib/supabase/client'

export interface JobCrewLine {
  jobServiceId: string
  serviceName: string
  attendantEmployeeIds: string[]
}

// Crew can be edited after a job is completed (e.g. it was forgotten before payment) -- job_service
// status is irrelevant here, only which services actually belong to the job.
export async function getJobCrew(jobId: string): Promise<JobCrewLine[]> {
  const { data: jobServices, error: jsError } = await supabase
    .from('job_services')
    .select('id, service_id')
    .eq('job_id', jobId)
    .neq('status', 'cancelled')
  if (jsError) throw jsError

  const serviceIds = [...new Set((jobServices ?? []).map((js) => js.service_id))]
  const jobServiceIds = (jobServices ?? []).map((js) => js.id)

  const [{ data: services, error: servicesError }, { data: attendants, error: attendantsError }] = await Promise.all([
    serviceIds.length ? supabase.from('services').select('id, name').in('id', serviceIds) : Promise.resolve({ data: [], error: null }),
    jobServiceIds.length
      ? supabase.from('job_service_attendants').select('job_service_id, employee_id').in('job_service_id', jobServiceIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (servicesError) throw servicesError
  if (attendantsError) throw attendantsError

  const serviceNameById = new Map((services ?? []).map((s) => [s.id, s.name]))
  const attendantsByLine = new Map<string, string[]>()
  for (const a of attendants ?? []) {
    const list = attendantsByLine.get(a.job_service_id) ?? []
    list.push(a.employee_id)
    attendantsByLine.set(a.job_service_id, list)
  }

  return (jobServices ?? []).map((js) => ({
    jobServiceId: js.id,
    serviceName: serviceNameById.get(js.service_id) ?? 'Service',
    attendantEmployeeIds: attendantsByLine.get(js.id) ?? [],
  }))
}

// Replaces the full crew list for one service line with an even split among the given employees --
// matches how Register assigns crew today (split_percentage overrides are set there only, not here).
export async function setJobServiceCrew(tenantId: string, jobServiceId: string, employeeIds: string[]) {
  const { error: deleteError } = await supabase.from('job_service_attendants').delete().eq('job_service_id', jobServiceId)
  if (deleteError) throw deleteError

  if (employeeIds.length > 0) {
    const { error: insertError } = await supabase.from('job_service_attendants').insert(
      employeeIds.map((employeeId) => ({ tenant_id: tenantId, job_service_id: jobServiceId, employee_id: employeeId })),
    )
    if (insertError) throw insertError
  }
}

export async function recomputeJobCommission(jobId: string) {
  const { data, error } = await supabase.rpc('recompute_job_commission', { p_job_id: jobId })
  if (error) throw error
  return data as { job_id: string; rate: number; pool: number; crew_count: number; entries_written: number }
}
