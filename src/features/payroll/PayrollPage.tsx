import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMoney } from '@/lib/money'
import {
  addPayrollAdjustment,
  generatePayrollPeriod,
  listPayrollAdjustments,
  listPayrollEntries,
  listPayrollPeriods,
  lockPayrollPeriod,
  markPayrollPeriodPaid,
  updatePayrollEntry,
  type PayrollAdjustment,
  type PayrollPeriod,
} from './api/payrollApi'

type Entry = Awaited<ReturnType<typeof listPayrollEntries>>[number]

function today() {
  return new Date().toISOString().slice(0, 10)
}

export function PayrollPage() {
  const { profile } = useTenant()
  const [periods, setPeriods] = useState<PayrollPeriod[]>([])
  const [selected, setSelected] = useState<PayrollPeriod | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [adjustmentsByEntry, setAdjustmentsByEntry] = useState<Record<string, PayrollAdjustment[]>>({})
  const [loading, setLoading] = useState(true)

  const [periodType, setPeriodType] = useState('daily')
  const [startDate, setStartDate] = useState(today())
  const [endDate, setEndDate] = useState(today())
  const [generating, setGenerating] = useState(false)

  const [adjustmentDrafts, setAdjustmentDrafts] = useState<Record<string, { amount: string; reason: string }>>({})

  async function reloadPeriods() {
    setPeriods(await listPayrollPeriods())
  }

  async function selectPeriod(period: PayrollPeriod) {
    setSelected(period)
    setLoading(true)
    try {
      const entryRows = await listPayrollEntries(period.id)
      setEntries(entryRows)
      if (period.status !== 'draft') {
        const adjPairs = await Promise.all(entryRows.map(async (e) => [e.id, await listPayrollAdjustments(e.id)] as const))
        setAdjustmentsByEntry(Object.fromEntries(adjPairs))
      } else {
        setAdjustmentsByEntry({})
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load payroll entries')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reloadPeriods().finally(() => setLoading(false))
  }, [])

  async function handleGenerate() {
    if (!profile) return
    setGenerating(true)
    try {
      const result = await generatePayrollPeriod(periodType, startDate, endDate)
      toast.success(`Generated ${result.entries_created} entr${result.entries_created === 1 ? 'y' : 'ies'}`)
      await reloadPeriods()
      const created = (await listPayrollPeriods()).find((p) => p.id === result.id)
      if (created) await selectPeriod(created)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate payroll period')
    } finally {
      setGenerating(false)
    }
  }

  async function handleEntryChange(entryId: string, field: keyof Entry, value: string) {
    const num = Number(value)
    if (Number.isNaN(num)) return
    setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, [field]: num } : e)))
  }

  async function saveEntry(entry: Entry) {
    try {
      await updatePayrollEntry(entry.id, {
        base_pay: entry.base_pay,
        tips: entry.tips,
        bonus: entry.bonus,
        cash_advance: entry.cash_advance,
        deductions: entry.deductions,
        adjustments: entry.adjustments,
      })
      if (selected) await selectPeriod(selected)
      toast.success('Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  async function handleLock() {
    if (!selected) return
    try {
      await lockPayrollPeriod(selected.id)
      toast.success('Period locked')
      await reloadPeriods()
      const updated = (await listPayrollPeriods()).find((p) => p.id === selected.id)
      if (updated) await selectPeriod(updated)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to lock period')
    }
  }

  async function handleMarkPaid() {
    if (!selected) return
    try {
      await markPayrollPeriodPaid(selected.id)
      toast.success('Marked as paid')
      await reloadPeriods()
      const updated = (await listPayrollPeriods()).find((p) => p.id === selected.id)
      if (updated) await selectPeriod(updated)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark paid')
    }
  }

  async function handleAddAdjustment(entryId: string) {
    if (!profile) return
    const draft = adjustmentDrafts[entryId]
    const amount = Number(draft?.amount)
    if (!draft || Number.isNaN(amount) || amount === 0 || !draft.reason.trim()) {
      toast.error('Enter a non-zero amount and a reason')
      return
    }
    try {
      await addPayrollAdjustment({ tenantId: profile.tenantId, entryId, amount, reason: draft.reason.trim(), createdBy: profile.id })
      setAdjustmentDrafts((prev) => ({ ...prev, [entryId]: { amount: '', reason: '' } }))
      if (selected) await selectPeriod(selected)
      toast.success('Adjustment recorded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record adjustment')
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Generate period</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Select value={periodType} onValueChange={setPeriodType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="semi_monthly">Semi-monthly</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex flex-col gap-1.5">
              <Label>Start date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>End date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <Button disabled={generating} onClick={handleGenerate}>
              Generate
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Periods</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {periods.map((p) => (
              <button
                key={p.id}
                className="flex items-center justify-between rounded-md border p-2 text-left text-sm hover:bg-accent"
                onClick={() => selectPeriod(p)}
              >
                <span>
                  {p.start_date} → {p.end_date}
                </span>
                <Badge variant={p.status === 'paid' ? 'outline' : p.status === 'locked' ? 'secondary' : 'default'}>
                  {p.status}
                </Badge>
              </button>
            ))}
            {periods.length === 0 && !loading && <p className="text-muted-foreground">No periods yet.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        {!selected ? (
          <p className="text-muted-foreground">Select or generate a payroll period.</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {selected.start_date} → {selected.end_date} ({selected.status})
              </h2>
              <div className="flex gap-2">
                {selected.status === 'draft' && <Button onClick={handleLock}>Lock period</Button>}
                {selected.status === 'locked' && <Button onClick={handleMarkPaid}>Mark as paid</Button>}
              </div>
            </div>

            {entries.map((entry) => (
              <Card key={entry.id}>
                <CardHeader>
                  <CardTitle className="text-base">{entry.employeeName}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Base pay</TableHead>
                        <TableHead>Commission</TableHead>
                        <TableHead>Tips</TableHead>
                        <TableHead>Bonus</TableHead>
                        <TableHead>Cash advance</TableHead>
                        <TableHead>Deductions</TableHead>
                        <TableHead>Net pay</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            className="w-24"
                            disabled={selected.status !== 'draft'}
                            value={entry.base_pay}
                            onChange={(e) => handleEntryChange(entry.id, 'base_pay', e.target.value)}
                            onBlur={() => saveEntry(entry)}
                          />
                        </TableCell>
                        <TableCell>{formatMoney(entry.commission_total)}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            className="w-24"
                            disabled={selected.status !== 'draft'}
                            value={entry.tips}
                            onChange={(e) => handleEntryChange(entry.id, 'tips', e.target.value)}
                            onBlur={() => saveEntry(entry)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            className="w-24"
                            disabled={selected.status !== 'draft'}
                            value={entry.bonus}
                            onChange={(e) => handleEntryChange(entry.id, 'bonus', e.target.value)}
                            onBlur={() => saveEntry(entry)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            className="w-24"
                            disabled={selected.status !== 'draft'}
                            value={entry.cash_advance}
                            onChange={(e) => handleEntryChange(entry.id, 'cash_advance', e.target.value)}
                            onBlur={() => saveEntry(entry)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            className="w-24"
                            disabled={selected.status !== 'draft'}
                            value={entry.deductions}
                            onChange={(e) => handleEntryChange(entry.id, 'deductions', e.target.value)}
                            onBlur={() => saveEntry(entry)}
                          />
                        </TableCell>
                        <TableCell className="font-semibold">{formatMoney(entry.net_pay)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>

                  {selected.status !== 'draft' && (
                    <div className="flex flex-col gap-2 border-t pt-3">
                      <div className="text-sm font-medium">Adjustments (post-lock corrections)</div>
                      {(adjustmentsByEntry[entry.id] ?? []).map((adj) => (
                        <div key={adj.id} className="flex justify-between text-sm text-muted-foreground">
                          <span>{adj.reason}</span>
                          <span>{formatMoney(adj.amount)}</span>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="Amount (+/-)"
                          className="w-32"
                          value={adjustmentDrafts[entry.id]?.amount ?? ''}
                          onChange={(e) =>
                            setAdjustmentDrafts((prev) => ({ ...prev, [entry.id]: { amount: e.target.value, reason: prev[entry.id]?.reason ?? '' } }))
                          }
                        />
                        <Input
                          placeholder="Reason"
                          value={adjustmentDrafts[entry.id]?.reason ?? ''}
                          onChange={(e) =>
                            setAdjustmentDrafts((prev) => ({ ...prev, [entry.id]: { amount: prev[entry.id]?.amount ?? '', reason: e.target.value } }))
                          }
                        />
                        <Button size="sm" variant="secondary" onClick={() => handleAddAdjustment(entry.id)}>
                          Add
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
