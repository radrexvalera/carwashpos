import { supabase } from '@/lib/supabase/client'

export interface CommissionRateJob {
  jobId: string
  jobNumber: string
  plateNumber: string | null
  date: string
  grossAmount: number
  commissionAmount: number
}

export interface PayrollJobBreakdownRow {
  jobId: string
  jobNumber: string
  plateNumber: string | null
  date: string
  serviceName: string | null
  rate: number
  grossAmount: number
  commissionAmount: number
}

// Per-employee, per-payroll-period job breakdown -- commission_ledger rows get stamped with
// payroll_period_id once claimed (generate_payroll_period()/recompute_job_commission()), so this
// is just those rows netted per line item, same (job_service_id ?? job_id, rate) netting key as
// the Commission Report above, for the same reason: a reversal + its correction share a
// payroll_period_id and can share a created_at, so summing nets a superseded line to ~0 instead of
// guessing which row is "current".
export async function getPayrollEntryJobBreakdown(payrollPeriodId: string, employeeId: string): Promise<PayrollJobBreakdownRow[]> {
  const { data: entries, error } = await supabase
    .from('commission_ledger')
    .select('*')
    .eq('payroll_period_id', payrollPeriodId)
    .eq('employee_id', employeeId)
  if (error) throw error

  const jobIds = [...new Set((entries ?? []).map((e) => e.job_id))]
  const serviceIds = [...new Set((entries ?? []).map((e) => e.service_id).filter((id): id is string => !!id))]

  const [{ data: jobs }, { data: services }] = await Promise.all([
    jobIds.length ? supabase.from('jobs').select('id, job_number, vehicle_id').in('id', jobIds) : Promise.resolve({ data: [] }),
    serviceIds.length ? supabase.from('services').select('id, name').in('id', serviceIds) : Promise.resolve({ data: [] }),
  ])

  const vehicleIds = [...new Set((jobs ?? []).map((j) => j.vehicle_id))]
  const { data: vehicles } = vehicleIds.length
    ? await supabase.from('vehicles').select('id, plate_number').in('id', vehicleIds)
    : { data: [] }

  const jobNumberById = new Map((jobs ?? []).map((j) => [j.id, j.job_number]))
  const vehicleIdByJobId = new Map((jobs ?? []).map((j) => [j.id, j.vehicle_id]))
  const plateByVehicleId = new Map((vehicles ?? []).map((v) => [v.id, v.plate_number]))
  const serviceNameById = new Map((services ?? []).map((s) => [s.id, s.name]))

  const byKey = new Map<
    string,
    { jobId: string; serviceId: string | null; rate: number; netAmount: number; grossAmount: number; lastCreatedAt: string }
  >()
  for (const entry of entries ?? []) {
    const key = `${entry.job_service_id ?? entry.job_id}:${entry.commission_rate}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, {
        jobId: entry.job_id,
        serviceId: entry.service_id,
        rate: entry.commission_rate,
        netAmount: entry.commission_amount,
        grossAmount: entry.gross_service_amount,
        lastCreatedAt: entry.created_at,
      })
    } else {
      existing.netAmount += entry.commission_amount
      if (entry.created_at > existing.lastCreatedAt) existing.lastCreatedAt = entry.created_at
    }
  }

  const rows: PayrollJobBreakdownRow[] = []
  for (const row of byKey.values()) {
    if (Math.abs(row.netAmount) < 0.005) continue
    rows.push({
      jobId: row.jobId,
      jobNumber: jobNumberById.get(row.jobId) ?? row.jobId.slice(0, 8),
      plateNumber: plateByVehicleId.get(vehicleIdByJobId.get(row.jobId) ?? '') ?? null,
      date: row.lastCreatedAt,
      serviceName: row.serviceId ? serviceNameById.get(row.serviceId) ?? 'Unknown service' : null,
      rate: row.rate,
      grossAmount: row.grossAmount,
      commissionAmount: row.netAmount,
    })
  }
  rows.sort((a, b) => b.date.localeCompare(a.date))
  return rows
}

export async function getCommissionReport(from: string, to: string) {
  // No status filter -- a reversal row (negative commission_amount) must be summed in, not
  // excluded, or its original mistaken entry stays fully counted with nothing left to cancel it
  // out. Status here is about payroll-claiming (earned/approved/paid), not report inclusion.
  const { data: entries, error } = await supabase.from('commission_ledger').select('*').gte('created_at', from).lte('created_at', to)
  if (error) throw error

  const employeeIds = [...new Set((entries ?? []).map((e) => e.employee_id))]
  const serviceIds = [...new Set((entries ?? []).map((e) => e.service_id).filter((id): id is string => !!id))]
  // Job-level commission (commission_type 'job_percentage') has no service_id -- grouped per job
  // instead of merging with every other job's job-level commission under one bucket.
  const jobIds = [...new Set((entries ?? []).filter((e) => !e.service_id).map((e) => e.job_id))]

  const [{ data: employees }, { data: services }, { data: jobs }] = await Promise.all([
    employeeIds.length
      ? supabase.from('employees').select('id, full_name').in('id', employeeIds)
      : Promise.resolve({ data: [] }),
    serviceIds.length
      ? supabase.from('services').select('id, name').in('id', serviceIds)
      : Promise.resolve({ data: [] }),
    jobIds.length ? supabase.from('jobs').select('id, job_number, vehicle_id').in('id', jobIds) : Promise.resolve({ data: [] }),
  ])

  const vehicleIds = [...new Set((jobs ?? []).map((j) => j.vehicle_id))]
  const { data: vehicles } = vehicleIds.length
    ? await supabase.from('vehicles').select('id, plate_number').in('id', vehicleIds)
    : { data: [] }

  const employeeNameById = new Map((employees ?? []).map((e) => [e.id, e.full_name]))
  const serviceNameById = new Map((services ?? []).map((s) => [s.id, s.name]))
  const jobNumberById = new Map((jobs ?? []).map((j) => [j.id, j.job_number]))
  const plateByVehicleId = new Map((vehicles ?? []).map((v) => [v.id, v.plate_number]))
  const vehicleIdByJobId = new Map((jobs ?? []).map((j) => [j.id, j.vehicle_id]))
  const plateByJobId = (jobId: string) => plateByVehicleId.get(vehicleIdByJobId.get(jobId) ?? '') ?? null

  const byEmployee = new Map<
    string,
    {
      employeeId: string
      employeeName: string
      total: number
      count: number
      byService: Map<string, { name: string; total: number; count: number }>
      // Job-level entries only, keyed by (jobId, rate) -- NOT just jobId. A correction's reversal
      // row carries the SAME rate as the entry it cancels, so summing per (job, rate) naturally
      // nets a fully-superseded rate to ~0 while the new rate's subtotal stays correct. Picking
      // "whichever row is latest" instead is unreliable: a reversal + its correction are written
      // in the same transaction and can share the exact same created_at, making "latest" a coin
      // flip on query result order.
      jobLevelByJobRate: Map<string, { jobId: string; rate: number; netAmount: number; lastCreatedAt: string; grossAmount: number }>
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
        jobLevelByJobRate: new Map(),
      })
    }
    const bucket = byEmployee.get(entry.employee_id)!
    bucket.total += entry.commission_amount
    bucket.count += 1

    if (!entry.service_id) {
      const key = `${entry.job_id}:${entry.commission_rate}`
      const existing = bucket.jobLevelByJobRate.get(key)
      if (!existing) {
        bucket.jobLevelByJobRate.set(key, {
          jobId: entry.job_id,
          rate: entry.commission_rate,
          netAmount: entry.commission_amount,
          lastCreatedAt: entry.created_at,
          grossAmount: entry.gross_service_amount,
        })
      } else {
        existing.netAmount += entry.commission_amount
        if (entry.created_at > existing.lastCreatedAt) existing.lastCreatedAt = entry.created_at
      }
      continue
    }

    const serviceName = serviceNameById.get(entry.service_id) ?? 'Unknown'
    if (!bucket.byService.has(entry.service_id)) {
      bucket.byService.set(entry.service_id, { name: serviceName, total: 0, count: 0 })
    }
    const serviceBucket = bucket.byService.get(entry.service_id)!
    serviceBucket.total += entry.commission_amount
    serviceBucket.count += 1
  }

  const employeeReports = [...byEmployee.values()].map((emp) => {
    // A job's subtotal at a given rate nets to ~0 once fully reversed, so it naturally drops out
    // of that rate's bucket on its own -- no "which row is current" guesswork needed.
    const byRate = new Map<number, { rate: number; count: number; total: number; jobs: CommissionRateJob[] }>()
    for (const jobRate of emp.jobLevelByJobRate.values()) {
      if (Math.abs(jobRate.netAmount) < 0.005) continue
      if (!byRate.has(jobRate.rate)) byRate.set(jobRate.rate, { rate: jobRate.rate, count: 0, total: 0, jobs: [] })
      const rateBucket = byRate.get(jobRate.rate)!
      rateBucket.count += 1
      rateBucket.total += jobRate.netAmount
      rateBucket.jobs.push({
        jobId: jobRate.jobId,
        jobNumber: jobNumberById.get(jobRate.jobId) ?? jobRate.jobId.slice(0, 8),
        plateNumber: plateByJobId(jobRate.jobId),
        date: jobRate.lastCreatedAt,
        grossAmount: jobRate.grossAmount,
        commissionAmount: jobRate.netAmount,
      })
    }
    for (const rateBucket of byRate.values()) {
      rateBucket.jobs.sort((a, b) => b.date.localeCompare(a.date))
    }

    return {
      employeeId: emp.employeeId,
      employeeName: emp.employeeName,
      total: emp.total,
      byService: [...emp.byService.values()],
      byRate: [...byRate.values()].sort((a, b) => b.rate - a.rate),
    }
  })

  return {
    grandTotal: (entries ?? []).reduce((sum, e) => sum + e.commission_amount, 0),
    employees: employeeReports.sort((a, b) => b.total - a.total),
  }
}
