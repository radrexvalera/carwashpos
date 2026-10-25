import { supabase } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

type CashierShift = Database['public']['Tables']['cashier_shifts']['Row']
type CashMovement = Database['public']['Tables']['cash_movements']['Row']

export async function getActiveShift() {
  const { data: employeeId, error: employeeError } = await supabase.rpc('current_employee_id')
  if (employeeError) throw employeeError
  if (!employeeId) return null

  const { data, error } = await supabase
    .from('cashier_shifts')
    .select('*')
    .eq('cashier_id', employeeId)
    .eq('status', 'open')
    .maybeSingle()
  if (error) throw error
  return data
}

export async function openShift(input: { tenantId: string; locationId: string; openingFloat: number }) {
  const { data: employeeId, error: employeeError } = await supabase.rpc('current_employee_id')
  if (employeeError) throw employeeError
  if (!employeeId) throw new Error('No employee record linked to your login -- ask an admin to add you as an employee.')

  const { data, error } = await supabase
    .from('cashier_shifts')
    .insert({
      tenant_id: input.tenantId,
      location_id: input.locationId,
      cashier_id: employeeId,
      opening_float: input.openingFloat,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export interface ShiftSummary {
  openingFloat: number
  cashSales: number
  cashIn: number
  cashOut: number
  cashExpenses: number
  cashAdvances: number
  expectedCash: number
  byMethod: Record<string, number>
}

export async function getShiftSummary(shiftId: string): Promise<ShiftSummary> {
  const { data, error } = await supabase.rpc('get_shift_summary', { p_shift_id: shiftId })
  if (error) throw error
  const d = data as {
    opening_float: number
    cash_sales: number
    cash_in: number
    cash_out: number
    cash_expenses: number
    cash_advances: number
    expected_cash: number
    by_method: Record<string, number>
  }
  return {
    openingFloat: d.opening_float,
    cashSales: d.cash_sales,
    cashIn: d.cash_in,
    cashOut: d.cash_out,
    cashExpenses: d.cash_expenses,
    cashAdvances: d.cash_advances,
    expectedCash: d.expected_cash,
    byMethod: d.by_method,
  }
}

export async function closeShift(shiftId: string, countedCash: number, varianceReason?: string) {
  const { data, error } = await supabase.rpc('close_shift', {
    p_shift_id: shiftId,
    p_counted_cash: countedCash,
    p_variance_reason: varianceReason,
  })
  if (error) throw error
  return data as { id: string; status: string; expected_cash: number; counted_cash: number; variance: number }
}

export async function recordCashMovement(input: {
  tenantId: string
  shiftId: string
  type: 'cash_in' | 'cash_out'
  amount: number
  category: string
  reason: string | null
  createdBy: string
}) {
  const { error } = await supabase.from('cash_movements').insert({
    tenant_id: input.tenantId,
    shift_id: input.shiftId,
    type: input.type,
    amount: input.amount,
    category: input.category,
    reason: input.reason,
    created_by: input.createdBy,
  })
  if (error) throw error
}

export async function listCashMovements(shiftId: string) {
  const { data, error } = await supabase
    .from('cash_movements')
    .select('*')
    .eq('shift_id', shiftId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export type { CashierShift, CashMovement }
