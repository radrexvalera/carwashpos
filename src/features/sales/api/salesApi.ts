import { supabase } from '@/lib/supabase/client'

export interface SaleListRow {
  id: string
  saleNumber: string
  createdAt: string
  plateNumber: string | null
  customerName: string | null
  total: number
  paymentStatus: string
  status: string
}

// Manual joins throughout -- this codebase's hand-written types.ts has empty Relationships on
// every table, so Supabase's embedded-select syntax doesn't type-check here even where it might
// work at runtime (established pattern, see jobPaymentApi.ts).
async function buildSaleRows(sales: { id: string; sale_number: string; created_at: string; job_id: string | null; customer_id: string | null; total: number; payment_status: string; status: string }[]): Promise<SaleListRow[]> {
  const jobIds = [...new Set(sales.map((s) => s.job_id).filter((id): id is string => !!id))]
  const customerIds = [...new Set(sales.map((s) => s.customer_id).filter((id): id is string => !!id))]

  const [jobsRes, customersRes] = await Promise.all([
    jobIds.length ? supabase.from('jobs').select('id, vehicle_id').in('id', jobIds) : Promise.resolve({ data: [], error: null }),
    customerIds.length
      ? supabase.from('customers').select('id, full_name').in('id', customerIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (jobsRes.error) throw jobsRes.error
  if (customersRes.error) throw customersRes.error

  const vehicleIds = [...new Set((jobsRes.data ?? []).map((j) => j.vehicle_id))]
  const vehiclesRes = vehicleIds.length
    ? await supabase.from('vehicles').select('id, plate_number').in('id', vehicleIds)
    : { data: [], error: null }
  if (vehiclesRes.error) throw vehiclesRes.error

  const plateByVehicleId = new Map((vehiclesRes.data ?? []).map((v) => [v.id, v.plate_number]))
  const vehicleIdByJobId = new Map((jobsRes.data ?? []).map((j) => [j.id, j.vehicle_id]))
  const nameByCustomerId = new Map((customersRes.data ?? []).map((c) => [c.id, c.full_name]))

  return sales.map((s) => ({
    id: s.id,
    saleNumber: s.sale_number,
    createdAt: s.created_at,
    plateNumber: s.job_id ? (plateByVehicleId.get(vehicleIdByJobId.get(s.job_id) ?? '') ?? null) : null,
    customerName: s.customer_id ? (nameByCustomerId.get(s.customer_id) ?? null) : null,
    total: s.total,
    paymentStatus: s.payment_status,
    status: s.status,
  }))
}

export async function listSales(fromIso: string, toIso: string): Promise<SaleListRow[]> {
  const { data: sales, error } = await supabase
    .from('sales')
    .select('*')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return buildSaleRows(sales ?? [])
}

// Ignores the date range entirely -- a plate search means "this vehicle's full history",
// not "this vehicle's history in the last week."
export async function listSalesByPlate(plateNumber: string): Promise<SaleListRow[]> {
  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id')
    .ilike('plate_number', `%${plateNumber}%`)
  if (vehiclesError) throw vehiclesError
  const vehicleIds = (vehicles ?? []).map((v) => v.id)
  if (vehicleIds.length === 0) return []

  const { data: jobs, error: jobsError } = await supabase.from('jobs').select('id').in('vehicle_id', vehicleIds)
  if (jobsError) throw jobsError
  const jobIds = (jobs ?? []).map((j) => j.id)
  if (jobIds.length === 0) return []

  const { data: sales, error: salesError } = await supabase
    .from('sales')
    .select('*')
    .in('job_id', jobIds)
    .order('created_at', { ascending: false })
    .limit(200)
  if (salesError) throw salesError
  return buildSaleRows(sales ?? [])
}

export interface SaleDetail {
  id: string
  status: string
  saleNumber: string
  createdAt: string
  locationName: string
  jobId: string | null
  plateNumber: string | null
  vehicleModel: string | null
  crewNames: string[]
  items: { name: string; quantity: number; unitPrice: number; lineTotal: number }[]
  subtotal: number
  manualDiscount: number
  promotionDiscount: number
  membershipDiscount: number
  cardProcessingFee: number
  total: number
  payments: { methodLabel: string; amount: number; tenderedAmount?: number; changeGiven?: number }[]
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  gcash: 'GCash',
  maya: 'Maya',
  bank_transfer: 'Bank Transfer',
  card: 'Card',
  maribank: 'Maribank',
  gotyme: 'GoTyme',
  rcbc: 'RCBC',
  bpi: 'BPI',
  unionbank: 'UnionBank',
  qrph: 'QR Ph',
}

export async function getSaleDetail(saleId: string): Promise<SaleDetail> {
  const { data: sale, error: saleError } = await supabase.from('sales').select('*').eq('id', saleId).single()
  if (saleError) throw saleError

  const [itemsRes, paymentsRes, locationRes] = await Promise.all([
    supabase.from('sale_items').select('*').eq('sale_id', saleId),
    supabase.from('payments').select('*').eq('sale_id', saleId),
    supabase.from('locations').select('name').eq('id', sale.location_id).single(),
  ])
  if (itemsRes.error) throw itemsRes.error
  if (paymentsRes.error) throw paymentsRes.error
  if (locationRes.error) throw locationRes.error

  let plateNumber: string | null = null
  let vehicleModel: string | null = null
  if (sale.job_id) {
    const { data: job } = await supabase.from('jobs').select('vehicle_id').eq('id', sale.job_id).single()
    if (job) {
      const { data: vehicle } = await supabase.from('vehicles').select('plate_number, model').eq('id', job.vehicle_id).single()
      plateNumber = vehicle?.plate_number ?? null
      vehicleModel = vehicle?.model ?? null
    }
  }

  // Crew for the specific job_service lines this sale actually billed, not the whole job --
  // matches what the customer is being charged for on this particular receipt.
  const jobServiceIds = (itemsRes.data ?? []).map((i) => i.job_service_id).filter((id): id is string => !!id)
  const { data: attendants, error: attendantsError } = jobServiceIds.length
    ? await supabase.from('job_service_attendants').select('employee_id').in('job_service_id', jobServiceIds)
    : { data: [], error: null }
  if (attendantsError) throw attendantsError

  const employeeIds = [...new Set((attendants ?? []).map((a) => a.employee_id))]
  const { data: employees, error: employeesError } = employeeIds.length
    ? await supabase.from('employees').select('id, full_name, nickname').in('id', employeeIds)
    : { data: [], error: null }
  if (employeesError) throw employeesError
  const crewNames = (employees ?? []).map((e) => e.nickname || e.full_name)

  return {
    id: sale.id,
    status: sale.status,
    saleNumber: sale.sale_number,
    createdAt: sale.created_at,
    locationName: locationRes.data.name,
    jobId: sale.job_id,
    plateNumber,
    vehicleModel,
    crewNames,
    items: (itemsRes.data ?? []).map((i) => ({
      name: i.description,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      lineTotal: i.line_total,
    })),
    subtotal: sale.subtotal,
    manualDiscount: sale.manual_discount_amount,
    promotionDiscount: sale.promotion_discount_amount,
    membershipDiscount: sale.membership_discount_amount,
    cardProcessingFee: sale.card_processing_fee,
    total: sale.total,
    payments: (paymentsRes.data ?? []).map((p) => ({
      methodLabel: METHOD_LABELS[p.method] ?? p.method,
      amount: p.amount,
      tenderedAmount: p.tendered_amount ?? undefined,
      changeGiven: p.change_given ?? undefined,
    })),
  }
}

export async function voidSale(saleId: string, reason: string, reverseCommission: boolean) {
  const { data, error } = await supabase.rpc('void_sale', {
    p_sale_id: saleId,
    p_reason: reason,
    p_reverse_commission: reverseCommission,
  })
  if (error) throw error
  return data as { id: string; status: string; commission_reversed_count: number; commission_skipped_count: number }
}
