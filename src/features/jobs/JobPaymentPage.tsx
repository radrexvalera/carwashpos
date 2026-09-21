import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { formatMoney } from '@/lib/money'
import { getActiveShift } from '@/features/shifts/api/shiftsApi'
import { createSaleForJob, getJobForPayment } from './api/jobPaymentApi'

type JobService = { id: string; unit_price: number; quantity: number; line_total: number; serviceName: string }
type PaymentMethod = 'cash' | 'gcash' | 'maya' | 'bank_transfer' | 'card'

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  gcash: 'GCash',
  maya: 'Maya',
  bank_transfer: 'Bank Transfer',
  card: 'Card',
}

export function JobPaymentPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [jobNumber, setJobNumber] = useState('')
  const [plate, setPlate] = useState('')
  const [jobServices, setJobServices] = useState<JobService[]>([])
  const [discounts, setDiscounts] = useState<Record<string, string>>({})
  const [payments, setPayments] = useState<{ method: PaymentMethod; amount: number; referenceNote?: string }[]>([])
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [amount, setAmount] = useState('')
  const [referenceNote, setReferenceNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ saleNumber: string; total: number } | null>(null)

  useEffect(() => {
    if (!jobId) return
    Promise.all([getJobForPayment(jobId), getActiveShift()])
      .then(([jobData, shift]) => {
        setJobNumber(jobData.job.job_number)
        setPlate(jobData.vehicle.plate_number)
        setJobServices(jobData.jobServices)
        setShiftId(shift?.id ?? null)
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load job'))
      .finally(() => setLoading(false))
  }, [jobId])

  const total = jobServices.reduce((sum, js) => {
    const discount = Number(discounts[js.id] || 0)
    return sum + Math.max(0, js.line_total - discount)
  }, 0)
  const roundedTotal = Math.round(total * 100) / 100
  const paidSoFar = payments.reduce((sum, p) => sum + p.amount, 0)
  const remaining = Math.round((roundedTotal - paidSoFar) * 100) / 100

  function addPayment() {
    const value = Number(amount || remaining)
    if (Number.isNaN(value) || value <= 0) return
    setPayments((prev) => [...prev, { method, amount: value, referenceNote: referenceNote.trim() || undefined }])
    setAmount('')
    setReferenceNote('')
  }

  async function handleSubmit() {
    if (!jobId || !shiftId) return
    setSubmitting(true)
    try {
      const sale = await createSaleForJob({
        shiftId,
        jobId,
        lineItems: jobServices.map((js) => ({ jobServiceId: js.id, discountAmount: Number(discounts[js.id] || 0) })),
        payments,
      })
      setResult({ saleNumber: sale.sale_number, total: sale.total })
      toast.success('Payment recorded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record payment')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading…</p>

  if (!shiftId) {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="mb-4 text-muted-foreground">You need an open shift before collecting payment.</p>
            <Button onClick={() => navigate('/shift')}>Open a shift</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (result) {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
            <div className="text-lg font-semibold">Payment recorded</div>
            <div className="text-muted-foreground">{result.saleNumber}</div>
            <div className="text-2xl font-semibold">{formatMoney(result.total)}</div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => window.print()}>
                Print receipt
              </Button>
              <Button onClick={() => navigate('/jobs')}>Back to queue</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Collect Payment</h1>
        <p className="text-muted-foreground">
          {jobNumber} · {plate}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Services</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {jobServices.map((js) => (
            <div key={js.id} className="flex items-center justify-between gap-2">
              <span>{js.serviceName}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{formatMoney(js.line_total)}</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-24"
                  placeholder="Discount"
                  value={discounts[js.id] ?? ''}
                  onChange={(e) => setDiscounts((prev) => ({ ...prev, [js.id]: e.target.value }))}
                />
              </div>
            </div>
          ))}
          <Separator />
          <div className="flex justify-between text-lg font-semibold">
            <span>Total</span>
            <span>{formatMoney(roundedTotal)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {payments.length > 0 && (
            <div className="flex flex-col gap-1">
              {payments.map((p, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border p-2 text-sm">
                  <span>
                    {METHOD_LABELS[p.method]}
                    {p.referenceNote ? ` · ${p.referenceNote}` : ''}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{formatMoney(p.amount)}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => setPayments((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Remaining</span>
            <span>{formatMoney(Math.max(remaining, 0))}</span>
          </div>

          <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(METHOD_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder={remaining > 0 ? remaining.toFixed(2) : '0.00'}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {method !== 'cash' && (
            <Input
              placeholder="Reference number (optional)"
              value={referenceNote}
              onChange={(e) => setReferenceNote(e.target.value)}
            />
          )}
          <Button variant="secondary" onClick={addPayment} disabled={remaining <= 0}>
            Add payment
          </Button>

          <Button
            size="lg"
            disabled={submitting || payments.length === 0 || Math.abs(remaining) > 0.01}
            onClick={handleSubmit}
          >
            Complete payment
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
