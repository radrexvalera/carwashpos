import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { formatMoney } from '@/lib/money'
import { getCommissionReport } from './api/commissionReportApi'

type Report = Awaited<ReturnType<typeof getCommissionReport>>

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}

export function CommissionReportPage() {
  const [from, setFrom] = useState(startOfToday())
  const [to, setTo] = useState(startOfToday())
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)

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
                {[...emp.byService.values()].map((s, i) => (
                  <div key={i} className="flex justify-between">
                    <span>{s.isJobLevel ? s.name : `${s.name} · ${s.count} service${s.count === 1 ? '' : 's'}`}</span>
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
