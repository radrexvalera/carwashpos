import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMoney } from '@/lib/money'
import { safeSetItem } from '@/lib/safeStorage'
import { listLocations } from '@/features/catalog/api/catalogApi'
import {
  closeShift,
  correctShiftCountedCash,
  getActiveShift,
  getShiftSummary,
  listCashMovements,
  listRecentShifts,
  openShift,
  recordCashMovement,
  type CashierShift,
  type CashMovement,
  type ShiftSummary,
} from './api/shiftsApi'

type RecentShift = CashierShift & { cashierName: string }

const METHOD_LABELS: Record<string, string> = {
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

export function ShiftPage() {
  const { profile } = useTenant()
  const [shift, setShift] = useState<CashierShift | null>(null)
  const [movements, setMovements] = useState<CashMovement[]>([])
  const [summary, setSummary] = useState<ShiftSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [locationId, setLocationId] = useState('')
  const [openingFloat, setOpeningFloat] = useState('')
  const [dayType, setDayType] = useState<'regular' | 'holiday'>('regular')
  const [movementType, setMovementType] = useState<'cash_in' | 'cash_out'>('cash_out')
  const [movementAmount, setMovementAmount] = useState('')
  const [movementCategory, setMovementCategory] = useState('')
  const [movementReason, setMovementReason] = useState('')
  const [countedCash, setCountedCash] = useState('')
  const [varianceReason, setVarianceReason] = useState('')
  const [closedResult, setClosedResult] = useState<{
    id: string
    expected: number
    counted: number
    variance: number
    summary: ShiftSummary | null
  } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [recentShifts, setRecentShifts] = useState<RecentShift[]>([])
  const [editingShift, setEditingShift] = useState<{ id: string; countedCash: number | null } | null>(null)
  const [editCountedCash, setEditCountedCash] = useState('')
  const [editReason, setEditReason] = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)

  async function reloadRecentShifts() {
    try {
      setRecentShifts(await listRecentShifts())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load recent shifts')
    }
  }

  async function reload() {
    setLoading(true)
    try {
      const active = await getActiveShift()
      setShift(active)
      // Warms the same shift-id cache JobPaymentPage reads from when offline -- this page is
      // where a shift is actually opened, so caching it here (not just on Register/Collect
      // Payment) is the earliest point it can become available for offline use.
      if (active && profile) safeSetItem(`openShiftId:${profile.id}`, active.id)
      if (active) {
        const [movementsData, summaryData] = await Promise.all([listCashMovements(active.id), getShiftSummary(active.id)])
        setMovements(movementsData)
        setSummary(summaryData)
      } else {
        const locations = await listLocations()
        if (locations[0]) setLocationId(locations[0].id)
      }
      await reloadRecentShifts()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load shift')
    } finally {
      setLoading(false)
    }
  }

  function openEditShift(s: { id: string; counted_cash: number | null }) {
    setEditingShift({ id: s.id, countedCash: s.counted_cash })
    setEditCountedCash(s.counted_cash != null ? String(s.counted_cash) : '')
    setEditReason('')
  }

  async function handleCorrectShift() {
    if (!editingShift || !editCountedCash || !editReason.trim()) return
    setEditSubmitting(true)
    try {
      await correctShiftCountedCash(editingShift.id, Number(editCountedCash), editReason.trim())
      toast.success('Counted cash corrected')
      setEditingShift(null)
      await reloadRecentShifts()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to correct counted cash')
    } finally {
      setEditSubmitting(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function handleOpenShift() {
    if (!profile || !locationId) return
    setSubmitting(true)
    try {
      await openShift({
        tenantId: profile.tenantId,
        locationId,
        openingFloat: Number(openingFloat) || 0,
        isHoliday: dayType === 'holiday',
      })
      toast.success('Shift opened')
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open shift')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleAddMovement() {
    if (!profile || !shift) return
    const amount = Number(movementAmount)
    if (!amount || amount <= 0 || !movementCategory.trim()) {
      toast.error('Amount and category are required')
      return
    }
    setSubmitting(true)
    try {
      await recordCashMovement({
        tenantId: profile.tenantId,
        shiftId: shift.id,
        type: movementType,
        amount,
        category: movementCategory.trim(),
        reason: movementReason.trim() || null,
        createdBy: profile.id,
      })
      setMovementAmount('')
      setMovementCategory('')
      setMovementReason('')
      const [movementsData, summaryData] = await Promise.all([listCashMovements(shift.id), getShiftSummary(shift.id)])
      setMovements(movementsData)
      setSummary(summaryData)
      toast.success('Recorded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record cash movement')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCloseShift() {
    if (!shift) return
    setSubmitting(true)
    try {
      const result = await closeShift(shift.id, Number(countedCash) || 0, varianceReason.trim() || undefined)
      setClosedResult({ id: result.id, expected: result.expected_cash, counted: result.counted_cash, variance: result.variance, summary })
      toast.success('Shift closed')
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to close shift')
    } finally {
      setSubmitting(false)
    }
  }

  const editShiftDialog = (
    <Dialog open={!!editingShift} onOpenChange={(o) => !o && setEditingShift(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct counted cash</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-counted-cash">Counted cash</Label>
            <Input
              id="edit-counted-cash"
              type="number"
              step="0.01"
              min="0"
              value={editCountedCash}
              onChange={(e) => setEditCountedCash(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-reason">Reason (required)</Label>
            <Input
              id="edit-reason"
              placeholder="e.g. Typo -- meant 1,500 not 1,000"
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={editSubmitting || !editCountedCash || !editReason.trim()} onClick={handleCorrectShift}>
            Save correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  const recentShiftsCard = (
    <Card>
      <CardHeader>
        <CardTitle>Recent shifts</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {recentShifts.length === 0 ? (
          <p className="text-muted-foreground">No closed shifts yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cashier</TableHead>
                <TableHead>Closed</TableHead>
                <TableHead className="text-right">Expected</TableHead>
                <TableHead className="text-right">Counted</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentShifts.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.cashierName}</TableCell>
                  <TableCell>{s.closed_at ? new Date(s.closed_at).toLocaleString() : '—'}</TableCell>
                  <TableCell className="text-right">{formatMoney(s.expected_cash ?? 0)}</TableCell>
                  <TableCell className="text-right">
                    {formatMoney(s.counted_cash ?? 0)}
                    {s.corrected_at && (
                      <Badge variant="outline" className="ml-2" title={s.correction_reason ?? undefined}>
                        Corrected
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className={`text-right ${s.variance && s.variance !== 0 ? 'text-destructive' : ''}`}>
                    {formatMoney(s.variance ?? 0)}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => openEditShift({ id: s.id, counted_cash: s.counted_cash })}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )

  if (loading) {
    return <p className="text-muted-foreground">Loading…</p>
  }

  if (closedResult) {
    const s = closedResult.summary
    return (
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Shift closed</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {s && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Opening float</span>
                  <span>{formatMoney(s.openingFloat)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">+ Cash sales</span>
                  <span>{formatMoney(s.cashSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">+ Cash in</span>
                  <span>{formatMoney(s.cashIn)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">− Cash out</span>
                  <span>{formatMoney(s.cashOut)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">− Cash expenses</span>
                  <span>{formatMoney(s.cashExpenses)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">− Cash advances</span>
                  <span>{formatMoney(s.cashAdvances)}</span>
                </div>
                <Separator />
              </>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expected cash</span>
              <span>{formatMoney(closedResult.expected)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Counted cash</span>
              <span>{formatMoney(closedResult.counted)}</span>
            </div>
            <Separator />
            <div className="flex justify-between font-semibold">
              <span>Variance</span>
              <span className={closedResult.variance !== 0 ? 'text-destructive' : ''}>
                {formatMoney(closedResult.variance)}
              </span>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                onClick={() => openEditShift({ id: closedResult.id, counted_cash: closedResult.counted })}
              >
                Fix counted cash
              </Button>
              <Button onClick={() => setClosedResult(null)}>Start a new shift</Button>
            </div>
          </CardContent>
        </Card>
        {recentShiftsCard}
        {editShiftDialog}
      </div>
    )
  }

  if (!shift) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Open a shift</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">You need an open shift before taking payments.</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="opening-float">Opening cash float</Label>
              <Input
                id="opening-float"
                type="number"
                step="0.01"
                min="0"
                value={openingFloat}
                onChange={(e) => setOpeningFloat(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="day-type">Day type</Label>
              <Select value={dayType} onValueChange={(v) => setDayType(v as 'regular' | 'holiday')}>
                <SelectTrigger id="day-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="regular">Regular Day</SelectItem>
                  <SelectItem value="holiday">Holiday</SelectItem>
                </SelectContent>
              </Select>
              {dayType === 'holiday' && (
                <p className="text-xs text-muted-foreground">
                  Wash commission will use the holiday rate for every job picked up during this shift.
                </p>
              )}
            </div>
            <Button disabled={submitting} onClick={handleOpenShift}>
              Open shift
            </Button>
          </CardContent>
        </Card>
        {recentShiftsCard}
        {editShiftDialog}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          Active Shift
          {shift.is_holiday && <Badge variant="destructive">Holiday</Badge>}
        </h1>
        <p className="text-muted-foreground">Opened {new Date(shift.opened_at).toLocaleString()}</p>
      </div>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle>Cash drawer</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Opening float</span>
                <span>{formatMoney(summary.openingFloat)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">+ Cash sales</span>
                <span>{formatMoney(summary.cashSales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">+ Cash in</span>
                <span>{formatMoney(summary.cashIn)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">− Cash out</span>
                <span>{formatMoney(summary.cashOut)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">− Cash expenses</span>
                <span>{formatMoney(summary.cashExpenses)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">− Cash advances</span>
                <span>{formatMoney(summary.cashAdvances)}</span>
              </div>
              <Separator className="my-1" />
              <div className="flex justify-between text-base font-semibold">
                <span>Expected in drawer</span>
                <span>{formatMoney(summary.expectedCash)}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 text-sm">
              <div className="text-muted-foreground">
                Other payment methods this shift (already settled online — not counted in the drawer)
              </div>
              {Object.entries(summary.byMethod).filter(([method]) => method !== 'cash').length === 0 ? (
                <p className="text-muted-foreground">None this shift.</p>
              ) : (
                Object.entries(summary.byMethod)
                  .filter(([method]) => method !== 'cash')
                  .map(([method, total]) => (
                    <div key={method} className="flex justify-between">
                      <span>{METHOD_LABELS[method] ?? method}</span>
                      <span>{formatMoney(total)}</span>
                    </div>
                  ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cash in / out</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Select value={movementType} onValueChange={(v) => setMovementType(v as 'cash_in' | 'cash_out')}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash_in">Cash in</SelectItem>
                  <SelectItem value="cash_out">Cash out</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Amount"
                value={movementAmount}
                onChange={(e) => setMovementAmount(e.target.value)}
              />
            </div>
            <Input placeholder="Category (e.g. Supplies, Petty cash)" value={movementCategory} onChange={(e) => setMovementCategory(e.target.value)} />
            <Input placeholder="Reason (optional)" value={movementReason} onChange={(e) => setMovementReason(e.target.value)} />
            <Button variant="secondary" disabled={submitting} onClick={handleAddMovement}>
              Record
            </Button>

            <Separator className="my-2" />

            <div className="flex flex-col gap-1 text-sm">
              {movements.length === 0 && <p className="text-muted-foreground">No cash movements yet.</p>}
              {movements.map((m) => (
                <div key={m.id} className="flex justify-between">
                  <span>
                    {m.type === 'cash_in' ? '+' : '-'} {m.category}
                    {m.reason ? ` · ${m.reason}` : ''}
                  </span>
                  <span>{formatMoney(m.amount)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Close shift</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {summary && (
              <div className="flex justify-between rounded-md bg-muted px-3 py-2 text-sm">
                <span className="text-muted-foreground">Expected cash</span>
                <span className="font-semibold">{formatMoney(summary.expectedCash)}</span>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="counted-cash">Counted cash in drawer</Label>
              <Input
                id="counted-cash"
                type="number"
                step="0.01"
                min="0"
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <Input
              placeholder="Variance explanation (if any)"
              value={varianceReason}
              onChange={(e) => setVarianceReason(e.target.value)}
            />
            <Button variant="destructive" disabled={submitting || !countedCash} onClick={handleCloseShift}>
              Close shift
            </Button>
          </CardContent>
        </Card>
      </div>

      {recentShiftsCard}
      {editShiftDialog}
    </div>
  )
}
