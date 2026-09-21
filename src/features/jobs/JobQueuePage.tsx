import { useMemo, useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { db } from '@/lib/db/dexie'
import { formatMoney } from '@/lib/money'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { BoardJob } from '@/lib/offline/types'
import { updateJobStatus } from './api/jobStatusMutations'
import { useJobBoardSync } from './hooks/useJobBoardSync'

const COLUMNS: { status: BoardJob['status']; label: string; next?: BoardJob['status'] }[] = [
  { status: 'waiting', label: 'Waiting', next: 'washing' },
  { status: 'washing', label: 'Washing', next: 'detailing' },
  { status: 'detailing', label: 'Detailing', next: 'quality_check' },
  { status: 'quality_check', label: 'Quality Check', next: 'ready_for_release' },
  { status: 'ready_for_release', label: 'Ready for Release' },
]

export function JobQueuePage() {
  const { profile } = useTenant()
  useJobBoardSync(profile?.tenantId)

  const bays = useLiveQuery(
    () => db.bays.where('tenant_id').equals(profile?.tenantId ?? '').and((b) => b.is_active).sortBy('sort_order'),
    [profile?.tenantId],
    [],
  )
  const boardJobs = useLiveQuery(
    () => db.boardJobs.where('tenantId').equals(profile?.tenantId ?? '').toArray(),
    [profile?.tenantId],
    [],
  )

  const [, tick] = useState(0)
  useEffect(() => {
    const interval = window.setInterval(() => tick((n) => n + 1), 30_000)
    return () => window.clearInterval(interval)
  }, [])

  const byColumn = useMemo(() => {
    const map = new Map<string, BoardJob[]>()
    for (const col of COLUMNS) map.set(col.status, [])
    for (const job of boardJobs ?? []) {
      map.get(job.status)?.push(job)
    }
    for (const jobs of map.values()) jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return map
  }, [boardJobs])

  async function advance(job: BoardJob, nextStatus: BoardJob['status'], bayId?: string) {
    if (!profile) return
    try {
      await updateJobStatus({
        tenantId: profile.tenantId,
        boardJobId: job.id,
        clientGeneratedId: job.clientGeneratedId,
        status: nextStatus as 'waiting' | 'washing' | 'detailing' | 'quality_check' | 'ready_for_release' | 'completed',
        bayId: bayId ?? job.bayId,
        bayEnteredAt: bayId ? new Date().toISOString() : job.bayEnteredAt,
        completedAt: null,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update job')
    }
  }

  async function pickedUp(job: BoardJob) {
    if (!profile) return
    try {
      await updateJobStatus({
        tenantId: profile.tenantId,
        boardJobId: job.id,
        clientGeneratedId: job.clientGeneratedId,
        status: 'completed',
        bayId: null,
        bayEnteredAt: null,
        completedAt: new Date().toISOString(),
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to complete job')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Job Queue</h1>
        <p className="text-muted-foreground">Live shop-floor status. Works offline.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {COLUMNS.map((col) => (
          <div key={col.status} className="flex flex-col gap-2">
            <div className="text-sm font-semibold text-muted-foreground">
              {col.label} ({byColumn.get(col.status)?.length ?? 0})
            </div>
            <div className="flex flex-col gap-2">
              {(byColumn.get(col.status) ?? []).map((job) => (
                <Card key={job.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-sm">
                      <span>#{job.jobNumber.slice(-4)}</span>
                      <Badge variant={job.isPaid ? 'outline' : 'secondary'}>{job.isPaid ? 'Paid' : 'Unpaid'}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm">
                    <div className="font-medium">
                      {job.plateNumber} · {job.vehicleSizeName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {job.vehicleMake} {job.vehicleModel}
                    </div>
                    <div className="text-xs text-muted-foreground">{job.servicesSummary}</div>
                    {job.attendantsSummary && <div className="text-xs text-muted-foreground">Crew: {job.attendantsSummary}</div>}
                    {job.bayName && <div className="text-xs text-muted-foreground">Bay: {job.bayName}</div>}
                    <div className="text-sm font-medium">{formatMoney(job.estimatedTotal)}</div>
                    <div className="text-xs text-muted-foreground">{elapsed(job.createdAt)}</div>

                    {col.status === 'waiting' && (bays ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(bays ?? []).map((b) => (
                          <Button key={b.id} size="sm" variant="outline" onClick={() => advance(job, 'washing', b.id)}>
                            → {b.name}
                          </Button>
                        ))}
                      </div>
                    )}
                    {col.status !== 'waiting' && col.next && (
                      <Button size="sm" onClick={() => advance(job, col.next!)}>
                        Move to {COLUMNS.find((c) => c.status === col.next)?.label}
                      </Button>
                    )}
                    {col.status === 'ready_for_release' && (
                      <Button size="sm" onClick={() => pickedUp(job)}>
                        Picked up
                      </Button>
                    )}
                    {!job.isPaid && (
                      <Link to={`/jobs/${job.id}/pay`}>
                        <Button size="sm" variant="secondary" className="w-full">
                          Collect payment
                        </Button>
                      </Link>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function elapsed(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
