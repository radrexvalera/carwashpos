import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DateRangePresets } from '@/components/DateRangePresets'
import { formatMoney } from '@/lib/money'
import { localDateString } from '@/lib/date'
import { useTenant } from '@/app/TenantProvider'
import { getDashboardSummary } from '@/features/reports/api/reportsApi'

const JOB_STATUS_LABELS: Record<string, string> = {
  waiting: 'Waiting',
  ongoing: 'On Going',
  ready_for_release: 'Ready for Release',
}

export function DashboardPage() {
  const { profile } = useTenant()
  const [from, setFrom] = useState(localDateString())
  const [to, setTo] = useState(localDateString())
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getDashboardSummary>> | null>(null)
  const [loading, setLoading] = useState(true)
  const canViewFinancials = profile?.role === 'admin' || profile?.role === 'manager'

  function load(f: string = from, t: string = to) {
    setLoading(true)
    getDashboardSummary(f, t)
      .then(setSummary)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load dashboard'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!canViewFinancials) {
      setLoading(false)
      return
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewFinancials])

  function handlePreset(range: { from: string; to: string }) {
    setFrom(range.from)
    setTo(range.to)
    load(range.from, range.to)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome{profile ? `, ${profile.fullName}` : ''}</h1>
        <p className="mt-2 text-muted-foreground">Snapshot across sales, jobs, and stock.</p>
      </div>

      {!canViewFinancials ? (
        <p className="text-muted-foreground">
          Head to <Link className="underline" to="/register">Register</Link> to start a job, or{' '}
          <Link className="underline" to="/jobs">Job Queue</Link> to see what's on the floor.
        </p>
      ) : (
        <>
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
            </CardContent>
          </Card>

          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : summary ? (
            <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Sales</div>
                <div className="text-xl font-semibold">{formatMoney(summary.sales)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Expenses</div>
                <div className="text-xl font-semibold">{formatMoney(summary.expenses)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Net</div>
                <div className="text-xl font-semibold">{formatMoney(summary.net)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Pending commission</div>
                <div className="text-xl font-semibold">{formatMoney(summary.pendingCommission)}</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Jobs on the floor</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <div className="flex justify-between text-sm">
                  <span>Active jobs</span>
                  <span className="font-medium">{summary.activeJobsCount}</span>
                </div>
                {Object.entries(summary.jobStatusCounts).map(([status, count]) => (
                  <div key={status} className="flex justify-between text-sm text-muted-foreground">
                    <span>{JOB_STATUS_LABELS[status] ?? status}</span>
                    <span>{count}</span>
                  </div>
                ))}
                {summary.activeJobsCount === 0 && (
                  <p className="text-sm text-muted-foreground">Nothing on the floor right now.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Completed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-semibold">{summary.completedCount}</div>
                <p className="text-sm text-muted-foreground">jobs picked up in this period</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Inventory</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-semibold">{summary.lowStockCount}</div>
                <p className="text-sm text-muted-foreground">
                  item{summary.lowStockCount === 1 ? '' : 's'} at or below reorder level
                </p>
                {summary.lowStockCount > 0 && (
                  <Link className="mt-2 inline-block text-sm underline" to="/inventory">
                    Review stock
                  </Link>
                )}
              </CardContent>
            </Card>
          </div>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}
