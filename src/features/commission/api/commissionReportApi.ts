import { supabase } from '@/lib/supabase/client'

export async function getCommissionReport(from: string, to: string) {
  // No status filter -- a reversal row (negative commission_amount) must be summed in, not
  // excluded, or its original mistaken entry stays fully counted with nothing left to cancel it
  // out. Status here is about payroll-claiming (earned/approved/paid), not report inclusion.
  const { data: entries, error } = await supabase.from('commission_ledger').select('*').gte('created_at', from).lte('created_at', to)
  if (error) throw error

  const employeeIds = [...new Set((entries ?? []).map((e) => e.employee_id))]
  const serviceIds = [...new Set((entries ?? []).map((e) => e.service_id).filter((id): id is string => !!id))]
  // Job-level commission (commission_type 'job_percentage') has no service_id -- grouped per job
  // instead, so a corrected job's original/reversal/correction rows collapse into one line instead
  // of either merging with every other job's job-level commission or showing a stale rate/count.
  const jobIds = [...new Set((entries ?? []).filter((e) => !e.service_id).map((e) => e.job_id))]

  const [{ data: employees }, { data: services }, { data: jobs }] = await Promise.all([
    employeeIds.length
      ? supabase.from('employees').select('id, full_name').in('id', employeeIds)
      : Promise.resolve({ data: [] }),
    serviceIds.length
      ? supabase.from('services').select('id, name').in('id', serviceIds)
      : Promise.resolve({ data: [] }),
    jobIds.length ? supabase.from('jobs').select('id, job_number').in('id', jobIds) : Promise.resolve({ data: [] }),
  ])

  const employeeNameById = new Map((employees ?? []).map((e) => [e.id, e.full_name]))
  const serviceNameById = new Map((services ?? []).map((s) => [s.id, s.name]))
  const jobNumberById = new Map((jobs ?? []).map((j) => [j.id, j.job_number]))

  const byEmployee = new Map<
    string,
    {
      employeeId: string
      employeeName: string
      total: number
      count: number
      byService: Map<string, { name: string; total: number; count: number; isJobLevel: boolean }>
    }
  >()

  for (const entry of entries ?? []) {
    if (!byEmployee.has(entry.employee_id)) {
      byEmployee.set(entry.employee_id, {
        employeeId: entry.employee_id,
        employeeName: employeeNameById.get(entry.employee_id) ?? 'Unknown',
        total: 0,
        count: 0,
        byService: new Map(),
      })
    }
    const bucket = byEmployee.get(entry.employee_id)!
    bucket.total += entry.commission_amount
    bucket.count += 1

    const groupKey = entry.service_id ?? `job:${entry.job_id}`
    const serviceName = entry.service_id
      ? (serviceNameById.get(entry.service_id) ?? 'Unknown')
      : `Job commission (${jobNumberById.get(entry.job_id) ?? entry.job_id.slice(0, 8)})`
    if (!bucket.byService.has(groupKey)) {
      bucket.byService.set(groupKey, { name: serviceName, total: 0, count: 0, isJobLevel: !entry.service_id })
    }
    const serviceBucket = bucket.byService.get(groupKey)!
    serviceBucket.total += entry.commission_amount
    serviceBucket.count += 1
  }

  return {
    grandTotal: (entries ?? []).reduce((sum, e) => sum + e.commission_amount, 0),
    employees: [...byEmployee.values()].sort((a, b) => b.total - a.total),
  }
}
