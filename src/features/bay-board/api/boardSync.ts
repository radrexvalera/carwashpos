import { db } from '@/lib/db/dexie'
import { supabase } from '@/lib/supabase/client'
import type { BoardTicket } from '@/lib/offline/types'

// Pulls the full open-ticket board from the ticket_board_entries view and replaces the local
// cache. A full refetch (rather than patching individual rows) is simple and cheap at v1 scale --
// a car wash has a handful of bays and a modest number of concurrently open tickets.
export async function refreshBoardCache(tenantId: string) {
  // The view itself only excludes voided tickets (it may be reused elsewhere later); the board
  // specifically only wants tickets still in flight, not the ever-growing history of paid ones.
  const { data, error } = await supabase
    .from('ticket_board_entries')
    .select('*')
    .in('status', ['waiting', 'in_bay', 'ready_for_pickup'])
  if (error) {
    console.error('Board refresh failed', error)
    return
  }

  const rows: BoardTicket[] = (data ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    clientGeneratedId: row.client_generated_id,
    ticketNumber: row.ticket_number,
    status: row.status,
    bayId: row.bay_id,
    bayName: row.bay_name,
    bayEnteredAt: row.bay_entered_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    total: row.total,
    summary: row.summary,
  }))

  await db.transaction('rw', db.boardTickets, async () => {
    await db.boardTickets.where('tenantId').equals(tenantId).delete()
    await db.boardTickets.bulkPut(rows)
  })
}
