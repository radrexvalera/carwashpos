import { supabase } from '@/lib/supabase/client'

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
    grossSales: completed.reduce((sum, s) => sum + s.total, 0),
    discountTotal: completed.reduce((sum, s) => sum + s.discount_total, 0),
    promotionDiscountTotal: completed.reduce((sum, s) => sum + s.promotion_discount_amount, 0),
    loyaltyDiscountTotal: completed.reduce((sum, s) => sum + s.loyalty_discount_amount, 0),
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

export async function getDashboardSummary() {
  const todayStr = new Date().toISOString().slice(0, 10)
  const todayStartIso = new Date(`${todayStr}T00:00:00`).toISOString()
  const todayEndIso = new Date(`${todayStr}T23:59:59`).toISOString()

  const [salesRes, expensesRes, activeJobsRes, completedTodayRes, lowStockRes, commissionRes] = await Promise.all([
    supabase.from('sales').select('total, status').gte('created_at', todayStartIso).lte('created_at', todayEndIso),
    supabase.from('expenses').select('amount, is_voided').eq('expense_date', todayStr),
    supabase.from('jobs').select('status').not('status', 'in', '(completed,cancelled)'),
    supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed')
      .gte('completed_at', todayStartIso)
      .lte('completed_at', todayEndIso),
    supabase.from('inventory_stock_levels').select('id').eq('is_low_stock', true).eq('is_active', true),
    supabase.from('commission_ledger').select('commission_amount').eq('status', 'earned'),
  ])
  for (const r of [salesRes, expensesRes, activeJobsRes, completedTodayRes, lowStockRes, commissionRes]) {
    if (r.error) throw r.error
  }

  const todaySales = (salesRes.data ?? []).filter((s) => s.status === 'completed').reduce((sum, s) => sum + s.total, 0)
  const todayExpenses = (expensesRes.data ?? []).filter((e) => !e.is_voided).reduce((sum, e) => sum + e.amount, 0)

  const jobStatusCounts: Record<string, number> = {}
  for (const j of activeJobsRes.data ?? []) {
    jobStatusCounts[j.status] = (jobStatusCounts[j.status] ?? 0) + 1
  }

  return {
    todaySales,
    todayExpenses,
    todayNet: todaySales - todayExpenses,
    activeJobsCount: (activeJobsRes.data ?? []).length,
    jobStatusCounts,
    completedTodayCount: completedTodayRes.count ?? 0,
    lowStockCount: (lowStockRes.data ?? []).length,
    pendingCommission: (commissionRes.data ?? []).reduce((sum, c) => sum + c.commission_amount, 0),
  }
}
