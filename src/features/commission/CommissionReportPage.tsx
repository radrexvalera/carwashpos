import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMoney } from '@/lib/money'
import { localDateString } from '@/lib/date'
import { getCommissionReport } from './api/commissionReportApi'

type Report = Awaited<ReturnType<typeof getCommissionReport>>

export function CommissionReportPage() {
  const [from, setFrom] = useState(localDateString())
  const [to, setTo] = useState(localDateString())
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  async function load() {
    setLoading(true)
    try {
      const fromIso = new Date(`${from}T00:00:00`).toISOString()
      const toIso = new Date(`${to}T23:59:59`).toISOString()
      setReport(await getCommissionReport(fromIso, toIso))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load commission report')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Commission Report</h1>
        <p className="text-muted-foreground">Earned commission by attendant for the selected period.</p>
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
          <button
            className="h-9 rounded-md border px-4 text-sm hover:bg-accent"
            onClick={load}
            disabled={loading}
          >
            Refresh
          </button>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : report ? (
        <>
          <Card>
            <CardContent className="pt-6 text-lg font-semibold">Total: {formatMoney(report.grandTotal)}</CardContent>
          </Card>

          {report.employees.length === 0 && <p className="text-muted-foreground">No commission earned in this period.</p>}

          {report.employees.map((emp) => (
            <Card key={emp.employeeId}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{emp.employeeName}</span>
                  <span>{formatMoney(emp.total)}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                {emp.byRate.map((r) => {
                  const key = `${emp.employeeId}:${r.rate}`
                  const isOpen = expanded.has(key)
                  return (
                    <div key={r.rate} className="flex flex-col">
                      <button
                        type="button"
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                        onClick={() => toggle(key)}
                      >
                        <span>
                          {isOpen ? '▾' : '▸'} {r.rate}% jobs · {r.count} job{r.count === 1 ? '' : 's'}
                        </span>
                        <span className="font-medium">{formatMoney(r.total)}</span>
                      </button>
                      {isOpen && (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Job</TableHead>
                              <TableHead>Plate</TableHead>
                              <TableHead>Date</TableHead>
                              <TableHead className="text-right">Job total</TableHead>
                              <TableHead className="text-right">Commission</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {r.jobs.map((j) => (
                              <TableRow key={j.jobId}>
                                <TableCell>{j.jobNumber}</TableCell>
                                <TableCell>{j.plateNumber ?? '—'}</TableCell>
                                <TableCell>{new Date(j.date).toLocaleDateString()}</TableCell>
                                <TableCell className="text-right">{formatMoney(j.grossAmount)}</TableCell>
                                <TableCell className="text-right">{formatMoney(j.commissionAmount)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  )
                })}
                {emp.byService.map((s, i) => (
                  <div key={i} className="flex justify-between px-2 py-1.5">
                    <span>
                      {s.name} · {s.count} service{s.count === 1 ? '' : 's'}
                    </span>
                    <span>{formatMoney(s.total)}</span>
                  </div>
                ))}
                <Separator className="my-1" />
                <div className="flex justify-between font-medium">
                  <span>Total</span>
                  <span>{formatMoney(emp.total)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </>
      ) : null}
    </div>
  )
}
