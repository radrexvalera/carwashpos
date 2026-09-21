import { supabase } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

type PayrollPeriod = Database['public']['Tables']['payroll_periods']['Row']
type PayrollEntry = Database['public']['Tables']['payroll_entries']['Row']
type PayrollAdjustment = Database['public']['Tables']['payroll_adjustments']['Row']

export async function listPayrollPeriods() {
  const { data, error } = await supabase.from('payroll_periods').select('*').order('start_date', { ascending: false })
  if (error) throw error
  return data
}

export async function generatePayrollPeriod(periodType: string, startDate: string, endDate: string) {
  const { data, error } = await supabase.rpc('generate_payroll_period', {
    p_period_type: periodType,
    p_start_date: startDate,
    p_end_date: endDate,
  })
  if (error) throw error
  return data as { id: string; status: string; entries_created: number }
}

export async function listPayrollEntries(periodId: string) {
  const { data: entries, error } = await supabase
    .from('payroll_entries')
    .select('*')
    .eq('payroll_period_id', periodId)
  if (error) throw error

  const employeeIds = [...new Set((entries ?? []).map((e) => e.employee_id))]
  const { data: employees } = employeeIds.length
    ? await supabase.from('employees').select('id, full_name').in('id', employeeIds)
    : { data: [] }
  const nameById = new Map((employees ?? []).map((e) => [e.id, e.full_name]))

  return (entries ?? [])
    .map((e) => ({ ...e, employeeName: nameById.get(e.employee_id) ?? 'Unknown' }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
}

export async function updatePayrollEntry(
  id: string,
  fields: Partial<{ base_pay: number; tips: number; bonus: number; cash_advance: number; deductions: number; adjustments: number }>,
) {
  const { error } = await supabase.from('payroll_entries').update(fields).eq('id', id)
  if (error) throw error
}

export async function lockPayrollPeriod(periodId: string) {
  const { error } = await supabase.rpc('lock_payroll_period', { p_period_id: periodId })
  if (error) throw error
}

export async function markPayrollPeriodPaid(periodId: string) {
  const { error } = await supabase.rpc('mark_payroll_period_paid', { p_period_id: periodId })
  if (error) throw error
}

export async function listPayrollAdjustments(entryId: string) {
  const { data, error } = await supabase
    .from('payroll_adjustments')
    .select('*')
    .eq('payroll_entry_id', entryId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function addPayrollAdjustment(input: { tenantId: string; entryId: string; amount: number; reason: string; createdBy: string }) {
  const { error } = await supabase.from('payroll_adjustments').insert({
    tenant_id: input.tenantId,
    payroll_entry_id: input.entryId,
    amount: input.amount,
    reason: input.reason,
    created_by: input.createdBy,
  })
  if (error) throw error
}

export type { PayrollPeriod, PayrollEntry, PayrollAdjustment }
