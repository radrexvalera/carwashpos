import { db } from '@/lib/db/dexie'
import { supabase } from '@/lib/supabase/client'
import type { Database, Json } from '@/lib/supabase/types'

type TicketStatus = Database['public']['Tables']['tickets']['Row']['status']
type JobStatus = Database['public']['Tables']['jobs']['Row']['status']

const MAX_RETRIES = 5
let flushing = false

// Processes pending mutation_queue entries in local sequence order. Each entry is one
// semantically-atomic action (e.g. "complete this ticket") that maps to a single Postgres RPC
// call -- never row-level CRUD sync. A failure on one entry doesn't block the rest of the queue
// (different tickets are independent), but entries of the SAME logical unit stay in order because
// they're only ever enqueued as one entry (see plan doc "Design principle" under Dexie sync).
export async function flushMutationQueue() {
  if (flushing || !navigator.onLine) return
  flushing = true

  try {
    const pending = await db.mutationQueue.where('status').equals('pending').sortBy('sequence')

    for (const mutation of pending) {
      try {
        await db.mutationQueue.update(mutation.id, {
          status: 'syncing',
          attemptedAt: new Date().toISOString(),
        })

        if (mutation.entity === 'ticket_complete') {
          const { data, error } = await supabase.rpc('complete_ticket', { payload: mutation.payload as Json })
          if (error) throw error

          const result = data as {
            id: string
            ticket_number: number
            status: string
            subtotal: number
            total: number
          }

          await db.tickets.update(mutation.clientGeneratedId, {
            id: result.id,
            ticketNumber: result.ticket_number,
            status: result.status,
            subtotal: result.subtotal,
            total: result.total,
            syncStatus: 'synced',
            syncError: undefined,
          })
        }

        if (mutation.entity === 'ticket_status_update') {
          const payload = mutation.payload as {
            client_generated_id: string
            status: TicketStatus
            bay_id: string | null
            bay_entered_at: string | null
            completed_at: string | null
          }
          const { error } = await supabase
            .from('tickets')
            .update({
              status: payload.status,
              bay_id: payload.bay_id,
              bay_entered_at: payload.bay_entered_at,
              completed_at: payload.completed_at,
            })
            .eq('client_generated_id', payload.client_generated_id)
          if (error) throw error
          // The resulting Postgres change round-trips back through Realtime (or the board's
          // periodic refresh) to update boardTickets -- no local patch needed here.
        }

        if (mutation.entity === 'job_create') {
          const { data, error } = await supabase.rpc('create_job', { payload: mutation.payload as Json })
          if (error) throw error

          const result = data as { id: string; job_number: string; status: string; created_at: string }

          await db.jobs.update(mutation.clientGeneratedId, {
            id: result.id,
            jobNumber: result.job_number,
            status: result.status,
            syncStatus: 'synced',
            syncError: undefined,
          })
        }

        if (mutation.entity === 'job_status_update') {
          const payload = mutation.payload as {
            client_generated_id: string
            status: JobStatus
            bay_id: string | null
            bay_entered_at: string | null
            completed_at: string | null
          }
          const { error } = await supabase
            .from('jobs')
            .update({
              status: payload.status,
              bay_id: payload.bay_id,
              bay_entered_at: payload.bay_entered_at,
              completed_at: payload.completed_at,
            })
            .eq('client_generated_id', payload.client_generated_id)
          if (error) throw error
        }

        await db.mutationQueue.update(mutation.id, { status: 'synced' })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const retryCount = mutation.retryCount + 1
        const failed = retryCount >= MAX_RETRIES

        await db.mutationQueue.update(mutation.id, {
          status: failed ? 'failed' : 'pending',
          retryCount,
          lastError: message,
        })

        if (mutation.entity === 'ticket_complete') {
          await db.tickets.update(mutation.clientGeneratedId, {
            syncStatus: failed ? 'failed' : 'pending',
            syncError: message,
          })
        }

        if (mutation.entity === 'job_create') {
          await db.jobs.update(mutation.clientGeneratedId, {
            syncStatus: failed ? 'failed' : 'pending',
            syncError: message,
          })
        }
      }
    }
  } finally {
    flushing = false
  }
}

// Starts the background flush loop: immediately, on every reconnect, and on a periodic interval
// as a fallback in case the 'online' event doesn't fire (some browsers/OSes are unreliable here).
export function startSyncEngine() {
  flushMutationQueue()

  const onOnline = () => flushMutationQueue()
  window.addEventListener('online', onOnline)
  const interval = window.setInterval(flushMutationQueue, 30_000)

  return () => {
    window.removeEventListener('online', onOnline)
    window.clearInterval(interval)
  }
}
