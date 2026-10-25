import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { formatMoney } from '@/lib/money'
import { useTenant } from '@/app/TenantProvider'
import { db } from '@/lib/db/dexie'
import { safeGetItem, safeSetItem } from '@/lib/safeStorage'
import { useOnlineStatus } from '@/lib/offline/useOnlineStatus'
import { getActiveShift } from '@/features/shifts/api/shiftsApi'
import { getSettings, type Settings } from '@/features/settings/api/settingsApi'
import {
  createSaleForJob,
  getJobForPayment,
  getJobForPaymentFromPendingLocal,
  getJobForPaymentOffline,
  queuePaymentOffline,
} from './api/jobPaymentApi'
import { Receipt } from './Receipt'
import type { InventoryStockLevel } from '@/features/inventory/api/inventoryApi'

type JobService = { id: string; service_id: string; unit_price: number; quantity: number; line_total: number; serviceName: string }
type PaymentMethod = 'cash' | 'gcash' | 'maya' | 'bank_transfer' | 'card' | 'maribank' | 'gotyme' | 'rcbc' | 'bpi' | 'unionbank' | 'qrph'
type ProductLine = { itemId: string; name: string; unitPrice: number; quantity: number }

// Distinguishes "the request never reached the server" from "the server rejected it for a real
// reason". A Postgres/PostgREST error (including one raised inside create_sale() itself) always
// carries a populated SQLSTATE in `code`; a request that failed before getting a response (DNS
// failure, no connection, timeout) does not. navigator.onLine is checked too as a cheap first cut,
// but per syncEngine.ts's own comment it's unreliable in both directions, so it's an OR, not relied
// on alone.
function isLikelyNetworkFailure(err: unknown): boolean {
  if (!navigator.onLine) return true
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    return !code
  }
  return false
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  gcash: 'GCash',
  maya: 'Maya',
  bank_transfer: 'Bank Transfer',
  card: 'Card',
  maribank: 'Maribank',
  gotyme: 'GoTyme',
  rcbc: 'RCBC',
  bpi: 'BPI',
  unionbank: 'UnionBank',
  qrph: 'QR Ph',
}

export function JobPaymentPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const { profile } = useTenant()

  const [loading, setLoading] = useState(true)
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [jobNumber, setJobNumber] = useState('')
  const [plate, setPlate] = useState('')
  const [vehicleModel, setVehicleModel] = useState<string | null>(null)
  const [crewNames, setCrewNames] = useState<string[]>([])
  const [jobServices, setJobServices] = useState<JobService[]>([])
  const [discounts, setDiscounts] = useState<Record<string, string>>({})
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage')
  const [discountValue, setDiscountValue] = useState('')
  const [retailItems, setRetailItems] = useState<InventoryStockLevel[]>([])
  const [productLines, setProductLines] = useState<ProductLine[]>([])
  const [pickedItemId, setPickedItemId] = useState('')
  const [payments, setPayments] = useState<
    { method: PaymentMethod; amount: number; referenceNote?: string; tenderedAmount?: number; changeGiven?: number }[]
  >([])
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [amount, setAmount] = useState('')
  const [referenceNote, setReferenceNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{
    saleNumber: string
    total: number
    createdAt: string
    manualDiscountAmount: number
  } | null>(null)
  const [customer, setCustomer] = useState<{ id: string; full_name: string } | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [locationName, setLocationName] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [offlineMode, setOfflineMode] = useState(false)

  const online = useOnlineStatus()
  // The real, currently-open shift id -- not just a boolean -- cached per-user so create_sale()'s
  // required shift_id is still available if the live getActiveShift() call below can't run. Keyed
  // separately from RegisterPage's own hasOpenShift boolean cache since that page never needs the
  // real id, just whether one exists.
  const shiftCacheKey = profile ? `openShiftId:${profile.id}` : null

  useEffect(() => {
    if (!jobId || !profile) return
    setLoadError(null)
    Promise.all([getJobForPayment(jobId), getActiveShift(), getSettings(profile.tenantId)])
      .then(([jobData, shift, settingsData]) => {
        setJobNumber(jobData.job.job_number)
        setPlate(jobData.vehicle.plate_number)
        setVehicleModel(jobData.vehicle.model)
        setCrewNames(jobData.crewNames)
        setJobServices(jobData.jobServices)
        setRetailItems(jobData.retailItems)
        setLocationName(jobData.locationName)
        setShiftId(shift?.id ?? null)
        if (shift?.id && shiftCacheKey) safeSetItem(shiftCacheKey, shift.id)
        setCustomer(jobData.customer)
        setSettings(settingsData)
        setOfflineMode(false)
      })
      .catch(async () => {
        // The live read failed -- most likely offline. Fall back to whatever's cached locally so
        // payment can still be collected; create_sale() is the real source of truth and will
        // reject this at sync time if something's genuinely wrong (e.g. the cached shift was
        // closed in the meantime), surfaced through the normal failed-mutation recovery UI.
        async function applyOfflineJobData(jobData: Awaited<ReturnType<typeof getJobForPaymentOffline>>) {
          setJobNumber(jobData.job.job_number)
          setPlate(jobData.vehicle.plate_number)
          setVehicleModel(jobData.vehicle.model)
          setCrewNames(jobData.crewNames)
          setJobServices(jobData.jobServices)
          setRetailItems([])
          setLocationName(jobData.locationName)
          const cachedShiftId = shiftCacheKey ? safeGetItem(shiftCacheKey) : null
          setShiftId(cachedShiftId)
          setCustomer(jobData.customer)
          const cachedSettings = await db.settings.get(profile!.tenantId)
          setSettings(cachedSettings ?? null)
          setOfflineMode(true)
        }

        try {
          await applyOfflineJobData(await getJobForPaymentOffline(jobId, profile.tenantId))
        } catch {
          // Not a synced job either -- last resort: a job created offline that's never reached
          // the server at all, still sitting in the local outbox.
          try {
            await applyOfflineJobData(await getJobForPaymentFromPendingLocal(jobId, profile.tenantId))
          } catch (err) {
            setLoadError(err instanceof Error ? err.message : 'Failed to load job')
          }
        }
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, profile?.tenantId])

  const servicesTotal = jobServices.reduce((sum, js) => {
    const discount = Number(discounts[js.id] || 0)
    return sum + Math.max(0, js.line_total - discount)
  }, 0)
  const productsTotal = productLines.reduce((sum, p) => sum + p.unitPrice * p.quantity, 0)
  const preDiscountTotal = Math.round((servicesTotal + productsTotal) * 100) / 100

  // Applied on top of the per-service discounts above -- same base a promotion would use on the
  // server (create_sale() mirrors this exact computation), so the live preview here matches what
  // actually gets charged.
  const discountValueNum = Number(discountValue) || 0
  const manualDiscountAmount =
    discountValueNum > 0
      ? Math.round(
          (discountType === 'percentage'
            ? (preDiscountTotal * Math.min(discountValueNum, 100)) / 100
            : Math.min(discountValueNum, preDiscountTotal)) * 100,
        ) / 100
      : 0

  const roundedTotal = Math.max(0, preDiscountTotal - manualDiscountAmount)
  const paidSoFar = payments.reduce((sum, p) => sum + p.amount, 0)
  const remaining = Math.round((roundedTotal - paidSoFar) * 100) / 100
  // create_sale() requires payments to sum exactly to the total -- a payment amount is money
  // actually kept, not cash tendered -- so an amount typed over what's due is change to hand
  // back, never part of the recorded payment.
  const enteredAmount = Number(amount) || 0
  const changeDue = method === 'cash' && enteredAmount > remaining ? Math.round((enteredAmount - remaining) * 100) / 100 : 0

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
    const entered = Number(amount || remaining)
    if (Number.isNaN(entered) || entered <= 0) return
    const value = Math.min(entered, remaining)
    const overpaid = method === 'cash' && entered > remaining
    setPayments((prev) => [
      ...prev,
      {
        method,
        amount: value,
        referenceNote: referenceNote.trim() || undefined,
        tenderedAmount: overpaid ? entered : undefined,
        changeGiven: overpaid ? Math.round((entered - remaining) * 100) / 100 : undefined,
      },
    ])
    setAmount('')
    setReferenceNote('')
  }

  async function handleSubmit() {
    if (!jobId || !shiftId || !profile) return
    setSubmitting(true)
    // Generated once and reused for both the live attempt and the offline-queued fallback below --
    // create_sale() is idempotent on it, so if the live call actually reached the server but its
    // response got lost on the way back, the queued retry returns the sale that already exists
    // instead of billing the customer a second time.
    const clientGeneratedId = crypto.randomUUID()
    const saleInput = {
      tenantId: profile.tenantId,
      shiftId,
      jobId,
      lineItems: jobServices.map((js) => ({ jobServiceId: js.id, discountAmount: Number(discounts[js.id] || 0) })),
      productLines: productLines.map((p) => ({ itemId: p.itemId, quantity: p.quantity })),
      payments,
      manualDiscountType: discountValueNum > 0 ? discountType : undefined,
      manualDiscountValue: discountValueNum > 0 ? discountValueNum : undefined,
    }
    try {
      try {
        const sale = await createSaleForJob(saleInput, clientGeneratedId)
        setResult({
          saleNumber: sale.sale_number,
          total: sale.total,
          createdAt: sale.created_at,
          manualDiscountAmount: sale.manual_discount_amount,
        })
        toast.success('Payment recorded')
      } catch (err) {
        if (!isLikelyNetworkFailure(err)) throw err
        // A genuine validation error (e.g. "payments don't cover the total") has a real Postgres
        // error code and a working connection behind it -- rethrown above so it surfaces to the
        // cashier right now instead of being queued as if it might just need a retry. Only an
        // actual connectivity gap falls through to here.
        await queuePaymentOffline(saleInput, clientGeneratedId)
        setResult({
          saleNumber: `PENDING-${jobNumber}`,
          total: roundedTotal,
          createdAt: new Date().toISOString(),
          manualDiscountAmount: manualDiscountAmount,
        })
        toast.success("Payment recorded -- it'll sync once you're back online")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record payment')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading…</p>

  if (loadError) {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="mb-4 text-muted-foreground">{loadError}</p>
            <Button variant="outline" onClick={() => navigate('/jobs')}>
              Back to queue
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!shiftId) {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="mb-4 text-muted-foreground">
              {online
                ? 'You need an open shift before collecting payment.'
                : "Can't confirm you have an open shift while offline, and none is cached on this device yet. Open a shift once while online so it's available offline afterward."}
            </p>
            {online && <Button onClick={() => navigate('/shift')}>Open a shift</Button>}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (result) {
    const receiptItems = [
      ...jobServices.map((js) => ({
        name: js.serviceName,
        quantity: js.quantity,
        unitPrice: js.unit_price,
        lineTotal: Math.max(0, js.line_total - Number(discounts[js.id] || 0)),
      })),
      ...productLines.map((p) => ({ name: p.name, quantity: p.quantity, unitPrice: p.unitPrice, lineTotal: p.unitPrice * p.quantity })),
    ]
    const receiptPayments = payments.map((p) => ({
      methodLabel: METHOD_LABELS[p.method],
      amount: p.amount,
      tenderedAmount: p.tenderedAmount,
      changeGiven: p.changeGiven,
    }))

    return (
      <div className="mx-auto max-w-md">
        <Card className="print:hidden">
          <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
            <div className="text-lg font-semibold">Payment recorded</div>
            <div className="text-muted-foreground">{result.saleNumber}</div>
            {result.saleNumber.startsWith('PENDING-') && (
              <p className="text-xs text-muted-foreground">
                Saved on this device — it'll get a real invoice number once you're back online.
              </p>
            )}
            <div className="text-2xl font-semibold">{formatMoney(result.total)}</div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => window.print()}>
                Print receipt
              </Button>
              <Button onClick={() => navigate('/jobs')}>Back to queue</Button>
            </div>
          </CardContent>
        </Card>

        {settings && (
          <div className="hidden print:block">
            <Receipt
              businessName={settings.business_name}
              logoUrl={settings.logo_url}
              receiptHeader={settings.receipt_header}
              address={settings.address}
              locationName={locationName}
              paperWidth={(settings.receipt_paper_width as '58mm' | '80mm') || '58mm'}
              saleNumber={result.saleNumber}
              plateNumber={plate}
              vehicleModel={vehicleModel}
              crewNames={crewNames}
              createdAt={result.createdAt}
              items={receiptItems}
              subtotal={preDiscountTotal}
              discount={result.manualDiscountAmount}
              promotionDiscount={0}
              membershipDiscount={0}
              total={result.total}
              payments={receiptPayments}
              receiptFooter={settings.receipt_footer}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">Collect Payment</h1>
          {offlineMode && <Badge variant="destructive">Offline — using cached data</Badge>}
        </div>
        <p className="text-muted-foreground">
          {jobNumber} · {plate}
          {customer && ` · ${customer.full_name}`}
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
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => removeProductLine(p.itemId)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Discount on total</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label>Type</Label>
            <Select value={discountType} onValueChange={(v) => setDiscountType(v as 'percentage' | 'fixed')}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">Percentage</SelectItem>
                <SelectItem value="fixed">Fixed amount</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{discountType === 'percentage' ? 'Percent off' : 'Amount off'}</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              max={discountType === 'percentage' ? 100 : undefined}
              className="w-28"
              placeholder="0"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
            />
          </div>
          {manualDiscountAmount > 0 && (
            <span className="pb-2 text-sm text-muted-foreground">-{formatMoney(manualDiscountAmount)}</span>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-1 pt-6">
          {manualDiscountAmount > 0 && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatMoney(preDiscountTotal)}</span>
            </div>
          )}
          {manualDiscountAmount > 0 && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Discount</span>
              <span>-{formatMoney(manualDiscountAmount)}</span>
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
                      className="h-8 w-8"
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
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setAmount(remaining > 0 ? remaining.toFixed(2) : '0')}>
              Exact Amount
            </Button>
            {[200, 500, 1000].map((v) => (
              <Button key={v} type="button" variant="outline" onClick={() => setAmount(String(v))}>
                ₱{v.toLocaleString()}
              </Button>
            ))}
          </div>
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder={remaining > 0 ? remaining.toFixed(2) : '0.00'}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {changeDue > 0 && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Change due</span>
              <span>{formatMoney(changeDue)}</span>
            </div>
          )}
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

          <Button size="lg" disabled={submitting || payments.length === 0 || Math.abs(remaining) > 0.01} onClick={handleSubmit}>
            Complete payment
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
