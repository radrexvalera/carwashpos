import { supabase } from '@/lib/supabase/client'
import { localDateString } from '@/lib/date'

// Resolves whichever service_categories row is named "Repaint" for this tenant, and every service
// under it -- shared by getSalesReport() (which excludes these lines) and getRepaintSalesReport()
// (which totals only these lines). Returns an empty set for a tenant with no such category, which
// is the common case: that makes every repaint-aware computation below a no-op for them, so this
// never needs its own feature flag to stay invisible.
async function getRepaintServiceIds(): Promise<Set<string>> {
  const { data: category, error: catError } = await supabase
    .from('service_categories')
    .select('id')
    .ilike('name', 'Repaint')
    .limit(1)
    .maybeSingle()
  if (catError) throw catError
  if (!category) return new Set()

  const { data: categoryServices, error: servicesError } = await supabase
    .from('services')
    .select('id')
    .eq('category_id', category.id)
  if (servicesError) throw servicesError
  return new Set((categoryServices ?? []).map((s) => s.id))
}

// Test123's "All sales" feeds a report they submit to their franchise owner, and repaint work
// isn't part of that franchise deal -- so repaint revenue must be fully excluded here, not just
// broken out separately (that's what the Repaint tab is for). A sale that mixes a repaint line
// with an ordinary one (rare, but happens) has its sale-level fields -- manual discount, card fee,
// promotion/loyalty/membership discount -- apportioned between repaint and non-repaint by each
// side's share of that sale's line revenue, since those fields don't carry their own per-line
// split. Per-line discounts need no apportioning; sale_items.discount_amount is already exact per line.
export async function getSalesReport(fromIso: string, toIso: string) {
  const { data: sales, error } = await supabase.from('sales').select('*').gte('created_at', fromIso).lte('created_at', toIso)
  if (error) throw error

  const completed = (sales ?? []).filter((s) => s.status === 'completed')
  const voidedCount = (sales ?? []).filter((s) => s.status === 'voided').length
  const saleIds = completed.map((s) => s.id)

  const [paymentsRes, itemsRes, repaintServiceIds] = await Promise.all([
    saleIds.length
      ? supabase.from('payments').select('*').in('sale_id', saleIds)
      : Promise.resolve({ data: [], error: null }),
    saleIds.length
      ? supabase.from('sale_items').select('*').in('sale_id', saleIds)
      : Promise.resolve({ data: [], error: null }),
    getRepaintServiceIds(),
  ])
  if (paymentsRes.error) throw paymentsRes.error
  if (itemsRes.error) throw itemsRes.error

  const items = itemsRes.data ?? []
  const jobServiceIds = items.filter((i) => i.line_type === 'job_service' && i.job_service_id).map((i) => i.job_service_id as string)
  const { data: jobServices, error: jsError } = jobServiceIds.length
    ? await supabase.from('job_services').select('id, service_id').in('id', jobServiceIds)
    : { data: [], error: null }
  if (jsError) throw jsError
  const serviceIdByJobServiceId = new Map((jobServices ?? []).map((js) => [js.id, js.service_id]))

  function isRepaintItem(item: (typeof items)[number]) {
    if (item.line_type !== 'job_service' || !item.job_service_id) return false
    const serviceId = serviceIdByJobServiceId.get(item.job_service_id)
    return !!serviceId && repaintServiceIds.has(serviceId)
  }

  const itemsBySale = new Map<string, typeof items>()
  for (const item of items) {
    const bucket = itemsBySale.get(item.sale_id) ?? []
    bucket.push(item)
    itemsBySale.set(item.sale_id, bucket)
  }

  const byService = new Map<string, { count: number; total: number }>()
  let serviceRevenue = 0
  let productRevenue = 0
  let grossSales = 0
  let discountTotal = 0
  let promotionDiscountTotal = 0
  let cardProcessingFeeTotal = 0
  // sale id -> the fraction of that sale's line revenue that is NOT repaint, used again below to
  // apportion each of its payments the same way when building the by-method breakdown.
  const nonRepaintFractionBySale = new Map<string, number>()

  for (const sale of completed) {
    const saleItems = itemsBySale.get(sale.id) ?? []
    const saleItemsTotal = saleItems.reduce((sum, i) => sum + i.line_total, 0)
    const nonRepaintItems = saleItems.filter((i) => !isRepaintItem(i))
    const nonRepaintItemsTotal = nonRepaintItems.reduce((sum, i) => sum + i.line_total, 0)
    const fraction = saleItemsTotal > 0 ? nonRepaintItemsTotal / saleItemsTotal : 1
    nonRepaintFractionBySale.set(sale.id, fraction)

    for (const item of nonRepaintItems) {
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

    const nonRepaintCardFee = sale.card_processing_fee * fraction
    const nonRepaintSaleLevelDiscount =
      (sale.manual_discount_amount + sale.promotion_discount_amount + sale.loyalty_discount_amount + sale.membership_discount_amount) * fraction

    // Net of the card processing fee -- the fee is a real cost the business absorbs, so it reduces
    // what counts as sales here too, not just Net.
    grossSales += nonRepaintItemsTotal - nonRepaintSaleLevelDiscount - nonRepaintCardFee
    discountTotal += nonRepaintItems.reduce((sum, i) => sum + i.discount_amount, 0) + sale.manual_discount_amount * fraction
    promotionDiscountTotal += sale.promotion_discount_amount * fraction
    cardProcessingFeeTotal += nonRepaintCardFee
  }

  const byMethod = new Map<string, number>()
  for (const p of paymentsRes.data ?? []) {
    const fraction = nonRepaintFractionBySale.get(p.sale_id) ?? 1
    byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount * fraction)
  }

  return {
    saleCount: completed.length,
    voidedCount,
    grossSales,
    discountTotal,
    promotionDiscountTotal,
    cardProcessingFeeTotal,
    serviceRevenue,
    productRevenue,
    byMethod: [...byMethod.entries()].map(([method, total]) => ({ method, total })).sort((a, b) => b.total - a.total),
    services: [...byService.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total),
  }
}

// Scoped to whichever service_categories row is named "Repaint" for this tenant -- repaint is a
// non-carwash service line sold alongside regular car wash jobs, so owners want its own revenue
// total separate from the main Sales Report instead of buried inside "Services" (and, per
// getSalesReport() above, now fully excluded from "All sales" too). Payment-method and
// discount-pool breakdowns don't carry over here: those are sale-level (a repaint line can share a
// sale/payment with ordinary wash services), so this report only totals what's directly
// attributable to repaint line items themselves.
export async function getRepaintSalesReport(fromIso: string, toIso: string) {
  const { data: category, error: catError } = await supabase
    .from('service_categories')
    .select('id, name')
    .ilike('name', 'Repaint')
    .limit(1)
    .maybeSingle()
  if (catError) throw catError
  if (!category) {
    return { categoryFound: false as const }
  }

  const { data: categoryServices, error: servicesError } = await supabase
    .from('services')
    .select('id')
    .eq('category_id', category.id)
  if (servicesError) throw servicesError
  const categoryServiceIds = (categoryServices ?? []).map((s) => s.id)

  if (categoryServiceIds.length === 0) {
    return { categoryFound: true as const, categoryName: category.name, totalRevenue: 0, discountTotal: 0, lineCount: 0, jobCount: 0, byService: [], rows: [] }
  }

  const { data: jobServices, error: jobServicesError } = await supabase
    .from('job_services')
    .select('id, job_id, service_id')
    .in('service_id', categoryServiceIds)
  if (jobServicesError) throw jobServicesError
  const jobServiceIds = (jobServices ?? []).map((js) => js.id)
  const jobIdByJobServiceId = new Map((jobServices ?? []).map((js) => [js.id, js.job_id]))

  if (jobServiceIds.length === 0) {
    return { categoryFound: true as const, categoryName: category.name, totalRevenue: 0, discountTotal: 0, lineCount: 0, jobCount: 0, byService: [], rows: [] }
  }

  const { data: sales, error: salesError } = await supabase
    .from('sales')
    .select('id, sale_number, created_at, status')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .eq('status', 'completed')
  if (salesError) throw salesError
  const saleIds = (sales ?? []).map((s) => s.id)
  const saleById = new Map((sales ?? []).map((s) => [s.id, s]))

  if (saleIds.length === 0) {
    return { categoryFound: true as const, categoryName: category.name, totalRevenue: 0, discountTotal: 0, lineCount: 0, jobCount: 0, byService: [], rows: [] }
  }

  const { data: items, error: itemsError } = await supabase
    .from('sale_items')
    .select('*')
    .in('sale_id', saleIds)
    .in('job_service_id', jobServiceIds)
  if (itemsError) throw itemsError

  const matched = items ?? []
  const jobIds = [...new Set(matched.map((i) => jobIdByJobServiceId.get(i.job_service_id!)).filter((id): id is string => !!id))]

  const jobsRes = jobIds.length
    ? await supabase.from('jobs').select('id, job_number, vehicle_id').in('id', jobIds)
    : { data: [], error: null }
  if (jobsRes.error) throw jobsRes.error
  const jobById = new Map((jobsRes.data ?? []).map((j) => [j.id, j]))
  const vehicleIds = [...new Set((jobsRes.data ?? []).map((j) => j.vehicle_id).filter((id): id is string => !!id))]
  const { data: vehicles, error: vehiclesError } = vehicleIds.length
    ? await supabase.from('vehicles').select('id, plate_number').in('id', vehicleIds)
    : { data: [], error: null }
  if (vehiclesError) throw vehiclesError
  const plateByVehicleId = new Map((vehicles ?? []).map((v) => [v.id, v.plate_number]))

  const byService = new Map<string, { count: number; total: number }>()
  const rows = matched.map((item) => {
    const bucket = byService.get(item.description) ?? { count: 0, total: 0 }
    bucket.count += 1
    bucket.total += item.line_total
    byService.set(item.description, bucket)

    const jobId = jobIdByJobServiceId.get(item.job_service_id!) ?? null
    const job = jobId ? jobById.get(jobId) : undefined
    const sale = saleById.get(item.sale_id)
    return {
      saleNumber: sale?.sale_number ?? '—',
      date: sale?.created_at ?? item.created_at,
      jobNumber: job?.job_number ?? '—',
      plateNumber: job?.vehicle_id ? (plateByVehicleId.get(job.vehicle_id) ?? '—') : '—',
      serviceName: item.description,
      amount: item.line_total,
      discountAmount: item.discount_amount,
    }
  })
  rows.sort((a, b) => b.date.localeCompare(a.date))

  return {
    categoryFound: true as const,
    categoryName: category.name,
    totalRevenue: matched.reduce((sum, i) => sum + i.line_total, 0),
    discountTotal: matched.reduce((sum, i) => sum + i.discount_amount, 0),
    lineCount: matched.length,
    jobCount: jobIds.length,
    byService: [...byService.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total),
    rows,
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
