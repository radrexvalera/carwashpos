import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DateRangePresets } from '@/components/DateRangePresets'
import { formatMoney } from '@/lib/money'
import { getDateRangeForPreset } from '@/lib/date'
import { getCustomerInsights, type CustomerStat } from './api/customerInsightsApi'

const LAPSE_OPTIONS = [30, 60, 90]

function formatPercent(rate: number | null) {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

function CustomerName({ customer }: { customer: CustomerStat }) {
  return (
    <div className="flex flex-col">
      <span className="flex items-center gap-2 font-medium">
        {customer.name}
        {customer.isWalkIn && <Badge variant="outline">Walk-in</Badge>}
      </span>
      {!customer.isWalkIn && customer.plates.length > 0 && (
        <span className="text-xs text-muted-foreground">{customer.plates.join(', ')}</span>
      )}
    </div>
  )
}

export function CustomerInsightsPage() {
  // Retention needs more than a day of history to mean anything, so this defaults to the month
  // rather than "today" like the Sales Report.
  const [from, setFrom] = useState(() => getDateRangeForPreset('thisMonth').from)
  const [to, setTo] = useState(() => getDateRangeForPreset('thisMonth').to)
  const [lapseDays, setLapseDays] = useState(30)
  const [data, setData] = useState<Awaited<ReturnType<typeof getCustomerInsights>> | null>(null)
  const [loading, setLoading] = useState(true)

  async function load(f: string = from, t: string = to, lapse: number = lapseDays) {
    setLoading(true)
    try {
      const fromIso = new Date(`${f}T00:00:00`).toISOString()
      const toIso = new Date(`${t}T23:59:59`).toISOString()
      setData(await getCustomerInsights(fromIso, toIso, lapse))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load customer insights')
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

  function handleLapse(days: number) {
    setLapseDays(days)
    load(from, to, days)
  }

  function csvCell(value: string | number) {
    const str = String(value)
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }

  function exportCsv() {
    if (!data) return
    const rows: string[][] = [
      ['Customer Insights', `${from} to ${to}`],
      [],
      ['Summary'],
      ['Metric', 'Value'],
      ['Customers served', String(data.activeCount)],
      ['New customers', String(data.newCount)],
      ['Returning customers', String(data.returningCount)],
      ['Repeat rate', formatPercent(data.repeatRate)],
      ['Retention from previous period', formatPercent(data.retentionRate)],
      ['Visits', String(data.periodVisits)],
      ['Avg spend per customer', data.avgSpendPerCustomer.toFixed(2)],
      ['Avg days between visits', data.avgDaysBetweenVisits === null ? '' : data.avgDaysBetweenVisits.toFixed(1)],
      [],
      ['Top customers'],
      ['Customer', 'Plates', 'Mobile', 'Visits', 'Spend', 'Last visit'],
      ...data.topCustomers.map((c) => [
        c.name,
        c.plates.join(' / '),
        c.mobile ?? '',
        String(c.visits),
        c.spend.toFixed(2),
        formatDate(c.lastVisit),
      ]),
      [],
      [`Regulars not seen in ${lapseDays}+ days`],
      ['Customer', 'Plates', 'Mobile', 'Lifetime visits', 'Lifetime spend', 'Last visit', 'Days since'],
      ...data.lapsed.map((c) => [
        c.name,
        c.plates.join(' / '),
        c.mobile ?? '',
        String(c.lifetimeVisits),
        c.lifetimeSpend.toFixed(2),
        formatDate(c.lastVisit),
        String(c.daysSinceLastVisit),
      ]),
    ]
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Customer Insights ${from} to ${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const maxFrequency = data ? Math.max(1, ...data.frequency.map((f) => f.count)) : 1

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Customer Insights</h1>
        <p className="text-muted-foreground">Who keeps coming back, who spends the most, and which regulars have gone quiet.</p>
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
          <Button variant="outline" onClick={exportCsv} disabled={loading || !data}>
            Export CSV
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Customers served</div>
                <div className="text-xl font-semibold">{data.activeCount}</div>
                <div className="text-xs text-muted-foreground">
                  {data.periodVisits} visit{data.periodVisits === 1 ? '' : 's'}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">New vs returning</div>
                <div className="text-xl font-semibold">
                  {data.newCount} / {data.returningCount}
                </div>
                <div className="text-xs text-muted-foreground">first visit in this period / came before</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Retention</div>
                <div className="text-xl font-semibold">{formatPercent(data.retentionRate)}</div>
                <div className="text-xs text-muted-foreground">
                  {data.retainedCount} of {data.prevPeriodCount} from the previous period came back
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Repeat rate</div>
                <div className="text-xl font-semibold">{formatPercent(data.repeatRate)}</div>
                <div className="text-xs text-muted-foreground">visited 2+ times in this period</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Avg spend per customer</div>
                <div className="text-xl font-semibold">{formatMoney(data.avgSpendPerCustomer)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Regulars come back every</div>
                <div className="text-xl font-semibold">
                  {data.avgDaysBetweenVisits === null ? '—' : `${Math.round(data.avgDaysBetweenVisits)} days`}
                </div>
                <div className="text-xs text-muted-foreground">average, all-time</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Visit frequency</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {data.activeCount === 0 && <p className="text-sm text-muted-foreground">No visits in this period.</p>}
              {data.activeCount > 0 &&
                data.frequency.map((f) => (
                  <div key={f.label} className="flex items-center gap-3 text-sm">
                    <span className="w-24 shrink-0">{f.label}</span>
                    <div className="h-3 flex-1 rounded bg-muted">
                      <div className="h-3 rounded bg-primary" style={{ width: `${(f.count / maxFrequency) * 100}%` }} />
                    </div>
                    <span className="w-10 shrink-0 text-right font-medium">{f.count}</span>
                  </div>
                ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top customers</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {data.topCustomers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No customers in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Mobile</TableHead>
                      <TableHead className="text-right">Visits</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                      <TableHead>Last visit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topCustomers.map((c) => (
                      <TableRow key={c.key}>
                        <TableCell>
                          <CustomerName customer={c} />
                        </TableCell>
                        <TableCell>{c.mobile ?? '—'}</TableCell>
                        <TableCell className="text-right">{c.visits}</TableCell>
                        <TableCell className="text-right font-medium">{formatMoney(c.spend)}</TableCell>
                        <TableCell>{formatDate(c.lastVisit)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Regulars who've gone quiet</CardTitle>
                <p className="text-sm text-muted-foreground">
                  2+ lifetime visits, none in the last {lapseDays} days. Worth a text or a promo.
                </p>
              </div>
              <div className="flex gap-1.5">
                {LAPSE_OPTIONS.map((days) => (
                  <Button
                    key={days}
                    size="sm"
                    variant={days === lapseDays ? 'default' : 'outline'}
                    onClick={() => handleLapse(days)}
                  >
                    {days}+ days
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {data.lapsed.length === 0 ? (
                <p className="text-sm text-muted-foreground">No lapsed regulars. Everyone's still coming back.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Mobile</TableHead>
                      <TableHead className="text-right">Lifetime visits</TableHead>
                      <TableHead className="text-right">Lifetime spend</TableHead>
                      <TableHead>Last visit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.lapsed.map((c) => (
                      <TableRow key={c.key}>
                        <TableCell>
                          <CustomerName customer={c} />
                        </TableCell>
                        <TableCell>{c.mobile ?? '—'}</TableCell>
                        <TableCell className="text-right">{c.lifetimeVisits}</TableCell>
                        <TableCell className="text-right font-medium">{formatMoney(c.lifetimeSpend)}</TableCell>
                        <TableCell>
                          {formatDate(c.lastVisit)}
                          <div className="text-xs text-muted-foreground">{c.daysSinceLastVisit} days ago</div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}
