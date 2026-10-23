import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { listEmployees } from '@/features/employees/api/employeesApi'
import { formatMoney } from '@/lib/money'
import { getJobCrew, recomputeJobCommission, setJobServiceCrew, type JobCrewLine } from './api/jobCrewApi'

interface EditCrewDialogProps {
  jobId: string | null
  tenantId: string
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export function EditCrewDialog({ jobId, tenantId, onOpenChange, onSaved }: EditCrewDialogProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lines, setLines] = useState<JobCrewLine[]>([])
  const [employees, setEmployees] = useState<{ id: string; full_name: string; nickname: string | null }[]>([])

  useEffect(() => {
    if (!jobId) return
    setLoading(true)
    Promise.all([getJobCrew(jobId), listEmployees()])
      .then(([crewLines, employeeRows]) => {
        setLines(crewLines)
        setEmployees(employeeRows.filter((e) => e.active).map((e) => ({ id: e.id, full_name: e.full_name, nickname: e.nickname })))
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load crew'))
      .finally(() => setLoading(false))
  }, [jobId])

  function toggleAttendant(lineIndex: number, employeeId: string) {
    setLines((prev) =>
      prev.map((line, i) =>
        i !== lineIndex
          ? line
          : {
              ...line,
              attendantEmployeeIds: line.attendantEmployeeIds.includes(employeeId)
                ? line.attendantEmployeeIds.filter((id) => id !== employeeId)
                : [...line.attendantEmployeeIds, employeeId],
            },
      ),
    )
  }

  function assignAllTo(employeeId: string) {
    setLines((prev) =>
      prev.map((line) => (line.attendantEmployeeIds.includes(employeeId) ? line : { ...line, attendantEmployeeIds: [...line.attendantEmployeeIds, employeeId] })),
    )
  }

  async function handleSave() {
    if (!jobId) return
    setSaving(true)
    try {
      for (const line of lines) {
        await setJobServiceCrew(tenantId, line.jobServiceId, line.attendantEmployeeIds)
      }
      const result = await recomputeJobCommission(jobId)
      onSaved()
      toast.success(
        result.entries_written > 0
          ? `Crew updated. Commission recomputed at ${result.rate}% (${formatMoney(result.pool)} split ${result.crew_count} way${result.crew_count === 1 ? '' : 's'}).`
          : 'Crew updated. No commission change needed.',
      )
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update crew')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!jobId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit crew</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Changes here recompute this job's commission immediately, even though the job is already completed.
            </p>
            {lines.map((line, i) => (
              <div key={line.jobServiceId} className="flex flex-col gap-2 rounded-md border p-3">
                <span className="font-medium">{line.serviceName}</span>
                <div className="flex flex-wrap items-center gap-1">
                  {employees.length === 0 && <span className="text-xs text-muted-foreground">No active employees.</span>}
                  {employees.map((e) => (
                    <Badge
                      key={e.id}
                      variant={line.attendantEmployeeIds.includes(e.id) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => toggleAttendant(i, e.id)}
                    >
                      {e.nickname || e.full_name}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
            {lines.length > 1 && employees.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 border-t pt-2">
                <span className="text-xs text-muted-foreground">Assign to all lines:</span>
                {employees.map((e) => (
                  <Badge key={e.id} variant="secondary" className="cursor-pointer" onClick={() => assignAllTo(e.id)}>
                    + {e.nickname || e.full_name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={loading || saving} onClick={handleSave}>
            Save crew
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
