import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DateRangePresets } from '@/components/DateRangePresets'
import { formatMoney } from '@/lib/money'
import { localDateString } from '@/lib/date'
import { getRepaintSalesReport } from './api/reportsApi'

export function RepaintSalesReportPage() {
  const [from, setFrom] = useState(localDateString())
  const [to, setTo] = useState(localDateString())
  const [report, setReport] = useState<Awaited<ReturnType<typeof getRepaintSalesReport>> | null>(null)
  const [loading, setLoading] = useState(true)

  async function load(f: string = from, t: string = to) {
    setLoading(true)
    try {
      const fromIso = new Date(`${f}T00:00:00`).toISOString()
      const toIso = new Date(`${t}T23:59:59`).toISOString()
      setReport(await getRepaintSalesReport(fromIso, toIso))
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

  function csvCell(value: string | number) {
    const str = String(value)
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }

  function exportCsv() {
    if (!report || !report.categoryFound) return
    const rows: string[][] = [
      ['Repaint Sales Report', `${from} to ${to}`],
      [],
      ['Summary'],
      ['Metric', 'Value'],
      ['Total revenue', report.totalRevenue.toFixed(2)],
      ['Discounts given', report.discountTotal.toFixed(2)],
      ['Line items', String(report.lineCount)],
      ['Jobs', String(report.jobCount)],
      [],
      ['By service'],
      ['Service', 'Count', 'Total'],
      ...report.byService.map((s) => [s.name, String(s.count), s.total.toFixed(2)]),
      [],
      ['Transactions'],
      ['Date', 'Sale #', 'Job #', 'Plate', 'Service', 'Amount', 'Discount'],
      ...report.rows.map((r) => [
        new Date(r.date).toLocaleDateString(),
        r.saleNumber,
        r.jobNumber,
        r.plateNumber,
        r.serviceName,
        r.amount.toFixed(2),
        r.discountAmount.toFixed(2),
      ]),
    ]
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Repaint Sales Report ${from} to ${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Repaint Sales Report</h1>
        <p className="text-muted-foreground">Revenue for the Repaint service category only, for the selected period.</p>
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
          <Button variant="outline" onClick={exportCsv} disabled={loading || !report?.categoryFound}>
            Export CSV
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !report?.categoryFound ? (
        <p className="text-muted-foreground">
          No "Repaint" service category is set up for this tenant yet. Add one on the Service Categories page to use this report.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Total revenue</div>
                <div className="text-xl font-semibold">{formatMoney(report.totalRevenue)}</div>
                <div className="text-xs text-muted-foreground">
                  {report.lineCount} line{report.lineCount === 1 ? '' : 's'} · {report.jobCount} job{report.jobCount === 1 ? '' : 's'}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Discounts given</div>
                <div className="text-xl font-semibold">{formatMoney(report.discountTotal)}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">By service</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {report.byService.length === 0 && <p className="text-sm text-muted-foreground">No repaint sales in this period.</p>}
              {report.byService.map((s) => (
                <div key={s.name} className="flex justify-between text-sm">
                  <span>
                    {s.name} · {s.count}×
                  </span>
                  <span className="font-medium">{formatMoney(s.total)}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Transactions</CardTitle>
            </CardHeader>
            <CardContent>
              {report.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No repaint sales in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Sale #</TableHead>
                      <TableHead>Job #</TableHead>
                      <TableHead>Plate</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Discount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rows.map((r, i) => (
                      <TableRow key={`${r.saleNumber}-${i}`}>
                        <TableCell>{new Date(r.date).toLocaleDateString()}</TableCell>
                        <TableCell>{r.saleNumber}</TableCell>
                        <TableCell>{r.jobNumber}</TableCell>
                        <TableCell>{r.plateNumber}</TableCell>
                        <TableCell>{r.serviceName}</TableCell>
                        <TableCell className="text-right">{formatMoney(r.amount)}</TableCell>
                        <TableCell className="text-right">{r.discountAmount > 0 ? formatMoney(r.discountAmount) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
