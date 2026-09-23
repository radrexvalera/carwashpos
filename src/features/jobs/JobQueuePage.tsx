import { useMemo, useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { db } from '@/lib/db/dexie'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { BoardJob, LocalJob } from '@/lib/offline/types'
import { InspectionDialog } from '@/features/inspections/InspectionDialog'
import { retryFailedJob } from './api/jobMutations'
import { completeJobOffline, updateJobStatus } from './api/jobStatusMutations'
import { useJobBoardSync } from './hooks/useJobBoardSync'

const COLUMNS: { status: BoardJob['status']; label: string; next?: BoardJob['status'] }[] = [
  { status: 'waiting', label: 'Waiting', next: 'ongoing' },
  { status: 'ongoing', label: 'On Going', next: 'ready_for_release' },
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
  // The local outbox -- a job written here immediately on creation, well before (or entirely
  // without) a network round-trip. Merged into the Waiting column below so a job created offline
  // doesn't simply vanish from the board until it syncs.
  const localJobs = useLiveQuery(
    () => db.jobs.where('tenantId').equals(profile?.tenantId ?? '').toArray(),
    [profile?.tenantId],
    [],
  )

  const [inspectingJob, setInspectingJob] = useState<BoardJob | null>(null)

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

  // Not yet reflected in boardJobs -- either still syncing/failed, or the mutation succeeded but
  // the board cache hasn't picked up the real row yet (closes that small timing gap too, so a
  // just-synced job doesn't flicker out of view for a few seconds before its real card appears).
  const pendingLocalJobs = useMemo(() => {
    const syncedIds = new Set((boardJobs ?? []).map((j) => j.clientGeneratedId))
    return (localJobs ?? []).filter((j) => j.syncStatus !== 'synced' || !syncedIds.has(j.clientGeneratedId))
  }, [localJobs, boardJobs])

  async function handleRetry(job: LocalJob) {
    try {
      await retryFailedJob(job.clientGeneratedId)
      toast.success('Retrying sync…')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to retry')
    }
  }

  async function advance(job: BoardJob, nextStatus: BoardJob['status'], bayId?: string) {
    if (!profile) return
    try {
      await updateJobStatus({
        tenantId: profile.tenantId,
        boardJobId: job.id,
        clientGeneratedId: job.clientGeneratedId,
        status: nextStatus as 'waiting' | 'ongoing' | 'ready_for_release' | 'completed',
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
      await completeJobOffline({ tenantId: profile.tenantId, boardJobId: job.id, jobId: job.id })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to complete job')
    }
  }

  function columnCount(col: (typeof COLUMNS)[number]) {
    return (byColumn.get(col.status)?.length ?? 0) + (col.status === 'waiting' ? pendingLocalJobs.length : 0)
  }

  // A bay only ever holds one job at a time in practice (jobs.bay_id is cleared on completion),
  // so the first match per bay is sufficient -- no need to handle multiple.
  const bayOccupancy = useMemo(() => {
    const map = new Map<string, BoardJob>()
    for (const job of boardJobs ?? []) {
      if (job.bayId && !map.has(job.bayId)) map.set(job.bayId, job)
    }
    return map
  }, [boardJobs])

  function renderColumnCards(col: (typeof COLUMNS)[number]) {
    return (
      <div className="flex flex-col gap-2">
        {col.status === 'waiting' &&
          pendingLocalJobs.map((job) => (
                  <Card key={job.clientGeneratedId} className="gap-2 border-dashed py-3">
                    <CardHeader className="gap-1 px-3">
                      <CardTitle className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Pending</span>
                        {job.syncStatus === 'failed' ? (
                          <Badge variant="destructive">Sync failed</Badge>
                        ) : (
                          <Badge variant="secondary">Syncing…</Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-1 px-3 text-xs">
                      <div className="font-medium">
                        {job.vehiclePlate} · {job.vehicleSizeName}
                      </div>
                      <div className="text-muted-foreground">
                        {job.vehicleMake} {job.vehicleModel}
                      </div>
                      <div className="text-muted-foreground">{job.services.map((s) => s.serviceName).join(', ')}</div>
                      <div className="font-medium">{formatMoney(job.estimatedTotal)}</div>
                      <div className="text-muted-foreground">{elapsed(job.createdAt)}</div>
                      {job.syncStatus === 'failed' && (
                        <>
                          {job.syncError && <div className="text-destructive">{job.syncError}</div>}
                          <Button size="sm" variant="outline" onClick={() => handleRetry(job)}>
                            Retry
                          </Button>
                        </>
                      )}
                    </CardContent>
                  </Card>
          ))}
        {(byColumn.get(col.status) ?? []).map((job) => (
                <Card key={job.id} className="gap-2 py-3">
                  <CardHeader className="gap-1 px-3">
                    <CardTitle className="flex items-center justify-between text-xs">
                      <span>#{job.jobNumber.slice(-4)}</span>
                      <Badge variant={job.isPaid ? 'outline' : 'secondary'}>{job.isPaid ? 'Paid' : 'Unpaid'}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1 px-3 text-xs">
                    <div className="font-medium">
                      {job.plateNumber} · {job.vehicleSizeName}
                    </div>
                    <div className="text-muted-foreground">
                      {job.vehicleMake} {job.vehicleModel}
                    </div>
                    <div className="text-muted-foreground">{job.servicesSummary}</div>
                    {job.attendantsSummary && <div className="text-muted-foreground">Crew: {job.attendantsSummary}</div>}
                    {job.bayName && <div className="text-muted-foreground">Bay: {job.bayName}</div>}
                    <div className="font-medium">{formatMoney(job.estimatedTotal)}</div>
                    <div className="text-muted-foreground">{elapsed(job.createdAt)}</div>

                    {col.status === 'waiting' && (
                      <Button size="sm" variant="outline" onClick={() => setInspectingJob(job)}>
                        Inspect
                      </Button>
                    )}
                    {col.status === 'waiting' && (bays ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(bays ?? []).map((b) => (
                          <Button key={b.id} size="sm" variant="outline" onClick={() => advance(job, 'ongoing', b.id)}>
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
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Job Queue</h1>
        <p className="text-muted-foreground">Live shop-floor status. Works offline.</p>
      </div>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="bays">Bays</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="flex flex-col gap-4 pt-2">
          <div className="lg:hidden">
            <Tabs defaultValue={COLUMNS[0].status}>
              <div className="overflow-x-auto">
                <TabsList className="w-max">
                  {COLUMNS.map((col) => (
                    <TabsTrigger key={col.status} value={col.status}>
                      {col.label} ({columnCount(col)})
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              {COLUMNS.map((col) => (
                <TabsContent key={col.status} value={col.status} className="pt-2">
                  {renderColumnCards(col)}
                </TabsContent>
              ))}
            </Tabs>
          </div>

          <div className="hidden gap-4 lg:grid lg:grid-cols-3">
            {COLUMNS.map((col) => (
              <div key={col.status} className="flex flex-col gap-2">
                <div className="text-sm font-semibold text-muted-foreground">
                  {col.label} ({columnCount(col)})
                </div>
                {renderColumnCards(col)}
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="bays" className="pt-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {(bays ?? []).map((bay) => {
              const job = bayOccupancy.get(bay.id)
              return (
                <Card key={bay.id} className={cn('gap-2 py-3', !job && 'border-dashed')}>
                  <CardHeader className="gap-1 px-3">
                    <CardTitle className="flex items-center justify-between text-xs">
                      <span>{bay.name}</span>
                      {job ? (
                        <Badge variant="secondary">{COLUMNS.find((c) => c.status === job.status)?.label ?? job.status}</Badge>
                      ) : (
                        <Badge variant="outline">Vacant</Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  {job && (
                    <CardContent className="flex flex-col gap-1 px-3 text-xs">
                      <div className="font-medium">{job.plateNumber}</div>
                      <div className="text-muted-foreground">{job.servicesSummary}</div>
                      <div className="text-muted-foreground">Crew: {job.attendantsSummary || 'Unassigned'}</div>
                      {job.bayEnteredAt && <div className="text-muted-foreground">{elapsed(job.bayEnteredAt)} in bay</div>}
                    </CardContent>
                  )}
                </Card>
              )
            })}
          </div>
        </TabsContent>
      </Tabs>

      {inspectingJob && (
        <InspectionDialog
          jobId={inspectingJob.id}
          plateNumber={inspectingJob.plateNumber}
          open={!!inspectingJob}
          onOpenChange={(o) => !o && setInspectingJob(null)}
        />
      )}
    </div>
  )
}

function elapsed(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
