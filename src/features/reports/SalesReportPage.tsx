import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { formatMoney } from '@/lib/money'
import { getExpensesByCategory, getSalesReport } from './api/reportsApi'

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  gcash: 'GCash',
  maya: 'Maya',
  bank_transfer: 'Bank Transfer',
  card: 'Card',
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

export function SalesReportPage() {
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [sales, setSales] = useState<Awaited<ReturnType<typeof getSalesReport>> | null>(null)
  const [expenses, setExpenses] = useState<Awaited<ReturnType<typeof getExpensesByCategory>> | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const fromIso = new Date(`${from}T00:00:00`).toISOString()
      const toIso = new Date(`${to}T23:59:59`).toISOString()
      const [salesData, expensesData] = await Promise.all([getSalesReport(fromIso, toIso), getExpensesByCategory(from, to)])
      setSales(salesData)
      setExpenses(expensesData)
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

  const net = sales && expenses ? sales.grossSales - expenses.total : 0

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Sales Report</h1>
        <p className="text-muted-foreground">Revenue, payment mix, and services for the selected period.</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="flex flex-col gap-1.5">
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : sales && expenses ? (
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
        </>
      ) : null}
    </div>
  )
}
