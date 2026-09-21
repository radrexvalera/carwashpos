import { db } from '@/lib/db/dexie'
import { flushMutationQueue } from '@/lib/offline/syncEngine'
import type { LocalTicket, LocalTicketLineItem, LocalTicketPayment } from '@/lib/offline/types'

interface CompleteTicketInput {
  tenantId: string
  lineItems: LocalTicketLineItem[]
  payments: LocalTicketPayment[]
}

// The POS never talks to Supabase directly to ring up a sale -- it always writes an optimistic
// local ticket + enqueues one outbox mutation, then kicks a flush attempt (a no-op if offline).
// This keeps one code path regardless of connectivity, matching the plan's "coarse-grained,
// semantically atomic mutations" design.
export async function completeTicketOffline(input: CompleteTicketInput) {
  const clientGeneratedId = crypto.randomUUID()
  const subtotal = input.lineItems.reduce((sum, line) => sum + line.lineTotal, 0)
  const total = subtotal

  const localTicket: LocalTicket = {
    clientGeneratedId,
    tenantId: input.tenantId,
    status: 'waiting',
    lineItems: input.lineItems,
    payments: input.payments,
    subtotal,
    total,
    createdAt: new Date().toISOString(),
    syncStatus: 'pending',
  }

  await db.tickets.add(localTicket)

  await db.mutationQueue.add({
    id: crypto.randomUUID(),
    tenantId: input.tenantId,
    entity: 'ticket_complete',
    clientGeneratedId,
    payload: {
      client_generated_id: clientGeneratedId,
      line_items: input.lineItems.map((line) =>
        line.lineType === 'service'
          ? {
              line_type: 'service',
              service_id: line.serviceId,
              vehicle_size_class_id: line.vehicleSizeClassId,
              quantity: line.quantity,
            }
          : {
              line_type: 'product',
              product_id: line.productId,
              quantity: line.quantity,
            },
      ),
      payments: input.payments.map((p) => ({
        method: p.method,
        amount: p.amount,
        reference_note: p.referenceNote,
      })),
    },
    createdAt: new Date().toISOString(),
    retryCount: 0,
    status: 'pending',
    sequence: Date.now(),
  })

  void flushMutationQueue()

  return clientGeneratedId
}
