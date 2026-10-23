import { supabase } from '@/lib/supabase/client'

// RLS already restricts commission_ledger to the caller's own rows unless they have
// can_view_all_commissions, but we still explicitly scope to "my own" here -- an admin/manager
// viewing THEIR OWN dashboard should only ever see their personal earnings, not everyone's.
export async function getMyCommissionDashboard() {
  const { data: employeeId, error: employeeError } = await supabase.rpc('current_employee_id')
  if (employeeError) throw employeeError
  if (!employeeId) return null

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const { data: entries, error } = await supabase
    .from('commission_ledger')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error

  const jobIds = [...new Set((entries ?? []).map((e) => e.job_id))]
  const serviceIds = [...new Set((entries ?? []).map((e) => e.service_id).filter((id): id is string => !!id))]

  const [{ data: jobs }, { data: services }] = await Promise.all([
    jobIds.length ? supabase.from('jobs').select('id, job_number').in('id', jobIds) : Promise.resolve({ data: [] }),
    serviceIds.length
      ? supabase.from('services').select('id, name').in('id', serviceIds)
      : Promise.resolve({ data: [] }),
  ])

  const jobNumberById = new Map((jobs ?? []).map((j) => [j.id, j.job_number]))
  const serviceNameById = new Map((services ?? []).map((s) => [s.id, s.name]))

  const enriched = (entries ?? []).map((e) => ({
    ...e,
    jobNumber: jobNumberById.get(e.job_id) ?? '',
    // Job-level commission (commission_type 'job_percentage') has no single service_id, and its
    // rate can differ across a job's own rows after a correction, so label by job, not rate.
    serviceName: e.service_id ? (serviceNameById.get(e.service_id) ?? '') : `Job commission (${jobNumberById.get(e.job_id) ?? ''})`,
  }))

  // No status filter here either -- a reversal row's negative amount must be summed in to net
  // against the mistaken entry it corrects, not excluded (see commissionReportApi.ts).
  const todayEntries = enriched.filter((e) => new Date(e.created_at) >= startOfToday)

  return {
    todayCommission: todayEntries.reduce((sum, e) => sum + e.commission_amount, 0),
    todayServicesCount: todayEntries.length,
    todayCarsCount: new Set(todayEntries.map((e) => e.job_id)).size,
    todayPending: enriched
      .filter((e) => new Date(e.created_at) >= startOfToday && e.status === 'pending')
      .reduce((sum, e) => sum + e.commission_amount, 0),
    recent: enriched.slice(0, 30),
  }
}
