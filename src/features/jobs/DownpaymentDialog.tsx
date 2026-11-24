import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { formatMoney } from '@/lib/money'
import { useOnlineStatus } from '@/lib/offline/useOnlineStatus'
import {
  PAYMENT_METHOD_LABELS,
  listHeldDownpayments,
  recordDownpayment,
  refundDownpayment,
  type HeldDownpayment,
  type PaymentMethod,
} from './api/downpaymentApi'

interface DownpaymentDialogProps {
  job: { id: string; plateNumber: string; total: number } | null
  tenantId: string
  onOpenChange: (open: boolean) => void
  onChanged?: () => void
}

export function DownpaymentDialog({ job, tenantId, onOpenChange, onChanged }: DownpaymentDialogProps) {
  const online = useOnlineStatus()
  const [held, setHeld] = useState<HeldDownpayment[]>([])
  const [loading, setLoading] = useState(false)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [amount, setAmount] = useState('')
  const [referenceNote, setReferenceNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [refundingId, setRefundingId] = useState<string | null>(null)
  const [refundReason, setRefundReason] = useState('')

  function reload(jobId: string) {
    setLoading(true)
    listHeldDownpayments(jobId)
      .then(setHeld)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load downpayments'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!job || !online) return
    setAmount('')
    setReferenceNote('')
    setMethod('cash')
    setRefundingId(null)
    reload(job.id)
  }, [job?.id, online]) // eslint-disable-line react-hooks/exhaustive-deps

  const heldTotal = held.reduce((sum, d) => sum + d.amount, 0)
  const balance = job ? Math.round((job.total - heldTotal) * 100) / 100 : 0
  const amountNum = Number(amount) || 0
  const amountError = amountNum > balance + 0.005 ? `Can't be more than the balance of ${formatMoney(balance)}` : null

  async function handleAdd() {
    if (!job || amountNum <= 0 || amountError) return
    setSubmitting(true)
    try {
      await recordDownpayment({ tenantId, jobId: job.id, method, amount: amountNum, referenceNote })
      toast.success(`Downpayment of ${formatMoney(amountNum)} recorded`)
      setAmount('')
      setReferenceNote('')
      reload(job.id)
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record downpayment')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRefund(d: HeldDownpayment) {
    if (!job || !refundReason.trim()) return
    setSubmitting(true)
    try {
      await refundDownpayment(d.id, refundReason.trim())
      toast.success(`Refunded ${formatMoney(d.amount)}${d.method === 'cash' ? ' — take it out of the drawer' : ''}`)
      setRefundingId(null)
      setRefundReason('')
      reload(job.id)
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to refund downpayment')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={!!job} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Downpayment · {job?.plateNumber}</DialogTitle>
        </DialogHeader>
        {!online ? (
          <p className="text-sm text-muted-foreground">Needs a connection. Reconnect to take a downpayment.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Job total</span>
                <span>{formatMoney(job?.total ?? 0)}</span>
              </div>
              {loading ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : (
                held.map((d) => (
                  <div key={d.id} className="flex flex-col gap-1.5 rounded-md border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        {PAYMENT_METHOD_LABELS[d.method]}
                        {d.referenceNote ? ` · ${d.referenceNote}` : ''}
                        <span className="text-muted-foreground">
                          {' · '}
                          {new Date(d.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                        </span>
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">−{formatMoney(d.amount)}</span>
                        {refundingId !== d.id && (
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRefundingId(d.id)}>
                            Refund
                          </Button>
                        )}
                      </div>
                    </div>
                    {refundingId === d.id && (
                      <div className="flex gap-2">
                        <Input placeholder="Refund reason (required)" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
                        <Button size="sm" variant="destructive" disabled={!refundReason.trim() || submitting} onClick={() => handleRefund(d)}>
                          Confirm
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRefundingId(null)}>
                          Back
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              )}
              <Separator className="my-1" />
              <div className="flex justify-between font-semibold">
                <span>Balance</span>
                <span>{formatMoney(balance)}</span>
              </div>
            </div>

            {balance > 0.005 && (
              <div className="flex flex-col gap-2">
                <Label>Add a downpayment</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input type="number" step="0.01" min="0" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
                {amountError && <p className="text-xs text-destructive">{amountError}</p>}
                {method !== 'cash' && (
                  <Input placeholder="Reference number (optional)" value={referenceNote} onChange={(e) => setReferenceNote(e.target.value)} />
                )}
                <Button disabled={submitting || amountNum <= 0 || !!amountError} onClick={handleAdd}>
                  Record downpayment
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
