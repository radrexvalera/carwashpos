import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cancelJob } from './api/jobEditApi'
import { refreshJobBoardCache } from './api/jobBoardSync'

interface CancelJobDialogProps {
  job: { id: string; plateNumber: string } | null
  tenantId: string
  onOpenChange: (open: boolean) => void
  // Called after a successful cancel, in addition to the open-board refresh above -- lets a caller
  // also refresh a list this dialog doesn't know about itself (e.g. the Unpaid tab's completed-but-
  // not-yet-paid jobs, which job_board_entries' open-board query never included in the first place).
  onCancelled?: () => void
}

export function CancelJobDialog({ job, tenantId, onOpenChange, onCancelled }: CancelJobDialogProps) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleCancel() {
    if (!job) return
    setSubmitting(true)
    try {
      await cancelJob(job.id, reason.trim())
      await refreshJobBoardCache(tenantId)
      onCancelled?.()
      toast.success('Job cancelled')
      setReason('')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel job')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={!!job}
      onOpenChange={(o) => {
        if (!o) setReason('')
        onOpenChange(o)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel job</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {job?.plateNumber} will be removed from the queue and its bay freed up. This can't be undone -- if it's
            already been paid for, void the transaction instead.
          </p>
          <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="destructive" disabled={!reason.trim() || submitting} onClick={handleCancel}>
            Confirm cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
