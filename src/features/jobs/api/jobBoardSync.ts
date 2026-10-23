import { db } from '@/lib/db/dexie'
import { supabase } from '@/lib/supabase/client'
import type { BoardJob, CachedJobServiceLine } from '@/lib/offline/types'

// Pulls the full open-job board from job_board_entries and replaces the local cache. Full refetch
// (not per-row patching) is simple and cheap at v1 scale, same choice made for the ticket board.
export async function refreshJobBoardCache(tenantId: string) {
  const { data, error } = await supabase
    .from('job_board_entries')
    .select('*')
    .in('status', ['waiting', 'ongoing', 'ready_for_release'])

  if (error) {
    console.error('Job board refresh failed', error)
    return
  }

  // Also caches each open job's job_services (real ids/prices) -- not exposed by the board's own
  // denormalized summary string, but exactly what Collect Payment needs to build a sale offline.
  // Manual join (not an embedded select) for the same reason as everywhere else in this codebase:
  // types.ts's hand-written Relationships are empty, so Supabase's embedded-select syntax doesn't
  // type-check here even where it might work at runtime.
  const jobIds = (data ?? []).map((row) => row.id)
  const { data: jobServices, error: jobServicesError } = jobIds.length
    ? await supabase.from('job_services').select('*').in('job_id', jobIds).neq('status', 'cancelled')
    : { data: [], error: null }
  if (jobServicesError) console.error('Job services cache refresh failed', jobServicesError)

  const serviceIds = [...new Set((jobServices ?? []).map((js) => js.service_id))]
  const { data: services } = serviceIds.length
    ? await supabase.from('services').select('id, name').in('id', serviceIds)
    : { data: [] }
  const serviceNameById = new Map((services ?? []).map((s) => [s.id, s.name]))

  const jobServiceLines: CachedJobServiceLine[] = (jobServices ?? []).map((js) => ({
    id: js.id,
    tenantId,
    jobId: js.job_id,
    serviceId: js.service_id,
    serviceName: serviceNameById.get(js.service_id) ?? 'Service',
    unitPrice: js.unit_price,
    quantity: js.quantity,
    lineTotal: js.line_total,
    status: js.status,
  }))

  const rows: BoardJob[] = (data ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    clientGeneratedId: row.client_generated_id,
    jobNumber: row.job_number,
    status: row.status,
    bayId: row.bay_id,
    bayName: row.bay_name,
    bayEnteredAt: row.bay_entered_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    plateNumber: row.plate_number,
    vehicleMake: row.vehicle_make,
    vehicleModel: row.vehicle_model,
    vehicleSizeName: row.vehicle_size_name,
    estimatedTotal: row.estimated_total,
    servicesSummary: row.services_summary,
    attendantsSummary: row.attendants_summary,
    isPaid: row.is_paid,
  }))

  await db.transaction('rw', db.boardJobs, db.jobs, db.jobServiceLines, db.mutationQueue, async () => {
    await db.boardJobs.where('tenantId').equals(tenantId).delete()
    await db.boardJobs.bulkPut(rows)

    await db.jobServiceLines.where('tenantId').equals(tenantId).delete()
    await db.jobServiceLines.bulkPut(jobServiceLines)

    // A queued-but-not-yet-synced payment optimistically marked its job "paid" the moment it was
    // submitted (queuePaymentOffline) -- but the wholesale replace two lines up just overwrote that
    // with the server's own (still-unpaid, since the sale hasn't landed yet) view. Re-apply the
    // override here so the "Collect payment" button doesn't flicker back on before the next sync
    // attempt. Once the payment actually lands server-side, job_board_entries.is_paid is true for
    // real and this becomes a no-op; if the payment ultimately fails for good, it drops out of
    // pending/syncing and this stops re-applying, correctly letting the button come back.
    const pendingPayments = await db.mutationQueue
      .where('tenantId')
      .equals(tenantId)
      .and((m) => m.entity === 'job_payment' && (m.status === 'pending' || m.status === 'syncing'))
      .toArray()
    for (const m of pendingPayments) {
      const payload = m.payload as { job_id: string }
      await db.boardJobs.where('id').equals(payload.job_id).modify({ isPaid: true })
    }

    // A synced local outbox record is deliberately kept around after its mutation succeeds so the
    // pending card doesn't flicker away before the real board card appears a moment later -- but
    // once that real card DOES show up here, the local stand-in has done its job and must be
    // removed. Without this, a job that later leaves the open board (e.g. it gets completed) makes
    // its stale local record look like it's "still catching up" forever, since the fallback
    // pending-card check can't distinguish "not synced yet" from "synced, and now finished" --
    // this is exactly that bug, and it's the deletion that was always missing.
    const clientGeneratedIds = new Set(rows.map((r) => r.clientGeneratedId))
    const fiveMinutesAgo = Date.now() - 5 * 60_000
    const staleLocalJobs = await db.jobs
      .where('tenantId')
      .equals(tenantId)
      .and(
        (j) =>
          j.syncStatus === 'synced' &&
          // Matches the just-synced job whose real card appeared this refresh (the common case),
          // or -- as a backstop for jobs that already left the open board before this cleanup
          // existed, or on a device that wasn't running to catch that moment -- anything synced
          // more than 5 minutes ago that still isn't in the current open board. A genuinely recent
          // sync gets that 5-minute grace window so it's never mistaken for a stale ghost.
          (clientGeneratedIds.has(j.clientGeneratedId) || new Date(j.createdAt).getTime() < fiveMinutesAgo),
      )
      .toArray()
    await db.jobs.bulkDelete(staleLocalJobs.map((j) => j.clientGeneratedId))
  })
}
