import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { cancelJob } from './api/jobEditApi'
import { refreshJobBoardCache } from './api/jobBoardSync'
import { listHeldDownpayments } from './api/downpaymentApi'

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
  // Held downpayments on this job; null while loading. cancel_job() refuses to cancel a job that
  // still holds one unless the cashier says whether it's refunded or kept.
  const [heldTotal, setHeldTotal] = useState<number | null>(null)
  const [heldHasCash, setHeldHasCash] = useState(false)
  const [downpaymentAction, setDownpaymentAction] = useState<'refund' | 'keep' | null>(null)

  useEffect(() => {
    setDownpaymentAction(null)
    setHeldTotal(null)
    if (!job) return
    listHeldDownpayments(job.id)
      .then((held) => {
        setHeldTotal(held.reduce((sum, d) => sum + d.amount, 0))
        setHeldHasCash(held.some((d) => d.method === 'cash'))
      })
      // Can't tell (e.g. offline) -- treat as none; the server still enforces the choice.
      .catch(() => setHeldTotal(0))
  }, [job?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasDownpayment = (heldTotal ?? 0) > 0

  async function handleCancel() {
    if (!job) return
    setSubmitting(true)
    try {
      await cancelJob(job.id, reason.trim(), hasDownpayment ? (downpaymentAction ?? undefined) : undefined)
      await refreshJobBoardCache(tenantId)
      onCancelled?.()
      toast.success(
        hasDownpayment && downpaymentAction === 'refund'
          ? `Job cancelled — refund ${formatMoney(heldTotal ?? 0)} to the customer`
          : 'Job cancelled',
      )
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
          {hasDownpayment && (
            <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
              <div>
                This job has a downpayment of <span className="font-semibold">{formatMoney(heldTotal ?? 0)}</span>. What happens
                to it?
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['refund', 'Refund it', heldHasCash ? 'Cash comes out of your drawer' : 'Send it back to the customer'],
                    ['keep', 'Keep it', 'Counted as income'],
                  ] as const
                ).map(([value, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDownpaymentAction(value)}
                    className={cn(
                      'flex flex-col items-start rounded-md border p-2 text-left',
                      downpaymentAction === value ? 'border-primary bg-primary/5' : 'hover:bg-muted',
                    )}
                  >
                    <span className="font-medium">{label}</span>
                    <span className="text-xs text-muted-foreground">{hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button
            variant="destructive"
            disabled={!reason.trim() || submitting || heldTotal === null || (hasDownpayment && !downpaymentAction)}
            onClick={handleCancel}
          >
            Confirm cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
