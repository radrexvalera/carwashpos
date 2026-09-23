import { db } from '@/lib/db/dexie'
import { supabase } from '@/lib/supabase/client'
import type { BoardJob } from '@/lib/offline/types'

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

  await db.transaction('rw', db.boardJobs, db.jobs, async () => {
    await db.boardJobs.where('tenantId').equals(tenantId).delete()
    await db.boardJobs.bulkPut(rows)

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
