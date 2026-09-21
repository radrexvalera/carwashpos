import { db } from '@/lib/db/dexie'
import { flushMutationQueue } from '@/lib/offline/syncEngine'

interface UpdateTicketStatusInput {
  tenantId: string
  boardTicketId: string
  clientGeneratedId: string
  status: 'waiting' | 'in_bay' | 'ready_for_pickup' | 'picked_up_paid'
  bayId: string | null
  bayEnteredAt: string | null
  completedAt: string | null
}

// Status transitions go through the same offline outbox as ticket creation -- a bay doesn't stop
// working because Wi-Fi drops. Referenced by client_generated_id (not the server id) so this works
// even for a ticket that hasn't finished its own initial sync yet.
export async function updateTicketStatus(input: UpdateTicketStatusInput) {
  await db.boardTickets.update(input.boardTicketId, {
    status: input.status,
    bayId: input.bayId,
    bayEnteredAt: input.bayEnteredAt,
    completedAt: input.completedAt,
  })

  await db.mutationQueue.add({
    id: crypto.randomUUID(),
    tenantId: input.tenantId,
    entity: 'ticket_status_update',
    clientGeneratedId: input.clientGeneratedId,
    payload: {
      client_generated_id: input.clientGeneratedId,
      status: input.status,
      bay_id: input.bayId,
      bay_entered_at: input.bayEnteredAt,
      completed_at: input.completedAt,
    },
    createdAt: new Date().toISOString(),
    retryCount: 0,
    status: 'pending',
    sequence: Date.now(),
  })

  void flushMutationQueue()
}
