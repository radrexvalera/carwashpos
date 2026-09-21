import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoney } from '@/lib/money'
import { getMyCommissionDashboard } from './api/attendantDashboardApi'

type Dashboard = Awaited<ReturnType<typeof getMyCommissionDashboard>>

export function AttendantDashboardPage() {
  const [data, setData] = useState<Dashboard>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getMyCommissionDashboard()
      .then(setData)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load your dashboard'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-muted-foreground">Loading…</p>

  if (!data) {
    return <p className="text-muted-foreground">No employee record is linked to your login yet — ask an admin.</p>
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">My Commission</h1>
        <p className="text-muted-foreground">Today and your recent history. You can't edit these — ask a manager if something looks off.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">Commission earned today</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{formatMoney(data.todayCommission)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">Cars serviced today</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{data.todayCarsCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">Completed services today</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{data.todayServicesCount}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent history</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {data.recent.length === 0 && <p className="text-muted-foreground">Nothing yet.</p>}
          {data.recent.map((e) => (
            <div key={e.id} className="flex items-center justify-between border-b pb-2 text-sm last:border-0">
              <div>
                <div className="font-medium">
                  {e.jobNumber} · {e.serviceName}
                </div>
                <div className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</div>
              </div>
              <div className="text-right">
                <div className="font-medium">{e.points ? `${e.points} pts` : formatMoney(e.commission_amount)}</div>
                <div className="text-xs text-muted-foreground">{e.status}</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
