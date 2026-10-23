import { useEffect, useState } from 'react'
import { pdf } from '@react-pdf/renderer'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMoney } from '@/lib/money'
import { localDateString } from '@/lib/date'
import { getSettings, type Settings } from '@/features/settings/api/settingsApi'
import { listEmployees } from '@/features/employees/api/employeesApi'
import { getPayrollEntryJobBreakdown, type PayrollJobBreakdownRow } from '@/features/commission/api/commissionReportApi'
import { Payslip } from './Payslip'
import { PayslipPdfDocument } from './PayslipPdfDocument'
import {
  addPayrollAdjustment,
  addPayrollDeduction,
  createCashAdvance,
  deletePayrollPeriod,
  generatePayrollPeriod,
  getCashAdvancesByIds,
  listCashAdvanceRepayments,
  listOutstandingCashAdvances,
  listPayrollAdjustments,
  listPayrollDeductions,
  listPayrollEntries,
  listPayrollPeriods,
  lockPayrollPeriod,
  markPayrollPeriodPaid,
  recordCashAdvanceRepayment,
  removePayrollDeduction,
  updatePayrollEntry,
  voidCashAdvanceRepayment,
  type CashAdvance,
  type CashAdvanceRepayment,
  type PayrollAdjustment,
  type PayrollDeduction,
  type PayrollPeriod,
} from './api/payrollApi'

type Entry = Awaited<ReturnType<typeof listPayrollEntries>>[number]
type OutstandingAdvance = Awaited<ReturnType<typeof listOutstandingCashAdvances>>[number]

// Mirrors how each period type is actually meant to span -- daily is just today, weekly is the
// Monday-Sunday containing today, semi-monthly is the 1st-15th or 16th-end of the current month.
// Custom is left alone since its whole point is a manually chosen range.
function computePeriodDates(type: string): { start: string; end: string } | null {
  const today = new Date()
  if (type === 'daily') {
    const d = localDateString(today)
    return { start: d, end: d }
  }
  if (type === 'weekly') {
    const day = today.getDay()
    const diffToMonday = day === 0 ? -6 : 1 - day
    const monday = new Date(today)
    monday.setDate(today.getDate() + diffToMonday)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return { start: localDateString(monday), end: localDateString(sunday) }
  }
  if (type === 'semi_monthly') {
    const year = today.getFullYear()
    const month = today.getMonth()
    const day = today.getDate()
    if (day <= 15) {
      return { start: localDateString(new Date(year, month, 1)), end: localDateString(new Date(year, month, 15)) }
    }
    return { start: localDateString(new Date(year, month, 16)), end: localDateString(new Date(year, month + 1, 0)) }
  }
  return null
}


export function PayrollPage() {
  const { profile } = useTenant()
  const [periods, setPeriods] = useState<PayrollPeriod[]>([])
  const [selected, setSelected] = useState<PayrollPeriod | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [adjustmentsByEntry, setAdjustmentsByEntry] = useState<Record<string, PayrollAdjustment[]>>({})
  const [loading, setLoading] = useState(true)

  const [periodType, setPeriodType] = useState('daily')
  const [startDate, setStartDate] = useState(localDateString())
  const [endDate, setEndDate] = useState(localDateString())
  const [generating, setGenerating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PayrollPeriod | null>(null)
  const [deletingPeriod, setDeletingPeriod] = useState(false)

  const [adjustmentDrafts, setAdjustmentDrafts] = useState<Record<string, { amount: string; reason: string }>>({})
  const [settings, setSettings] = useState<Settings | null>(null)
  const [printingEntryId, setPrintingEntryId] = useState<string | null>(null)

  const [employees, setEmployees] = useState<{ id: string; full_name: string }[]>([])
  const [outstandingAdvances, setOutstandingAdvances] = useState<OutstandingAdvance[]>([])
  const [newAdvance, setNewAdvance] = useState({ employeeId: '', amount: '', date: localDateString(), reason: '' })
  const [creatingAdvance, setCreatingAdvance] = useState(false)

  const [repaymentsByEntry, setRepaymentsByEntry] = useState<Record<string, CashAdvanceRepayment[]>>({})
  const [advancesById, setAdvancesById] = useState<Record<string, CashAdvance>>({})
  const [repayDrafts, setRepayDrafts] = useState<Record<string, string>>({})

  const [deductionsByEntry, setDeductionsByEntry] = useState<Record<string, PayrollDeduction[]>>({})
  const [deductionDrafts, setDeductionDrafts] = useState<Record<string, { amount: string; reason: string }>>({})

  const [jobBreakdownByEntry, setJobBreakdownByEntry] = useState<Record<string, PayrollJobBreakdownRow[]>>({})

  async function reloadPeriods() {
    setPeriods(await listPayrollPeriods())
  }

  async function reloadOutstandingAdvances() {
    setOutstandingAdvances(await listOutstandingCashAdvances())
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

      const repayPairs = await Promise.all(entryRows.map(async (e) => [e.id, await listCashAdvanceRepayments(e.id)] as const))
      setRepaymentsByEntry(Object.fromEntries(repayPairs))
      const advanceIds = [...new Set(repayPairs.flatMap(([, repayments]) => repayments.map((r) => r.cash_advance_id)))]
      const advances = await getCashAdvancesByIds(advanceIds)
      setAdvancesById(Object.fromEntries(advances.map((a) => [a.id, a])))

      const deductionPairs = await Promise.all(entryRows.map(async (e) => [e.id, await listPayrollDeductions(e.id)] as const))
      setDeductionsByEntry(Object.fromEntries(deductionPairs))

      const breakdownPairs = await Promise.all(
        entryRows.map(async (e) => [e.id, await getPayrollEntryJobBreakdown(period.id, e.employee_id)] as const),
      )
      setJobBreakdownByEntry(Object.fromEntries(breakdownPairs))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load payroll entries')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reloadPeriods().finally(() => setLoading(false))
    listEmployees()
      .then((rows) => setEmployees(rows.map((e) => ({ id: e.id, full_name: e.full_name }))))
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load employees'))
    reloadOutstandingAdvances().catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load cash advances'))
  }, [])

  useEffect(() => {
    if (!profile) return
    getSettings(profile.tenantId)
      .then(setSettings)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load settings'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.tenantId])

  useEffect(() => {
    if (printingEntryId) window.print()
  }, [printingEntryId])

  function handlePeriodTypeChange(value: string) {
    setPeriodType(value)
    const dates = computePeriodDates(value)
    if (dates) {
      setStartDate(dates.start)
      setEndDate(dates.end)
    }
  }

  async function handleGenerate() {
    if (!profile) return
    setGenerating(true)
    try {
      const result = await generatePayrollPeriod(periodType, startDate, endDate)
      if (result.entries_created === 0) {
        toast.warning('No entries generated — no employee had commission activity or a configured salary rate in this date range.')
      } else {
        toast.success(`Generated ${result.entries_created} entr${result.entries_created === 1 ? 'y' : 'ies'}`)
      }
      await reloadPeriods()
      const created = (await listPayrollPeriods()).find((p) => p.id === result.id)
      if (created) await selectPeriod(created)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate payroll period')
    } finally {
      setGenerating(false)
    }
  }

  async function handleDeletePeriod() {
    if (!deleteTarget) return
    setDeletingPeriod(true)
    try {
      await deletePayrollPeriod(deleteTarget.id)
      toast.success('Payroll period deleted')
      if (selected?.id === deleteTarget.id) {
        setSelected(null)
        setEntries([])
      }
      setDeleteTarget(null)
      await reloadPeriods()
      await reloadOutstandingAdvances()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete payroll period')
    } finally {
      setDeletingPeriod(false)
    }
  }

  async function handleEntryChange(entryId: string, field: keyof Entry, value: string) {
    const num = Number(value)
    if (Number.isNaN(num)) return
    setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, [field]: num } : e)))
  }

  async function saveEntry(entry: Entry) {
    try {
      // cash_advance/deductions are no longer saved directly here -- they're derived totals kept
      // in sync by record_cash_advance_repayment()/add_payroll_deduction() (and their undo/remove
      // counterparts), so managers get an itemized, reasoned trail instead of one opaque number.
      await updatePayrollEntry(entry.id, {
        base_pay: entry.base_pay,
        tips: entry.tips,
        bonus: entry.bonus,
        adjustments: entry.adjustments,
        withholding_tax: entry.withholding_tax,
        sss_contribution: entry.sss_contribution,
        philhealth_contribution: entry.philhealth_contribution,
        pagibig_contribution: entry.pagibig_contribution,
        sss_loan: entry.sss_loan,
        hdmf_loan: entry.hdmf_loan,
      })
      if (selected) await selectPeriod(selected)
      toast.success('Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  async function handleCreateAdvance() {
    const amount = Number(newAdvance.amount)
    if (!newAdvance.employeeId || Number.isNaN(amount) || amount <= 0) {
      toast.error('Pick an employee and enter a valid amount')
      return
    }
    setCreatingAdvance(true)
    try {
      await createCashAdvance({
        employeeId: newAdvance.employeeId,
        amount,
        advanceDate: newAdvance.date,
        reason: newAdvance.reason.trim() || null,
      })
      setNewAdvance({ employeeId: '', amount: '', date: localDateString(), reason: '' })
      await reloadOutstandingAdvances()
      toast.success('Cash advance recorded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record cash advance')
    } finally {
      setCreatingAdvance(false)
    }
  }

  async function handleDeductAdvance(entryId: string, advanceId: string) {
    const key = `${entryId}:${advanceId}`
    const amount = Number(repayDrafts[key])
    if (!repayDrafts[key] || Number.isNaN(amount) || amount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    try {
      await recordCashAdvanceRepayment(advanceId, entryId, amount)
      setRepayDrafts((prev) => ({ ...prev, [key]: '' }))
      await reloadOutstandingAdvances()
      if (selected) await selectPeriod(selected)
      toast.success('Deduction recorded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record deduction')
    }
  }

  async function handleUndoRepayment(repaymentId: string) {
    try {
      await voidCashAdvanceRepayment(repaymentId)
      await reloadOutstandingAdvances()
      if (selected) await selectPeriod(selected)
      toast.success('Reverted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revert deduction')
    }
  }

  async function handleAddDeduction(entryId: string) {
    const draft = deductionDrafts[entryId]
    const amount = Number(draft?.amount)
    if (!draft || Number.isNaN(amount) || amount <= 0 || !draft.reason.trim()) {
      toast.error('Enter a valid amount and a reason')
      return
    }
    try {
      await addPayrollDeduction(entryId, amount, draft.reason.trim())
      setDeductionDrafts((prev) => ({ ...prev, [entryId]: { amount: '', reason: '' } }))
      if (selected) await selectPeriod(selected)
      toast.success('Deduction recorded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record deduction')
    }
  }

  async function handleRemoveDeduction(deductionId: string) {
    try {
      await removePayrollDeduction(deductionId)
      if (selected) await selectPeriod(selected)
      toast.success('Removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove deduction')
    }
  }

  async function handleDownloadPdf(entry: Entry) {
    if (!settings || !selected) return
    try {
      const days = Math.round((new Date(selected.end_date).getTime() - new Date(selected.start_date).getTime()) / 86_400_000) + 1
      const blob = await pdf(
        <PayslipPdfDocument
          businessName={settings.business_name}
          logoUrl={settings.logo_url}
          address={settings.address}
          employeeName={entry.employeeName}
          periodLabel={`${selected.start_date} - ${selected.end_date}`}
          daysInPeriod={days}
          dateLabel={new Date().toLocaleDateString()}
          basePay={entry.base_pay}
          commissionTotal={entry.commission_total}
          tips={entry.tips}
          bonus={entry.bonus}
          cashAdvanceTotal={entry.cash_advance}
          otherDeductionsTotal={entry.deductions}
          withholdingTax={entry.withholding_tax}
          sssContribution={entry.sss_contribution}
          philhealthContribution={entry.philhealth_contribution}
          pagibigContribution={entry.pagibig_contribution}
          sssLoan={entry.sss_loan}
          hdmfLoan={entry.hdmf_loan}
          netPay={entry.net_pay}
          commissionJobs={(jobBreakdownByEntry[entry.id] ?? []).map((j) => ({
            jobNumber: j.jobNumber,
            plateNumber: j.plateNumber,
            date: new Date(j.date).toLocaleDateString(),
            serviceName: j.serviceName,
            rate: j.rate,
            grossAmount: j.grossAmount,
            commissionAmount: j.commissionAmount,
          }))}
        />,
      ).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Payslip - ${entry.employeeName} - ${selected.start_date} to ${selected.end_date}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate PDF')
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
    <>
      <div className="grid grid-cols-1 gap-6 print:hidden lg:grid-cols-[300px_1fr]">
        <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Generate period</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Select value={periodType} onValueChange={handlePeriodTypeChange}>
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
              <Input type="date" className="w-40" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>End date</Label>
              <Input type="date" className="w-40" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
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
              <div key={p.id} className="flex items-center gap-1">
                <button
                  className="flex flex-1 items-center justify-between rounded-md border p-2 text-left text-sm hover:bg-accent"
                  onClick={() => selectPeriod(p)}
                >
                  <span>
                    {p.start_date} → {p.end_date}
                  </span>
                  <Badge variant={p.status === 'paid' ? 'outline' : p.status === 'locked' ? 'secondary' : 'default'}>
                    {p.status}
                  </Badge>
                </button>
                {p.status === 'draft' && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Delete period"
                    onClick={() => setDeleteTarget(p)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            {periods.length === 0 && !loading && <p className="text-muted-foreground">No periods yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cash advances</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Select value={newAdvance.employeeId} onValueChange={(v) => setNewAdvance((prev) => ({ ...prev, employeeId: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              step="0.01"
              placeholder="Amount"
              value={newAdvance.amount}
              onChange={(e) => setNewAdvance((prev) => ({ ...prev, amount: e.target.value }))}
            />
            <Input type="date" className="w-40" value={newAdvance.date} onChange={(e) => setNewAdvance((prev) => ({ ...prev, date: e.target.value }))} />
            <Input
              placeholder="Reason (optional)"
              value={newAdvance.reason}
              onChange={(e) => setNewAdvance((prev) => ({ ...prev, reason: e.target.value }))}
            />
            <Button disabled={creatingAdvance} onClick={handleCreateAdvance}>
              Record advance
            </Button>

            {outstandingAdvances.length > 0 && (
              <div className="mt-2 flex flex-col gap-2 border-t pt-3">
                <div className="text-sm font-medium">Outstanding</div>
                {outstandingAdvances.map((a) => (
                  <div key={a.id} className="flex flex-col text-sm">
                    <div className="flex justify-between">
                      <span>{a.employeeName}</span>
                      <span className="font-medium">{formatMoney(a.remaining_balance)}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {a.advance_date} · of {formatMoney(a.amount)}
                      {a.reason ? ` · ${a.reason}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
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
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">{entry.employeeName}</CardTitle>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setPrintingEntryId(entry.id)}>
                      Print payslip (receipt)
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleDownloadPdf(entry)}>
                      Download PDF payslip
                    </Button>
                  </div>
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
                        <TableCell>{formatMoney(entry.cash_advance)}</TableCell>
                        <TableCell>{formatMoney(entry.deductions)}</TableCell>
                        <TableCell className="font-semibold">{formatMoney(entry.net_pay)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>

                  <div className="flex flex-col gap-2 border-t pt-3">
                    <div className="text-sm font-medium">Commission breakdown</div>
                    {(jobBreakdownByEntry[entry.id] ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">No commission jobs in this period.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Job #</TableHead>
                            <TableHead>Plate</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Service</TableHead>
                            <TableHead>Rate</TableHead>
                            <TableHead className="text-right">Job total</TableHead>
                            <TableHead className="text-right">Commission</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(jobBreakdownByEntry[entry.id] ?? []).map((j, i) => (
                            <TableRow key={`${j.jobId}-${i}`}>
                              <TableCell>{j.jobNumber}</TableCell>
                              <TableCell>{j.plateNumber ?? '—'}</TableCell>
                              <TableCell>{new Date(j.date).toLocaleDateString()}</TableCell>
                              <TableCell>{j.serviceName ?? 'Whole job'}</TableCell>
                              <TableCell>{j.rate}%</TableCell>
                              <TableCell className="text-right">{formatMoney(j.grossAmount)}</TableCell>
                              <TableCell className="text-right">{formatMoney(j.commissionAmount)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 border-t pt-3">
                    <div className="text-sm font-medium">Cash advance deductions</div>
                    {(repaymentsByEntry[entry.id] ?? []).map((r) => (
                      <div key={r.id} className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>Advance from {advancesById[r.cash_advance_id]?.advance_date ?? '—'}</span>
                        <span className="flex items-center gap-2">
                          {formatMoney(r.amount)}
                          {selected.status === 'draft' && (
                            <Button size="sm" variant="ghost" onClick={() => handleUndoRepayment(r.id)}>
                              Undo
                            </Button>
                          )}
                        </span>
                      </div>
                    ))}
                    {selected.status === 'draft' &&
                      outstandingAdvances
                        .filter((a) => a.employee_id === entry.employee_id)
                        .map((a) => {
                          const key = `${entry.id}:${a.id}`
                          return (
                            <div key={a.id} className="flex items-center gap-2">
                              <span className="flex-1 text-sm">
                                {a.advance_date} — {formatMoney(a.remaining_balance)} remaining
                                {a.reason ? ` (${a.reason})` : ''}
                              </span>
                              <Input
                                type="number"
                                step="0.01"
                                placeholder="Amount"
                                className="w-24"
                                value={repayDrafts[key] ?? ''}
                                onChange={(e) => setRepayDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                              />
                              <Button size="sm" variant="secondary" onClick={() => handleDeductAdvance(entry.id, a.id)}>
                                Deduct
                              </Button>
                            </div>
                          )
                        })}
                    {(repaymentsByEntry[entry.id] ?? []).length === 0 &&
                      outstandingAdvances.filter((a) => a.employee_id === entry.employee_id).length === 0 && (
                        <p className="text-sm text-muted-foreground">No cash advances for this employee.</p>
                      )}
                  </div>

                  <div className="flex flex-col gap-2 border-t pt-3">
                    <div className="text-sm font-medium">Deductions (e.g. backjobs, uniforms, damages)</div>
                    {(deductionsByEntry[entry.id] ?? []).map((d) => (
                      <div key={d.id} className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>{d.reason}</span>
                        <span className="flex items-center gap-2">
                          {formatMoney(d.amount)}
                          {selected.status === 'draft' && (
                            <Button size="sm" variant="ghost" onClick={() => handleRemoveDeduction(d.id)}>
                              Remove
                            </Button>
                          )}
                        </span>
                      </div>
                    ))}
                    {selected.status === 'draft' && (
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="Amount"
                          className="w-32"
                          value={deductionDrafts[entry.id]?.amount ?? ''}
                          onChange={(e) =>
                            setDeductionDrafts((prev) => ({ ...prev, [entry.id]: { amount: e.target.value, reason: prev[entry.id]?.reason ?? '' } }))
                          }
                        />
                        <Input
                          placeholder="Reason (e.g. Backjob - Toyota Vios)"
                          value={deductionDrafts[entry.id]?.reason ?? ''}
                          onChange={(e) =>
                            setDeductionDrafts((prev) => ({ ...prev, [entry.id]: { amount: prev[entry.id]?.amount ?? '', reason: e.target.value } }))
                          }
                        />
                        <Button size="sm" variant="secondary" onClick={() => handleAddDeduction(entry.id)}>
                          Add
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 border-t pt-3">
                    <div className="text-sm font-medium">Statutory deductions (for the formal PDF payslip)</div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {(
                        [
                          ['withholding_tax', 'Withholding tax'],
                          ['sss_contribution', 'SSS'],
                          ['philhealth_contribution', 'Philhealth'],
                          ['pagibig_contribution', 'Pag-ibig'],
                          ['sss_loan', 'SSS loan'],
                          ['hdmf_loan', 'HDMF loan'],
                        ] as const
                      ).map(([field, label]) => (
                        <div key={field} className="flex flex-col gap-1">
                          <Label className="text-xs">{label}</Label>
                          <Input
                            type="number"
                            step="0.01"
                            disabled={selected.status !== 'draft'}
                            value={entry[field]}
                            onChange={(e) => handleEntryChange(entry.id, field, e.target.value)}
                            onBlur={() => saveEntry(entry)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

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

      {settings &&
        selected &&
        entries.map((entry) => (
          <div key={entry.id} className={printingEntryId === entry.id ? 'hidden print:block' : 'hidden'}>
            <Payslip
              businessName={settings.business_name}
              logoUrl={settings.logo_url}
              address={settings.address}
              paperWidth={(settings.receipt_paper_width as '58mm' | '80mm') || '58mm'}
              employeeName={entry.employeeName}
              periodLabel={`${selected.start_date} to ${selected.end_date}`}
              isDraft={selected.status === 'draft'}
              basePay={entry.base_pay}
              commissionTotal={entry.commission_total}
              tips={entry.tips}
              bonus={entry.bonus}
              cashAdvanceItems={(repaymentsByEntry[entry.id] ?? []).map((r) => ({
                label: `Cash advance (${advancesById[r.cash_advance_id]?.advance_date ?? '—'})`,
                amount: r.amount,
              }))}
              deductionItems={(deductionsByEntry[entry.id] ?? []).map((d) => ({ reason: d.reason, amount: d.amount }))}
              adjustments={(adjustmentsByEntry[entry.id] ?? []).map((a) => ({ reason: a.reason, amount: a.amount }))}
              netPay={entry.net_pay}
            />
          </div>
        ))}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete payroll period?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteTarget && `${deleteTarget.start_date} → ${deleteTarget.end_date}`} — this permanently removes its generated
            entries and releases any claimed commission back to be picked up by the next period generated. This can't be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deletingPeriod} onClick={handleDeletePeriod}>
              Delete period
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
