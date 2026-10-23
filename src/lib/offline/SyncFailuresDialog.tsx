import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { toast } from 'sonner'
import { db } from '@/lib/db/dexie'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { retryMutation } from './syncEngine'
import type { MutationQueueEntry } from './types'

const ENTITY_LABELS: Record<MutationQueueEntry['entity'], string> = {
  job_create: 'Create job',
  job_status_update: 'Update job status',
  job_complete: 'Complete job',
  job_payment: 'Collect payment',
  ticket_complete: 'Complete ticket (legacy)',
  ticket_status_update: 'Update ticket status (legacy)',
}

interface SyncFailuresDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SyncFailuresDialog({ open, onOpenChange }: SyncFailuresDialogProps) {
  const failedMutations = useLiveQuery(() => db.mutationQueue.where('status').equals('failed').sortBy('sequence'), [], [])
  const jobs = useLiveQuery(() => db.jobs.toArray(), [], [])
  const boardJobs = useLiveQuery(() => db.boardJobs.toArray(), [], [])
  const [retrying, setRetrying] = useState<string | null>(null)

  function plateFor(mutation: MutationQueueEntry) {
    if (mutation.entity === 'job_payment') {
      const jobId = (mutation.payload as { job_id?: string }).job_id
      return (boardJobs ?? []).find((j) => j.id === jobId)?.plateNumber ?? null
    }
    if (mutation.entity !== 'job_create' && mutation.entity !== 'job_status_update' && mutation.entity !== 'job_complete') return null
    return (jobs ?? []).find((j) => j.clientGeneratedId === mutation.clientGeneratedId)?.vehiclePlate ?? null
  }

  async function handleRetry(mutation: MutationQueueEntry) {
    setRetrying(mutation.id)
    try {
      await retryMutation(mutation.id)
      toast.success('Retrying…')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to retry')
    } finally {
      setRetrying(null)
    }
  }

  async function handleRetryAll() {
    for (const mutation of failedMutations ?? []) {
      await retryMutation(mutation.id)
    }
    toast.success('Retrying all…')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sync issues</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {(failedMutations ?? []).length > 1 && (
            <Button size="sm" variant="outline" className="w-fit" onClick={handleRetryAll}>
              Retry all
            </Button>
          )}
          {(failedMutations ?? []).map((mutation) => (
            <div key={mutation.id} className="flex flex-col gap-1.5 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {ENTITY_LABELS[mutation.entity]}
                  {plateFor(mutation) && ` · ${plateFor(mutation)}`}
                </span>
                <Button size="sm" variant="outline" disabled={retrying === mutation.id} onClick={() => handleRetry(mutation)}>
                  Retry
                </Button>
              </div>
              {mutation.lastError && <p className="text-xs text-destructive">{mutation.lastError}</p>}
              <p className="text-xs text-muted-foreground">
                {mutation.attemptedAt ? `Last tried ${new Date(mutation.attemptedAt).toLocaleString()}` : 'Never attempted'}
              </p>
            </div>
          ))}
          {(failedMutations ?? []).length === 0 && (
            <p className="text-center text-sm text-muted-foreground">No sync issues.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
