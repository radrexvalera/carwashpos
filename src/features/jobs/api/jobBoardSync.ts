import { db } from '@/lib/db/dexie'
import { supabase } from '@/lib/supabase/client'
import type { BoardJob } from '@/lib/offline/types'

// Pulls the full open-job board from job_board_entries and replaces the local cache. Full refetch
// (not per-row patching) is simple and cheap at v1 scale, same choice made for the ticket board.
export async function refreshJobBoardCache(tenantId: string) {
  const { data, error } = await supabase
    .from('job_board_entries')
    .select('*')
    .in('status', ['waiting', 'washing', 'detailing', 'quality_check', 'ready_for_release'])

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

  await db.transaction('rw', db.boardJobs, async () => {
    await db.boardJobs.where('tenantId').equals(tenantId).delete()
    await db.boardJobs.bulkPut(rows)
  })
}
