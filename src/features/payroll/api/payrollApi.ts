import { supabase } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

type PayrollPeriod = Database['public']['Tables']['payroll_periods']['Row']
type PayrollEntry = Database['public']['Tables']['payroll_entries']['Row']
type PayrollAdjustment = Database['public']['Tables']['payroll_adjustments']['Row']
type CashAdvance = Database['public']['Tables']['cash_advances']['Row']
type CashAdvanceRepayment = Database['public']['Tables']['cash_advance_repayments']['Row']

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
  fields: Partial<{
    base_pay: number
    tips: number
    bonus: number
    cash_advance: number
    deductions: number
    adjustments: number
    withholding_tax: number
    sss_contribution: number
    philhealth_contribution: number
    pagibig_contribution: number
    sss_loan: number
    hdmf_loan: number
  }>,
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

export async function listOutstandingCashAdvances() {
  const { data: advances, error } = await supabase
    .from('cash_advances')
    .select('*')
    .eq('status', 'outstanding')
    .order('advance_date', { ascending: true })
  if (error) throw error

  const employeeIds = [...new Set((advances ?? []).map((a) => a.employee_id))]
  const { data: employees } = employeeIds.length
    ? await supabase.from('employees').select('id, full_name').in('id', employeeIds)
    : { data: [] }
  const nameById = new Map((employees ?? []).map((e) => [e.id, e.full_name]))

  return (advances ?? []).map((a) => ({ ...a, employeeName: nameById.get(a.employee_id) ?? 'Unknown' }))
}

export async function createCashAdvance(input: { employeeId: string; amount: number; advanceDate: string; reason: string | null }) {
  const { data, error } = await supabase.rpc('create_cash_advance', {
    p_employee_id: input.employeeId,
    p_amount: input.amount,
    p_advance_date: input.advanceDate,
    p_reason: input.reason,
  })
  if (error) throw error
  return data as { id: string }
}

export async function listCashAdvanceRepayments(payrollEntryId: string) {
  const { data, error } = await supabase
    .from('cash_advance_repayments')
    .select('*')
    .eq('payroll_entry_id', payrollEntryId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function recordCashAdvanceRepayment(cashAdvanceId: string, payrollEntryId: string, amount: number) {
  const { data, error } = await supabase.rpc('record_cash_advance_repayment', {
    p_cash_advance_id: cashAdvanceId,
    p_payroll_entry_id: payrollEntryId,
    p_amount: amount,
  })
  if (error) throw error
  return data as { id: string; remaining_balance: number }
}

export async function voidCashAdvanceRepayment(repaymentId: string) {
  const { error } = await supabase.rpc('void_cash_advance_repayment', { p_repayment_id: repaymentId })
  if (error) throw error
}

export async function getCashAdvancesByIds(ids: string[]) {
  if (ids.length === 0) return []
  const { data, error } = await supabase.from('cash_advances').select('*').in('id', ids)
  if (error) throw error
  return data
}

export async function listPayrollDeductions(payrollEntryId: string) {
  const { data, error } = await supabase
    .from('payroll_deductions')
    .select('*')
    .eq('payroll_entry_id', payrollEntryId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function addPayrollDeduction(payrollEntryId: string, amount: number, reason: string) {
  const { data, error } = await supabase.rpc('add_payroll_deduction', {
    p_payroll_entry_id: payrollEntryId,
    p_amount: amount,
    p_reason: reason,
  })
  if (error) throw error
  return data as { id: string }
}

export async function removePayrollDeduction(deductionId: string) {
  const { error } = await supabase.rpc('remove_payroll_deduction', { p_deduction_id: deductionId })
  if (error) throw error
}

export type { PayrollPeriod, PayrollEntry, PayrollAdjustment, CashAdvance, CashAdvanceRepayment }
export type PayrollDeduction = Database['public']['Tables']['payroll_deductions']['Row']
