import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import type { LocalTicketPayment } from '@/lib/offline/types'

interface PaymentPanelProps {
  total: number
  disabled: boolean
  onComplete: (payments: LocalTicketPayment[]) => Promise<void>
}

const METHOD_LABELS: Record<LocalTicketPayment['method'], string> = {
  cash: 'Cash',
  e_wallet: 'E-wallet',
  card: 'Card',
}

export function PaymentPanel({ total, disabled, onComplete }: PaymentPanelProps) {
  const [payments, setPayments] = useState<LocalTicketPayment[]>([])
  const [method, setMethod] = useState<LocalTicketPayment['method']>('cash')
  const [amount, setAmount] = useState('')
  const [referenceNote, setReferenceNote] = useState('')

  const paidSoFar = payments.reduce((sum, p) => sum + p.amount, 0)
  const remaining = Math.round((total - paidSoFar) * 100) / 100
  const canComplete = !disabled && payments.length > 0 && Math.abs(remaining) <= 0.01

  function addPayment() {
    const value = Number(amount || remaining)
    if (Number.isNaN(value) || value <= 0) return
    setPayments((prev) => [...prev, { method, amount: value, referenceNote: referenceNote.trim() || undefined }])
    setAmount('')
    setReferenceNote('')
  }

  function removePayment(index: number) {
    setPayments((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleComplete() {
    await onComplete(payments)
    setPayments([])
  }

  return (
    <Card className="h-fit lg:sticky lg:top-6">
      <CardHeader>
        <CardTitle>Payment</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex justify-between text-lg font-semibold">
          <span>Total</span>
          <span>${total.toFixed(2)}</span>
        </div>

        {payments.length > 0 && (
          <div className="flex flex-col gap-1">
            {payments.map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <span>
                  {METHOD_LABELS[p.method]}
                  {p.referenceNote ? ` · ${p.referenceNote}` : ''}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-medium">${p.amount.toFixed(2)}</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removePayment(i)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Separator />

        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Remaining</span>
          <span className={remaining > 0.01 ? 'font-medium' : 'text-muted-foreground'}>${Math.max(remaining, 0).toFixed(2)}</span>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Add payment</Label>
          <Select value={method} onValueChange={(v) => setMethod(v as LocalTicketPayment['method'])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="e_wallet">E-wallet</SelectItem>
              <SelectItem value="card">Card</SelectItem>
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
          {method === 'e_wallet' && (
            <Input
              placeholder="Reference number (optional)"
              value={referenceNote}
              onChange={(e) => setReferenceNote(e.target.value)}
            />
          )}
          <Button variant="secondary" onClick={addPayment} disabled={disabled || remaining <= 0}>
            Add payment
          </Button>
        </div>

        <Button size="lg" disabled={!canComplete} onClick={handleComplete}>
          Complete sale
        </Button>
      </CardContent>
    </Card>
  )
}
