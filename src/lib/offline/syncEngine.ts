import { db } from '@/lib/db/dexie'
import { supabase } from '@/lib/supabase/client'
import type { Database, Json } from '@/lib/supabase/types'

type TicketStatus = Database['public']['Tables']['tickets']['Row']['status']
type JobStatus = Database['public']['Tables']['jobs']['Row']['status']

const MAX_RETRIES = 5
let flushing = false

// Jitter so multiple devices retrying the same transient outage don't all hit the server in the
// same instant.
function backoffMs(retryCount: number) {
  const base = Math.min(3_000 * 2 ** retryCount, 60_000)
  return base + Math.random() * 0.3 * base
}

// Processes pending mutation_queue entries in local sequence order. Each entry is one
// semantically-atomic action (e.g. "complete this ticket") that maps to a single Postgres RPC
// call -- never row-level CRUD sync. A failure on one entry doesn't block the rest of the queue
// (different tickets are independent), but entries of the SAME logical unit stay in order because
// they're only ever enqueued as one entry (see plan doc "Design principle" under Dexie sync).
//
// Deliberately does NOT gate on navigator.onLine -- that flag only reflects whether the device has
// SOME active network interface, not whether it can actually reach Supabase (it can be wrong in
// both directions: true on a WiFi network with no real internet, or false on some VPNs/platforms
// despite a working connection). Relying on it here meant a wrong reading could block every single
// sync attempt indefinitely, including the 30s periodic fallback below. A real network request
// failing is already handled by the retry/backoff logic right below, so that's the actual source
// of truth for connectivity, not this flag.
export async function flushMutationQueue() {
  if (flushing) return
  flushing = true

  try {
    // A mutation is marked 'syncing' right before its RPC call and only cleared to 'synced' or
    // 'failed'/'pending' afterward -- if the tab closes, reloads, or crashes in between (page
    // unload aborts the in-flight fetch before the catch block can run), the entry is orphaned at
    // 'syncing' forever: the query below only ever picks up 'pending', so it would never be
    // retried again regardless of connectivity, showing "Syncing..." indefinitely with no way to
    // recover. The `flushing` guard above already means nothing in THIS session can legitimately
    // be mid-flight right now, so anything still 'syncing' at this point is a leftover from an
    // interrupted previous run -- safe to requeue.
    const orphaned = await db.mutationQueue.where('status').equals('syncing').toArray()
    for (const mutation of orphaned) {
      await db.mutationQueue.update(mutation.id, { status: 'pending', nextAttemptAt: undefined })
    }

    const now = Date.now()
    const pending = (await db.mutationQueue.where('status').equals('pending').sortBy('sequence')).filter(
      (m) => !m.nextAttemptAt || new Date(m.nextAttemptAt).getTime() <= now,
    )

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

        if (mutation.entity === 'job_complete') {
          const payload = mutation.payload as { job_id: string }
          const { error } = await supabase.rpc('complete_job', { p_job_id: payload.job_id })
          if (error) throw error
          // Commission entries + job/job_service status all happen server-side inside
          // complete_job(); the resulting change round-trips back through Realtime to update
          // boardJobs, same as job_status_update.
        }

        if (mutation.entity === 'job_payment') {
          const { error } = await supabase.rpc('create_sale', { payload: mutation.payload as Json })
          if (error) throw error
          // boardJobs.isPaid was already set true optimistically when this was queued (and kept
          // true across refreshes by refreshJobBoardCache's own reconciliation); the real
          // job_board_entries row round-trips back through the board's poll/Realtime like
          // everything else, so nothing else to patch here.
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
          nextAttemptAt: failed ? undefined : new Date(Date.now() + backoffMs(retryCount)).toISOString(),
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

// The one place that knows how to "un-fail" a queue entry -- resets it to pending and clears the
// backoff/error state, then patches the associated local record's own syncStatus back to pending
// too (mirrors what the per-job retry in jobMutations.ts already did, generalized to any entity).
export async function retryMutation(mutationId: string) {
  const mutation = await db.mutationQueue.get(mutationId)
  if (!mutation) return

  await db.mutationQueue.update(mutationId, {
    status: 'pending',
    retryCount: 0,
    lastError: undefined,
    nextAttemptAt: undefined,
  })

  if (mutation.entity === 'job_create') {
    await db.jobs.update(mutation.clientGeneratedId, { syncStatus: 'pending', syncError: undefined })
  }
  if (mutation.entity === 'ticket_complete') {
    await db.tickets.update(mutation.clientGeneratedId, { syncStatus: 'pending', syncError: undefined })
  }

  void flushMutationQueue()
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
