import { supabase } from '@/lib/supabase/client'
import { localDateString } from '@/lib/date'

export async function getSalesReport(fromIso: string, toIso: string) {
  const { data: sales, error } = await supabase.from('sales').select('*').gte('created_at', fromIso).lte('created_at', toIso)
  if (error) throw error

  const completed = (sales ?? []).filter((s) => s.status === 'completed')
  const voidedCount = (sales ?? []).filter((s) => s.status === 'voided').length
  const saleIds = completed.map((s) => s.id)

  const [paymentsRes, itemsRes] = await Promise.all([
    saleIds.length
      ? supabase.from('payments').select('*').in('sale_id', saleIds)
      : Promise.resolve({ data: [], error: null }),
    saleIds.length
      ? supabase.from('sale_items').select('*').in('sale_id', saleIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (paymentsRes.error) throw paymentsRes.error
  if (itemsRes.error) throw itemsRes.error

  const byMethod = new Map<string, number>()
  for (const p of paymentsRes.data ?? []) {
    byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount)
  }

  const byService = new Map<string, { count: number; total: number }>()
  let serviceRevenue = 0
  let productRevenue = 0
  for (const item of itemsRes.data ?? []) {
    if (item.line_type === 'job_service') {
      serviceRevenue += item.line_total
      const bucket = byService.get(item.description) ?? { count: 0, total: 0 }
      bucket.count += 1
      bucket.total += item.line_total
      byService.set(item.description, bucket)
    } else {
      productRevenue += item.line_total
    }
  }

  return {
    saleCount: completed.length,
    voidedCount,
    // Net of the card processing fee -- the fee is a real cost the business absorbs, so it reduces
    // what counts as sales here too, not just Net.
    grossSales: completed.reduce((sum, s) => sum + s.total - s.card_processing_fee, 0),
    discountTotal: completed.reduce((sum, s) => sum + s.discount_total + s.manual_discount_amount, 0),
    promotionDiscountTotal: completed.reduce((sum, s) => sum + s.promotion_discount_amount, 0),
    cardProcessingFeeTotal: completed.reduce((sum, s) => sum + s.card_processing_fee, 0),
    serviceRevenue,
    productRevenue,
    byMethod: [...byMethod.entries()].map(([method, total]) => ({ method, total })).sort((a, b) => b.total - a.total),
    services: [...byService.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total),
  }
}

export async function getExpensesByCategory(fromIso: string, toIso: string) {
  const { data, error } = await supabase
    .from('expenses')
    .select('category_id, amount, is_voided')
    .gte('expense_date', fromIso)
    .lte('expense_date', toIso)
  if (error) throw error

  const active = (data ?? []).filter((e) => !e.is_voided)
  const byCategory = new Map<string, number>()
  for (const e of active) {
    byCategory.set(e.category_id, (byCategory.get(e.category_id) ?? 0) + e.amount)
  }

  const { data: categories, error: catError } = await supabase.from('expense_categories').select('id, name')
  if (catError) throw catError
  const nameById = new Map((categories ?? []).map((c) => [c.id, c.name]))

  return {
    total: active.reduce((sum, e) => sum + e.amount, 0),
    byCategory: [...byCategory.entries()]
      .map(([categoryId, total]) => ({ name: nameById.get(categoryId) ?? 'Unknown', total }))
      .sort((a, b) => b.total - a.total),
  }
}

// Advances ISSUED in the period (money that left the register), not repayments -- matches how
// Expenses is framed ("what went out"), and repayments are already tracked per-payroll-period on
// the Payroll page rather than by calendar date.
export async function getCashAdvancesSummary(fromDate: string, toDate: string) {
  const { data, error } = await supabase
    .from('cash_advances')
    .select('employee_id, amount, advance_date')
    .gte('advance_date', fromDate)
    .lte('advance_date', toDate)
  if (error) throw error

  const byEmployee = new Map<string, number>()
  for (const a of data ?? []) {
    byEmployee.set(a.employee_id, (byEmployee.get(a.employee_id) ?? 0) + a.amount)
  }

  const employeeIds = [...byEmployee.keys()]
  const { data: employees, error: empError } = employeeIds.length
    ? await supabase.from('employees').select('id, full_name').in('id', employeeIds)
    : { data: [], error: null }
  if (empError) throw empError
  const nameById = new Map((employees ?? []).map((e) => [e.id, e.full_name]))

  return {
    total: (data ?? []).reduce((sum, a) => sum + a.amount, 0),
    byEmployee: [...byEmployee.entries()]
      .map(([employeeId, total]) => ({ name: nameById.get(employeeId) ?? 'Unknown', total }))
      .sort((a, b) => b.total - a.total),
  }
}

// Sales/expenses/net/completed-jobs are for the selected range (same from/to the caller's date
// filter produces); active jobs, low stock, and pending commission are current snapshots of live
// state, not period totals, so a date range wouldn't mean anything for them -- always "right now"
// regardless of what range is selected.
export async function getDashboardSummary(fromStr: string = localDateString(), toStr: string = localDateString()) {
  const fromIso = new Date(`${fromStr}T00:00:00`).toISOString()
  const toIso = new Date(`${toStr}T23:59:59`).toISOString()

  const [salesRes, expensesRes, activeJobsRes, completedRes, lowStockRes, commissionRes] = await Promise.all([
    supabase.from('sales').select('total, status, card_processing_fee').gte('created_at', fromIso).lte('created_at', toIso),
    supabase.from('expenses').select('amount, is_voided').gte('expense_date', fromStr).lte('expense_date', toStr),
    supabase.from('jobs').select('status').not('status', 'in', '(completed,cancelled)'),
    supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed')
      .gte('completed_at', fromIso)
      .lte('completed_at', toIso),
    supabase.from('inventory_stock_levels').select('id').eq('is_low_stock', true).eq('is_active', true),
    supabase.from('commission_ledger').select('commission_amount').eq('status', 'earned'),
  ])
  for (const r of [salesRes, expensesRes, activeJobsRes, completedRes, lowStockRes, commissionRes]) {
    if (r.error) throw r.error
  }

  const completedSales = (salesRes.data ?? []).filter((s) => s.status === 'completed')
  const cardProcessingFees = completedSales.reduce((sum, s) => sum + s.card_processing_fee, 0)
  // Net of the card processing fee -- the fee is a real cost the business absorbs, so it reduces
  // what counts as sales here too, not just net. Commission is NOT subtracted here separately --
  // once a payroll period is marked paid, mark_payroll_period_paid() records it as a real expense
  // (category: Commission Payouts), so it already flows through `expenses` above. Subtracting it
  // again here would double-count it.
  const sales = completedSales.reduce((sum, s) => sum + s.total, 0) - cardProcessingFees
  const expenses = (expensesRes.data ?? []).filter((e) => !e.is_voided).reduce((sum, e) => sum + e.amount, 0)

  const jobStatusCounts: Record<string, number> = {}
  for (const j of activeJobsRes.data ?? []) {
    jobStatusCounts[j.status] = (jobStatusCounts[j.status] ?? 0) + 1
  }

  return {
    sales,
    expenses,
    cardProcessingFees,
    net: sales - expenses,
    activeJobsCount: (activeJobsRes.data ?? []).length,
    jobStatusCounts,
    completedCount: completedRes.count ?? 0,
    lowStockCount: (lowStockRes.data ?? []).length,
    pendingCommission: (commissionRes.data ?? []).reduce((sum, c) => sum + c.commission_amount, 0),
  }
}
