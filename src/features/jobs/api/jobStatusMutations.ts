import { db } from '@/lib/db/dexie'
import { flushMutationQueue } from '@/lib/offline/syncEngine'

interface UpdateJobStatusInput {
  tenantId: string
  boardJobId: string
  clientGeneratedId: string
  status: 'waiting' | 'washing' | 'detailing' | 'quality_check' | 'ready_for_release' | 'completed'
  bayId: string | null
  bayEnteredAt: string | null
  completedAt: string | null
}

// Same offline-outbox pattern as the old bay board's ticket status updates -- a job's shop-floor
// status shouldn't depend on connectivity. Referenced by client_generated_id so it works even for
// a job that hasn't finished its own initial sync.
export async function updateJobStatus(input: UpdateJobStatusInput) {
  await db.boardJobs.update(input.boardJobId, {
    status: input.status,
    bayId: input.bayId,
    bayEnteredAt: input.bayEnteredAt,
    completedAt: input.completedAt,
  })

  await db.mutationQueue.add({
    id: crypto.randomUUID(),
    tenantId: input.tenantId,
    entity: 'job_status_update',
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
