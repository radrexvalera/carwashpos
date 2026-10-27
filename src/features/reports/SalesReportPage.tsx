import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { DateRangePresets } from '@/components/DateRangePresets'
import { formatMoney } from '@/lib/money'
import { localDateString } from '@/lib/date'
import { getCashAdvancesSummary, getExpensesByCategory, getSalesReport } from './api/reportsApi'

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

export function SalesReportPage() {
  const [from, setFrom] = useState(localDateString())
  const [to, setTo] = useState(localDateString())
  const [sales, setSales] = useState<Awaited<ReturnType<typeof getSalesReport>> | null>(null)
  const [expenses, setExpenses] = useState<Awaited<ReturnType<typeof getExpensesByCategory>> | null>(null)
  const [cashAdvances, setCashAdvances] = useState<Awaited<ReturnType<typeof getCashAdvancesSummary>> | null>(null)
  const [loading, setLoading] = useState(true)

  async function load(f: string = from, t: string = to) {
    setLoading(true)
    try {
      const fromIso = new Date(`${f}T00:00:00`).toISOString()
      const toIso = new Date(`${t}T23:59:59`).toISOString()
      const [salesData, expensesData, cashAdvancesData] = await Promise.all([
        getSalesReport(fromIso, toIso),
        getExpensesByCategory(f, t),
        getCashAdvancesSummary(f, t),
      ])
      setSales(salesData)
      setExpenses(expensesData)
      setCashAdvances(cashAdvancesData)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handlePreset(range: { from: string; to: string }) {
    setFrom(range.from)
    setTo(range.to)
    load(range.from, range.to)
  }

  // grossSales is already net of the card processing fee, so it's not subtracted again here.
  // Commission isn't subtracted separately either -- once a payroll period is marked paid, it's
  // recorded as a real expense (category: Commission Payouts), already counted in expenses.total.
  const net = sales && expenses ? sales.grossSales - expenses.total : 0

  function csvCell(value: string | number) {
    const str = String(value)
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }

  function exportCsv() {
    if (!sales || !expenses || !cashAdvances) return
    const rows: string[][] = [
      ['Sales Report', `${from} to ${to}`],
      [],
      ['Summary'],
      ['Metric', 'Value'],
      ['Gross sales', sales.grossSales.toFixed(2)],
      ['Sale count', String(sales.saleCount)],
      ['Voided sales', String(sales.voidedCount)],
      ['Expenses', expenses.total.toFixed(2)],
      ['Card processing fees', sales.cardProcessingFeeTotal.toFixed(2)],
      ['Net', net.toFixed(2)],
      ['Discounts given', sales.discountTotal.toFixed(2)],
      ['Promotions given', sales.promotionDiscountTotal.toFixed(2)],
      ['Cash advances given', cashAdvances.total.toFixed(2)],
      [],
      ['Revenue by payment method'],
      ['Method', 'Total'],
      ...sales.byMethod.map((m) => [METHOD_LABELS[m.method] ?? m.method, m.total.toFixed(2)]),
      ['Service revenue', sales.serviceRevenue.toFixed(2)],
      ['Product revenue', sales.productRevenue.toFixed(2)],
      [],
      ['Services'],
      ['Service', 'Count', 'Total'],
      ...sales.services.map((s) => [s.name, String(s.count), s.total.toFixed(2)]),
      [],
      ['Expenses by category'],
      ['Category', 'Total'],
      ...expenses.byCategory.map((c) => [c.name, c.total.toFixed(2)]),
      [],
      ['Cash advances by employee'],
      ['Employee', 'Total'],
      ...cashAdvances.byEmployee.map((e) => [e.name, e.total.toFixed(2)]),
    ]
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Sales Report ${from} to ${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Sales Report</h1>
        <p className="text-muted-foreground">Revenue, payment mix, and services for the selected period.</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <DateRangePresets onSelect={handlePreset} />
          <div className="flex flex-col gap-1.5">
            <Label>From</Label>
            <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>To</Label>
            <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button variant="outline" onClick={() => load()} disabled={loading}>
            Refresh
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={loading || !sales}>
            Export CSV
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : sales && expenses && cashAdvances ? (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Gross sales</div>
                <div className="text-xl font-semibold">{formatMoney(sales.grossSales)}</div>
                <div className="text-xs text-muted-foreground">{sales.saleCount} sale{sales.saleCount === 1 ? '' : 's'}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Expenses</div>
                <div className="text-xl font-semibold">{formatMoney(expenses.total)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Net</div>
                <div className="text-xl font-semibold">{formatMoney(net)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Discounts given</div>
                <div className="text-xl font-semibold">{formatMoney(sales.discountTotal)}</div>
                {sales.voidedCount > 0 && (
                  <div className="text-xs text-muted-foreground">{sales.voidedCount} voided sale{sales.voidedCount === 1 ? '' : 's'}</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Promotions given</div>
                <div className="text-xl font-semibold">{formatMoney(sales.promotionDiscountTotal)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Cash advances given</div>
                <div className="text-xl font-semibold">{formatMoney(cashAdvances.total)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Card processing fees</div>
                <div className="text-xl font-semibold">{formatMoney(sales.cardProcessingFeeTotal)}</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Revenue by payment method</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {sales.byMethod.length === 0 && <p className="text-sm text-muted-foreground">No sales in this period.</p>}
                {sales.byMethod.map((m) => (
                  <div key={m.method} className="flex justify-between text-sm">
                    <span>{METHOD_LABELS[m.method] ?? m.method}</span>
                    <span className="font-medium">{formatMoney(m.total)}</span>
                  </div>
                ))}
                <Separator className="my-1" />
                <div className="flex justify-between text-sm">
                  <span>Service revenue</span>
                  <span>{formatMoney(sales.serviceRevenue)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Product revenue</span>
                  <span>{formatMoney(sales.productRevenue)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Services</CardTitle>
              </CardHeader>
              <CardContent className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                {sales.services.length === 0 && <p className="text-sm text-muted-foreground">No services sold in this period.</p>}
                {sales.services.map((s) => (
                  <div key={s.name} className="flex justify-between text-sm">
                    <span>
                      {s.name} · {s.count}×
                    </span>
                    <span className="font-medium">{formatMoney(s.total)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Expenses by category</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {expenses.byCategory.length === 0 && <p className="text-sm text-muted-foreground">No expenses in this period.</p>}
                {expenses.byCategory.map((c) => (
                  <div key={c.name} className="flex justify-between text-sm">
                    <span>{c.name}</span>
                    <span className="font-medium">{formatMoney(c.total)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cash advances by employee</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {cashAdvances.byEmployee.length === 0 && <p className="text-sm text-muted-foreground">No cash advances in this period.</p>}
                {cashAdvances.byEmployee.map((e) => (
                  <div key={e.name} className="flex justify-between text-sm">
                    <span>{e.name}</span>
                    <span className="font-medium">{formatMoney(e.total)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  )
}
