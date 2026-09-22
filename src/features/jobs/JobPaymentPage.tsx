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
import { useTenant } from '@/app/TenantProvider'
import { getActiveShift } from '@/features/shifts/api/shiftsApi'
import { listActivePromotionsWithServices } from '@/features/promotions/api/promotionsApi'
import { getSettings } from '@/features/settings/api/settingsApi'
import { createSaleForJob, getJobForPayment } from './api/jobPaymentApi'
import type { InventoryStockLevel } from '@/features/inventory/api/inventoryApi'

type JobService = { id: string; service_id: string; unit_price: number; quantity: number; line_total: number; serviceName: string }
type PaymentMethod = 'cash' | 'gcash' | 'maya' | 'bank_transfer' | 'card'
type ProductLine = { itemId: string; name: string; unitPrice: number; quantity: number }
type ActivePromotion = Awaited<ReturnType<typeof listActivePromotionsWithServices>>[number]

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
  const { profile } = useTenant()

  const [loading, setLoading] = useState(true)
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [jobNumber, setJobNumber] = useState('')
  const [plate, setPlate] = useState('')
  const [jobServices, setJobServices] = useState<JobService[]>([])
  const [discounts, setDiscounts] = useState<Record<string, string>>({})
  const [retailItems, setRetailItems] = useState<InventoryStockLevel[]>([])
  const [productLines, setProductLines] = useState<ProductLine[]>([])
  const [pickedItemId, setPickedItemId] = useState('')
  const [payments, setPayments] = useState<{ method: PaymentMethod; amount: number; referenceNote?: string }[]>([])
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [amount, setAmount] = useState('')
  const [referenceNote, setReferenceNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{
    saleNumber: string
    total: number
    promotionDiscount: number
    loyaltyDiscount: number
    pointsEarned: number
  } | null>(null)
  const [customer, setCustomer] = useState<{ id: string; full_name: string } | null>(null)
  const [loyaltyBalance, setLoyaltyBalance] = useState(0)
  const [promotions, setPromotions] = useState<ActivePromotion[]>([])
  const [promotionId, setPromotionId] = useState<string>('none')
  const [redeemPoints, setRedeemPoints] = useState('')
  const [redemptionValue, setRedemptionValue] = useState(0.5)

  useEffect(() => {
    if (!jobId || !profile) return
    Promise.all([getJobForPayment(jobId), getActiveShift(), listActivePromotionsWithServices(), getSettings(profile.tenantId)])
      .then(([jobData, shift, promos, settings]) => {
        setJobNumber(jobData.job.job_number)
        setPlate(jobData.vehicle.plate_number)
        setJobServices(jobData.jobServices)
        setRetailItems(jobData.retailItems)
        setShiftId(shift?.id ?? null)
        setCustomer(jobData.customer)
        setLoyaltyBalance(jobData.loyaltyBalance)
        setPromotions(promos)
        setRedemptionValue(settings.loyalty_redemption_value)
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load job'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, profile?.tenantId])

  const servicesTotal = jobServices.reduce((sum, js) => {
    const discount = Number(discounts[js.id] || 0)
    return sum + Math.max(0, js.line_total - discount)
  }, 0)
  const productsTotal = productLines.reduce((sum, p) => sum + p.unitPrice * p.quantity, 0)
  const preDiscountTotal = Math.round((servicesTotal + productsTotal) * 100) / 100

  // Client-side preview only -- create_sale() is what actually computes and enforces this.
  const selectedPromotion = promotions.find((p) => p.id === promotionId)
  let promotionEligibleBase = preDiscountTotal
  if (selectedPromotion && selectedPromotion.restrictedServiceIds.length > 0) {
    promotionEligibleBase = jobServices
      .filter((js) => selectedPromotion.restrictedServiceIds.includes(js.service_id))
      .reduce((sum, js) => sum + Math.max(0, js.line_total - Number(discounts[js.id] || 0)), 0)
  }
  const promotionMet = !selectedPromotion || selectedPromotion.min_spend == null || promotionEligibleBase >= selectedPromotion.min_spend
  const promotionDiscountPreview =
    selectedPromotion && promotionMet
      ? selectedPromotion.discount_type === 'percentage'
        ? Math.round(((promotionEligibleBase * selectedPromotion.discount_value) / 100) * 100) / 100
        : Math.min(selectedPromotion.discount_value, promotionEligibleBase)
      : 0

  const afterPromotionTotal = Math.round((preDiscountTotal - promotionDiscountPreview) * 100) / 100
  const requestedPoints = Math.max(0, Math.floor(Number(redeemPoints) || 0))
  const maxRedeemablePoints =
    redemptionValue > 0 ? Math.min(loyaltyBalance, Math.floor(afterPromotionTotal / redemptionValue)) : 0
  const pointsToRedeem = Math.min(requestedPoints, maxRedeemablePoints)
  const loyaltyDiscountPreview = Math.round(pointsToRedeem * redemptionValue * 100) / 100

  const roundedTotal = Math.max(0, Math.round((afterPromotionTotal - loyaltyDiscountPreview) * 100) / 100)
  const paidSoFar = payments.reduce((sum, p) => sum + p.amount, 0)
  const remaining = Math.round((roundedTotal - paidSoFar) * 100) / 100

  function addProductLine() {
    const item = retailItems.find((i) => i.id === pickedItemId)
    if (!item || item.retail_price == null) return
    setProductLines((prev) => {
      const existing = prev.find((p) => p.itemId === item.id)
      if (existing) return prev.map((p) => (p.itemId === item.id ? { ...p, quantity: p.quantity + 1 } : p))
      return [...prev, { itemId: item.id, name: item.name, unitPrice: item.retail_price!, quantity: 1 }]
    })
  }

  function removeProductLine(itemId: string) {
    setProductLines((prev) => prev.filter((p) => p.itemId !== itemId))
  }

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
        productLines: productLines.map((p) => ({ itemId: p.itemId, quantity: p.quantity })),
        payments,
        promotionId: promotionId !== 'none' ? promotionId : null,
        loyaltyPointsRedeemed: pointsToRedeem,
      })
      setResult({
        saleNumber: sale.sale_number,
        total: sale.total,
        promotionDiscount: sale.promotion_discount_amount,
        loyaltyDiscount: sale.loyalty_discount_amount,
        pointsEarned: sale.loyalty_points_earned,
      })
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
            {result.promotionDiscount > 0 && (
              <div className="text-sm text-muted-foreground">Promotion discount: {formatMoney(result.promotionDiscount)}</div>
            )}
            {result.loyaltyDiscount > 0 && (
              <div className="text-sm text-muted-foreground">Points redeemed: {formatMoney(result.loyaltyDiscount)}</div>
            )}
            {result.pointsEarned > 0 && (
              <div className="text-sm text-muted-foreground">Points earned: +{result.pointsEarned}</div>
            )}
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
          {customer && ` · ${customer.full_name}`}
        </p>
      </div>

      {customer && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Loyalty points balance</span>
              <span className="font-medium">{loyaltyBalance}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">Promotion</span>
              <Select value={promotionId} onValueChange={setPromotionId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No promotion</SelectItem>
                  {promotions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPromotion && !promotionMet && (
                <span className="text-xs text-destructive">
                  Needs at least {formatMoney(selectedPromotion.min_spend ?? 0)} on eligible items.
                </span>
              )}
            </div>
            {loyaltyBalance > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-muted-foreground">Redeem points (max {maxRedeemablePoints})</span>
                <Input
                  type="number"
                  min="0"
                  max={maxRedeemablePoints}
                  placeholder="0"
                  value={redeemPoints}
                  onChange={(e) => setRedeemPoints(e.target.value)}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
        </CardContent>
      </Card>

      {retailItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Add a product</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-end gap-2">
              <Select value={pickedItemId} onValueChange={setPickedItemId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select product" />
                </SelectTrigger>
                <SelectContent>
                  {retailItems.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name} — {formatMoney(i.retail_price ?? 0)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="secondary" onClick={addProductLine} disabled={!pickedItemId}>
                Add
              </Button>
            </div>
            {productLines.map((p) => (
              <div key={p.itemId} className="flex items-center justify-between text-sm">
                <span>
                  {p.name} × {p.quantity}
                </span>
                <div className="flex items-center gap-2">
                  <span>{formatMoney(p.unitPrice * p.quantity)}</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeProductLine(p.itemId)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-1 pt-6">
          {promotionDiscountPreview > 0 && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Promotion discount</span>
              <span>−{formatMoney(promotionDiscountPreview)}</span>
            </div>
          )}
          {loyaltyDiscountPreview > 0 && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Points redeemed ({pointsToRedeem})</span>
              <span>−{formatMoney(loyaltyDiscountPreview)}</span>
            </div>
          )}
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

          <Separator />

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
