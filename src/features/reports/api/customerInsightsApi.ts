import { supabase } from '@/lib/supabase/client'

// PostgREST caps every response at 1000 rows, and retention needs full visit history (a "new"
// customer is one whose first-ever visit falls in the period), so these reads page through
// everything rather than trusting a single select. Ordered by id so pages never overlap or skip.
const PAGE_SIZE = 1000

async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) return rows
  }
}

export interface CustomerStat {
  key: string
  name: string
  // Walk-ins have no customer record, so the plate IS the identity -- most car-wash regulars are
  // only ever known by their plate, and leaving them out would hide most of the real retention.
  isWalkIn: boolean
  plates: string[]
  mobile: string | null
  visits: number
  spend: number
  lastVisit: string
  lifetimeVisits: number
  lifetimeSpend: number
  firstVisit: string
}

const DAY_MS = 24 * 60 * 60 * 1000

// A "visit" is a non-cancelled job (every job has a vehicle, so every visit is attributable).
// Spend is the sale total the customer actually paid -- not net of the card processing fee, since
// that fee is the shop's cost, not less money from the customer. Identity follows the vehicle's
// CURRENT customer link, so a walk-in plate later registered to a customer folds its history in.
export async function getCustomerInsights(fromIso: string, toIso: string, lapseDays: number) {
  const [jobs, sales, vehicles, customers] = await Promise.all([
    fetchAllRows((a, b) =>
      supabase.from('jobs').select('id, vehicle_id, created_at').neq('status', 'cancelled').order('id').range(a, b),
    ),
    fetchAllRows((a, b) =>
      supabase.from('sales').select('id, job_id, customer_id, total').eq('status', 'completed').order('id').range(a, b),
    ),
    fetchAllRows((a, b) => supabase.from('vehicles').select('id, plate_number, customer_id').order('id').range(a, b)),
    fetchAllRows((a, b) => supabase.from('customers').select('id, full_name, mobile').order('id').range(a, b)),
  ])

  const vehicleById = new Map(vehicles.map((v) => [v.id, v]))
  const customerById = new Map(customers.map((c) => [c.id, c]))
  const keyForVehicle = (vehicleId: string) => {
    const customerId = vehicleById.get(vehicleId)?.customer_id
    return customerId ? `c:${customerId}` : `v:${vehicleId}`
  }

  const fromMs = new Date(fromIso).getTime()
  const toMs = new Date(toIso).getTime()
  // The equal-length window right before the period, for "of last period's customers, how many came back".
  const prevFromMs = fromMs - (toMs - fromMs + 1)

  const stats = new Map<string, CustomerStat>()
  const prevPeriodKeys = new Set<string>()
  const jobKeyById = new Map<string, string>()
  const jobInPeriod = new Set<string>()

  for (const job of jobs) {
    const key = keyForVehicle(job.vehicle_id)
    jobKeyById.set(job.id, key)
    const vehicle = vehicleById.get(job.vehicle_id)
    let stat = stats.get(key)
    if (!stat) {
      const customer = key.startsWith('c:') ? customerById.get(key.slice(2)) : undefined
      stat = {
        key,
        name: customer?.full_name ?? vehicle?.plate_number ?? 'Unknown',
        isWalkIn: !customer,
        plates: [],
        mobile: customer?.mobile ?? null,
        visits: 0,
        spend: 0,
        lastVisit: job.created_at,
        lifetimeVisits: 0,
        lifetimeSpend: 0,
        firstVisit: job.created_at,
      }
      stats.set(key, stat)
    }
    if (vehicle && !stat.plates.includes(vehicle.plate_number)) stat.plates.push(vehicle.plate_number)
    stat.lifetimeVisits += 1
    if (job.created_at < stat.firstVisit) stat.firstVisit = job.created_at
    if (job.created_at > stat.lastVisit) stat.lastVisit = job.created_at

    const t = new Date(job.created_at).getTime()
    if (t >= fromMs && t <= toMs) {
      stat.visits += 1
      jobInPeriod.add(job.id)
    } else if (t >= prevFromMs && t < fromMs) {
      prevPeriodKeys.add(key)
    }
  }

  // Sales are attributed through their job, so spend lands in the same period as the visit even
  // when payment was collected later. A retail-only sale with no job counts toward lifetime spend
  // only if it was tied to a registered customer; an anonymous retail sale can't be attributed.
  for (const sale of sales) {
    const key = sale.job_id ? jobKeyById.get(sale.job_id) : sale.customer_id ? `c:${sale.customer_id}` : undefined
    const stat = key ? stats.get(key) : undefined
    if (!stat) continue
    stat.lifetimeSpend += sale.total
    if (sale.job_id && jobInPeriod.has(sale.job_id)) stat.spend += sale.total
  }

  const all = [...stats.values()]
  const active = all.filter((s) => s.visits > 0)
  const isNew = (s: CustomerStat) => new Date(s.firstVisit).getTime() >= fromMs
  const newCount = active.filter(isNew).length
  const repeatCount = active.filter((s) => s.visits >= 2).length
  const retainedCount = active.filter((s) => prevPeriodKeys.has(s.key)).length
  const periodVisits = active.reduce((sum, s) => sum + s.visits, 0)
  const periodSpend = active.reduce((sum, s) => sum + s.spend, 0)

  // Average gap between consecutive visits, over customers with 2+ lifetime visits -- how often a
  // regular actually comes back, independent of the selected period.
  const regulars = all.filter((s) => s.lifetimeVisits >= 2)
  const avgDaysBetweenVisits = regulars.length
    ? regulars.reduce(
        (sum, s) =>
          sum + (new Date(s.lastVisit).getTime() - new Date(s.firstVisit).getTime()) / DAY_MS / (s.lifetimeVisits - 1),
        0,
      ) / regulars.length
    : null

  const nowMs = Date.now()
  const lapsed = regulars
    .filter((s) => nowMs - new Date(s.lastVisit).getTime() >= lapseDays * DAY_MS)
    .sort((a, b) => b.lifetimeSpend - a.lifetimeSpend)
    .slice(0, 25)
    .map((s) => ({ ...s, daysSinceLastVisit: Math.floor((nowMs - new Date(s.lastVisit).getTime()) / DAY_MS) }))

  const frequency = [
    { label: '1 visit', count: active.filter((s) => s.visits === 1).length },
    { label: '2 visits', count: active.filter((s) => s.visits === 2).length },
    { label: '3–4 visits', count: active.filter((s) => s.visits >= 3 && s.visits <= 4).length },
    { label: '5+ visits', count: active.filter((s) => s.visits >= 5).length },
  ]

  return {
    activeCount: active.length,
    newCount,
    returningCount: active.length - newCount,
    repeatRate: active.length ? repeatCount / active.length : null,
    prevPeriodCount: prevPeriodKeys.size,
    retainedCount,
    retentionRate: prevPeriodKeys.size ? retainedCount / prevPeriodKeys.size : null,
    periodVisits,
    avgSpendPerCustomer: active.length ? periodSpend / active.length : 0,
    avgDaysBetweenVisits,
    frequency,
    topCustomers: [...active].sort((a, b) => b.spend - a.spend || b.visits - a.visits).slice(0, 20),
    lapsed,
  }
}
