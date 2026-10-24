import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMoney } from '@/lib/money'
import { localDateString } from '@/lib/date'
import { getSettings, type Settings } from '@/features/settings/api/settingsApi'
import { EditCrewDialog } from '@/features/jobs/EditCrewDialog'
import { Receipt } from '@/features/jobs/Receipt'
import { getSaleDetail, listSales, listSalesByPlate, voidSale, type SaleDetail, type SaleListRow } from './api/salesApi'

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localDateString(d)
}

export function TransactionsPage() {
  const { profile } = useTenant()
  const [from, setFrom] = useState(daysAgo(7))
  const [to, setTo] = useState(localDateString())
  const [plateQuery, setPlateQuery] = useState('')
  const [activePlateQuery, setActivePlateQuery] = useState('')
  const [sales, setSales] = useState<SaleListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SaleDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editingCrewJobId, setEditingCrewJobId] = useState<string | null>(null)
  const [voidingSale, setVoidingSale] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [voidReverseCommission, setVoidReverseCommission] = useState(false)
  const [voidSubmitting, setVoidSubmitting] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const plate = plateQuery.trim()
      if (plate) {
        setActivePlateQuery(plate)
        setSales(await listSalesByPlate(plate))
      } else {
        setActivePlateQuery('')
        const fromIso = new Date(`${from}T00:00:00`).toISOString()
        const toIso = new Date(`${to}T23:59:59`).toISOString()
        setSales(await listSales(fromIso, toIso))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load transactions')
    } finally {
      setLoading(false)
    }
  }

  function clearPlateSearch() {
    setPlateQuery('')
    setActivePlateQuery('')
    setLoading(true)
    const fromIso = new Date(`${from}T00:00:00`).toISOString()
    const toIso = new Date(`${to}T23:59:59`).toISOString()
    listSales(fromIso, toIso)
      .then(setSales)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load transactions'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!profile) return
    getSettings(profile.tenantId)
      .then(setSettings)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load settings'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.tenantId])

  function openSale(saleId: string) {
    setSelectedSaleId(saleId)
    setDetail(null)
    setDetailLoading(true)
    getSaleDetail(saleId)
      .then(setDetail)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load transaction'))
      .finally(() => setDetailLoading(false))
  }

  async function handleVoid() {
    if (!detail || !voidReason.trim()) return
    setVoidSubmitting(true)
    try {
      const result = await voidSale(detail.id, voidReason.trim(), voidReverseCommission)
      setDetail((prev) => (prev ? { ...prev, status: 'voided' } : prev))
      setSales((prev) => prev.map((s) => (s.id === detail.id ? { ...s, status: 'voided' } : s)))
      setVoidingSale(false)
      setVoidReason('')
      setVoidReverseCommission(false)
      if (result.commission_skipped_count > 0) {
        toast.success(
          `Transaction voided. Commission reversed for ${result.commission_reversed_count}, but ${result.commission_skipped_count} line(s) were already paid out through payroll -- use a payroll adjustment to correct those.`,
        )
      } else if (result.commission_reversed_count > 0) {
        toast.success(`Transaction voided. Commission reversed for ${result.commission_reversed_count} employee(s).`)
      } else {
        toast.success('Transaction voided')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to void transaction')
    } finally {
      setVoidSubmitting(false)
    }
  }

  return (
    <>
    <div className="flex flex-col gap-6 print:hidden">
      <div>
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <p className="text-muted-foreground">Recent sales — view details or reprint a receipt.</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="flex flex-col gap-1.5">
            <Label>From</Label>
            <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} disabled={!!activePlateQuery} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>To</Label>
            <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} disabled={!!activePlateQuery} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Plate number</Label>
            <Input
              placeholder="e.g. ABC-1234"
              value={plateQuery}
              onChange={(e) => setPlateQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              className="w-40"
            />
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            {plateQuery.trim() ? 'Search' : 'Refresh'}
          </Button>
          {activePlateQuery && (
            <Button variant="ghost" onClick={clearPlateSearch} disabled={loading}>
              Clear
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {activePlateQuery && (
            <p className="mb-3 text-sm text-muted-foreground">
              Showing full transaction history for plate matching “{activePlateQuery}”, across all dates.
            </p>
          )}
          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : sales.length === 0 ? (
            <p className="text-muted-foreground">
              {activePlateQuery ? 'No transactions found for this plate number.' : 'No transactions in this period.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Sale #</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{new Date(s.createdAt).toLocaleString()}</TableCell>
                    <TableCell>{s.saleNumber}</TableCell>
                    <TableCell>{s.plateNumber ?? '—'}</TableCell>
                    <TableCell>{s.customerName ?? '—'}</TableCell>
                    <TableCell>{formatMoney(s.total)}</TableCell>
                    <TableCell>
                      <Badge variant={s.status === 'completed' ? 'outline' : 'destructive'}>
                        {s.status === 'completed' ? s.paymentStatus : s.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => openSale(s.id)}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>

      <Dialog open={!!selectedSaleId} onOpenChange={(o) => !o && setSelectedSaleId(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="print:hidden">
            <DialogTitle>Transaction detail</DialogTitle>
          </DialogHeader>

          {detailLoading || !detail ? (
            <p className="text-muted-foreground print:hidden">Loading…</p>
          ) : (
            <>
              <div className="flex flex-col gap-2 print:hidden">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Sale number</span>
                  <span className="font-medium">
                    {detail.saleNumber}
                    {detail.status === 'voided' && <Badge variant="destructive" className="ml-2">Voided</Badge>}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Date</span>
                  <span>{new Date(detail.createdAt).toLocaleString()}</span>
                </div>
                {detail.plateNumber && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Vehicle</span>
                    <span>{detail.plateNumber}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Cashier</span>
                  <span>{detail.cashierName}</span>
                </div>

                <div className="mt-2 flex flex-col gap-1 border-t pt-2">
                  {detail.items.map((item, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span>
                        {item.name} × {item.quantity}
                      </span>
                      <span>{formatMoney(item.lineTotal)}</span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col gap-1 border-t pt-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatMoney(detail.subtotal)}</span>
                  </div>
                  {detail.manualDiscount > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Discount</span>
                      <span>−{formatMoney(detail.manualDiscount)}</span>
                    </div>
                  )}
                  {detail.promotionDiscount > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Promotion discount</span>
                      <span>−{formatMoney(detail.promotionDiscount)}</span>
                    </div>
                  )}
                  {detail.membershipDiscount > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Free service (stamp card)</span>
                      <span>−{formatMoney(detail.membershipDiscount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base font-semibold">
                    <span>Total</span>
                    <span>{formatMoney(detail.total)}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1 border-t pt-2 text-sm">
                  {detail.payments.map((p, i) => (
                    <div key={i} className="flex justify-between">
                      <span>{p.methodLabel}</span>
                      <span>{formatMoney(p.tenderedAmount ?? p.amount)}</span>
                    </div>
                  ))}
                  {detail.payments.some((p) => p.changeGiven) && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Change</span>
                      <span>{formatMoney(detail.payments.reduce((sum, p) => sum + (p.changeGiven ?? 0), 0))}</span>
                    </div>
                  )}
                </div>

                <div className="mt-2 flex gap-2">
                  <Button variant="outline" onClick={() => window.print()}>
                    Print receipt
                  </Button>
                  {detail.jobId && (
                    <Button variant="outline" onClick={() => setEditingCrewJobId(detail.jobId)}>
                      Edit crew
                    </Button>
                  )}
                  {detail.status !== 'voided' && (
                    <Button variant="destructive" onClick={() => setVoidingSale(true)}>
                      Void transaction
                    </Button>
                  )}
                </div>
              </div>

              {settings && (
                <div className="hidden print:block">
                  <Receipt
                    businessName={settings.business_name}
                    logoUrl={settings.logo_url}
                    receiptHeader={settings.receipt_header}
                    address={settings.address}
                    locationName={detail.locationName}
                    paperWidth={(settings.receipt_paper_width as '58mm' | '80mm') || '58mm'}
                    saleNumber={detail.saleNumber}
                    cashierName={detail.cashierName}
                    createdAt={detail.createdAt}
                    items={detail.items}
                    subtotal={detail.subtotal}
                    discount={detail.manualDiscount}
                    promotionDiscount={detail.promotionDiscount}
                    membershipDiscount={detail.membershipDiscount}
                    total={detail.total}
                    payments={detail.payments}
                    receiptFooter={settings.receipt_footer}
                  />
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={voidingSale} onOpenChange={(o) => !o && setVoidingSale(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void transaction</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {detail?.saleNumber} — {formatMoney(detail?.total ?? 0)}. This releases its services to be billed again, gives back
              any retail stock it consumed, and can't be undone.
            </p>
            <Input
              placeholder="Reason (required)"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
            />
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={voidReverseCommission} onCheckedChange={(c) => setVoidReverseCommission(c === true)} />
              <span>
                Also reverse commission for this job
                <span className="block text-xs text-muted-foreground">
                  Leave off for a billing mistake where the service still happened. Check it if the job itself was bad or
                  undone.
                </span>
              </span>
            </label>
            <Button variant="destructive" disabled={!voidReason.trim() || voidSubmitting} onClick={handleVoid}>
              Confirm void
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {profile && (
        <EditCrewDialog
          jobId={editingCrewJobId}
          tenantId={profile.tenantId}
          onOpenChange={(o) => !o && setEditingCrewJobId(null)}
          onSaved={() => {}}
        />
      )}
    </>
  )
}
