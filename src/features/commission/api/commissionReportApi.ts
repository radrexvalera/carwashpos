import { supabase } from '@/lib/supabase/client'

export async function getCommissionReport(from: string, to: string) {
  const { data: entries, error } = await supabase
    .from('commission_ledger')
    .select('*')
    .gte('created_at', from)
    .lte('created_at', to)
    .neq('status', 'reversed')
  if (error) throw error

  const employeeIds = [...new Set((entries ?? []).map((e) => e.employee_id))]
  const serviceIds = [...new Set((entries ?? []).map((e) => e.service_id).filter((id): id is string => !!id))]

  const [{ data: employees }, { data: services }] = await Promise.all([
    employeeIds.length
      ? supabase.from('employees').select('id, full_name').in('id', employeeIds)
      : Promise.resolve({ data: [] }),
    serviceIds.length
      ? supabase.from('services').select('id, name').in('id', serviceIds)
      : Promise.resolve({ data: [] }),
  ])

  const employeeNameById = new Map((employees ?? []).map((e) => [e.id, e.full_name]))
  const serviceNameById = new Map((services ?? []).map((s) => [s.id, s.name]))

  const byEmployee = new Map<
    string,
    { employeeId: string; employeeName: string; total: number; count: number; byService: Map<string, { name: string; total: number; count: number }> }
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

    // Job-level commission (commission_type 'job_percentage') isn't tied to one service line --
    // service_id is null -- so it's grouped under its own bucket instead of an ambiguous "Unknown".
    const groupKey = entry.service_id ?? 'job_percentage'
    const serviceName = entry.service_id ? (serviceNameById.get(entry.service_id) ?? 'Unknown') : `Job commission (${entry.commission_rate}%)`
    if (!bucket.byService.has(groupKey)) {
      bucket.byService.set(groupKey, { name: serviceName, total: 0, count: 0 })
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
