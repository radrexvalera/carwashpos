import { db } from '@/lib/db/dexie'
import { supabase } from '@/lib/supabase/client'
import type { Json } from '@/lib/supabase/types'
import { flushMutationQueue } from '@/lib/offline/syncEngine'

export async function getJobForPayment(jobId: string) {
  const { data: job, error: jobError } = await supabase.from('jobs').select('*').eq('id', jobId).single()
  if (jobError) throw jobError

  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', job.vehicle_id)
    .single()
  if (vehicleError) throw vehicleError

  const { data: location, error: locationError } = await supabase
    .from('locations')
    .select('name')
    .eq('id', job.location_id)
    .single()
  if (locationError) throw locationError

  const { data: jobServices, error: servicesError } = await supabase
    .from('job_services')
    .select('*')
    .eq('job_id', jobId)
    .neq('status', 'cancelled')
  if (servicesError) throw servicesError

  const serviceIds = (jobServices ?? []).map((js) => js.service_id)
  const { data: services, error: servicesLookupError } = await supabase.from('services').select('id, name').in('id', serviceIds)
  if (servicesLookupError) throw servicesLookupError

  const serviceNameById = new Map((services ?? []).map((s) => [s.id, s.name]))

  const { data: retailItems, error: retailError } = await supabase
    .from('inventory_stock_levels')
    .select('*')
    .eq('item_type', 'retail')
    .eq('is_active', true)
  if (retailError) throw retailError

  const jobServiceIds = (jobServices ?? []).map((js) => js.id)
  const { data: attendants, error: attendantsError } = jobServiceIds.length
    ? await supabase.from('job_service_attendants').select('employee_id').in('job_service_id', jobServiceIds)
    : { data: [], error: null }
  if (attendantsError) throw attendantsError
  const employeeIds = [...new Set((attendants ?? []).map((a) => a.employee_id))]
  const { data: crewRows, error: crewError } = employeeIds.length
    ? await supabase.from('employees').select('id, full_name, nickname').in('id', employeeIds)
    : { data: [], error: null }
  if (crewError) throw crewError
  const crewNames = (crewRows ?? []).map((e) => e.nickname || e.full_name)

  let customer: { id: string; full_name: string } | null = null
  if (vehicle.customer_id) {
    const { data: customerData, error: customerError } = await supabase
      .from('customers')
      .select('id, full_name')
      .eq('id', vehicle.customer_id)
      .single()
    if (customerError) throw customerError
    customer = customerData
  }

  return {
    job,
    vehicle,
    locationName: location.name,
    jobServices: (jobServices ?? []).map((js) => ({ ...js, serviceName: serviceNameById.get(js.service_id) ?? 'Service' })),
    retailItems: retailItems ?? [],
    customer,
    crewNames,
  }
}

// Offline fallback for getJobForPayment() -- reads the exact same shape from Dexie instead of live
// Supabase queries. boardJobs/jobServiceLines are kept fresh by refreshJobBoardCache() (polled +
// realtime while the Job Queue is open, which is how a cashier reaches this page in the first
// place), so a job that was visible on the queue recently has what's needed here. Retail items and
// the customer name are left out -- Receipt doesn't use either, and they're not worth caching a
// whole separate read-path for just showing in the page header or upselling a product offline.
// Crew comes from boardJobs' own already-cached attendantsSummary string instead of a fresh
// job_service_attendants query.
export async function getJobForPaymentOffline(jobId: string, tenantId: string) {
  const boardJob = await db.boardJobs.get(jobId)
  if (!boardJob) {
    throw new Error("This job isn't cached for offline use yet -- open the Job Queue once while online, then try again.")
  }
  if (boardJob.isPaid) {
    throw new Error('This job has already been paid.')
  }

  const jobServices = await db.jobServiceLines.where('jobId').equals(jobId).toArray()
  if (jobServices.length === 0) {
    throw new Error("This job's services aren't cached for offline use yet -- open the Job Queue once while online, then try again.")
  }

  const locations = await db.locations.where('tenant_id').equals(tenantId).toArray()

  return {
    job: { job_number: boardJob.jobNumber },
    vehicle: { plate_number: boardJob.plateNumber, make: boardJob.vehicleMake, model: boardJob.vehicleModel },
    locationName: locations[0]?.name ?? '',
    jobServices: jobServices.map((js) => ({
      id: js.id,
      service_id: js.serviceId,
      unit_price: js.unitPrice,
      quantity: js.quantity,
      line_total: js.lineTotal,
      serviceName: js.serviceName,
    })),
    retailItems: [] as { id: string; name: string; retail_price: number | null }[],
    customer: null as { id: string; full_name: string } | null,
    crewNames: boardJob.attendantsSummary ? boardJob.attendantsSummary.split(', ') : [],
  }
}

interface CreateSaleInput {
  tenantId: string
  shiftId: string
  jobId: string | null
  lineItems: { jobServiceId: string; discountAmount: number }[]
  productLines: { itemId: string; quantity: number }[]
  payments: { method: string; amount: number; referenceNote?: string; tenderedAmount?: number; changeGiven?: number }[]
  manualDiscountType?: 'percentage' | 'fixed'
  manualDiscountValue?: number
}

// Promotions/loyalty/memberships/fleet billing are disabled for now (nav + Collect Payment UI both
// removed) -- create_sale() still accepts these fields, so this just always sends the "off" values
// rather than threading unused params through from the caller.
//
// clientGeneratedId is accepted (not always generated fresh in here) so a caller that first tries
// this live and then falls back to queuePaymentOffline() on failure can reuse the exact same id for
// both attempts -- create_sale() is idempotent on it, so if the live call actually reached the
// server but the response was lost on the way back, the queued retry returns the sale that already
// exists instead of silently billing the customer twice.
export async function createSaleForJob(input: CreateSaleInput, clientGeneratedId: string = crypto.randomUUID()) {
  const payload = buildSalePayload(input, clientGeneratedId)
  const { data, error } = await supabase.rpc('create_sale', { payload: payload as unknown as Json })
  if (error) throw error
  return data as {
    id: string
    sale_number: string
    status: string
    total: number
    created_at: string
    promotion_discount_amount: number
    loyalty_discount_amount: number
    loyalty_points_redeemed: number
    loyalty_points_earned: number
    billing_type: string
    payment_status: string
    membership_discount_amount: number
    manual_discount_amount: number
  }
}

function buildSalePayload(input: CreateSaleInput, clientGeneratedId: string) {
  return {
    client_generated_id: clientGeneratedId,
    shift_id: input.shiftId,
    job_id: input.jobId,
    promotion_id: null,
    loyalty_points_redeemed: 0,
    billing_type: 'immediate',
    membership_redemption: null,
    manual_discount_type: input.manualDiscountType ?? null,
    manual_discount_value: input.manualDiscountValue ?? null,
    line_items: [
      ...input.lineItems.map((l) => ({
        line_type: 'job_service',
        job_service_id: l.jobServiceId,
        discount_amount: l.discountAmount,
      })),
      ...input.productLines.map((p) => ({
        line_type: 'product',
        product_id: p.itemId,
        quantity: p.quantity,
      })),
    ],
    payments: input.payments.map((p) => ({
      method: p.method,
      amount: p.amount,
      reference_note: p.referenceNote,
      tendered_amount: p.tenderedAmount,
      change_given: p.changeGiven,
    })),
  }
}

// Queues create_sale() as an offline mutation (same outbox as job creation/status updates) instead
// of calling it live -- used when the live attempt in JobPaymentPage fails. Optimistically marks
// the job "paid" in the local board cache immediately so it can't be double-submitted while the
// mutation is still in flight; refreshJobBoardCache() re-applies that same override on every
// refresh until the payment actually lands (or permanently fails), see its own comment.
export async function queuePaymentOffline(input: CreateSaleInput, clientGeneratedId: string) {
  if (!input.jobId) throw new Error('A job is required to queue an offline payment')

  await db.mutationQueue.add({
    id: crypto.randomUUID(),
    tenantId: input.tenantId,
    entity: 'job_payment',
    clientGeneratedId,
    payload: buildSalePayload(input, clientGeneratedId),
    createdAt: new Date().toISOString(),
    retryCount: 0,
    status: 'pending',
    sequence: Date.now(),
  })

  await db.boardJobs.update(input.jobId, { isPaid: true })

  void flushMutationQueue()
}
