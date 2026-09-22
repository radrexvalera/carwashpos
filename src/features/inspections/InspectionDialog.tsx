import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  getInspectionForJob,
  getOrCreateInspection,
  updateInspectionNotes,
  uploadInspectionPhoto,
  type InspectionWithPhotos,
} from './api/inspectionsApi'

interface InspectionDialogProps {
  jobId: string
  plateNumber: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function InspectionDialog({ jobId, plateNumber, open, onOpenChange }: InspectionDialogProps) {
  const { profile } = useTenant()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(true)
  const [inspection, setInspection] = useState<InspectionWithPhotos | null>(null)
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    getInspectionForJob(jobId)
      .then((data) => {
        setInspection(data)
        setNotes(data?.notes ?? '')
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load inspection'))
      .finally(() => setLoading(false))
  }, [open, jobId])

  async function ensureInspection() {
    if (!profile) return null
    if (inspection) return inspection.id
    const id = await getOrCreateInspection(profile.tenantId, jobId)
    return id
  }

  async function handleSaveNotes() {
    setSavingNotes(true)
    try {
      const id = await ensureInspection()
      if (!id) return
      await updateInspectionNotes(id, notes.trim())
      toast.success('Notes saved')
      const refreshed = await getInspectionForJob(jobId)
      setInspection(refreshed)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save notes')
    } finally {
      setSavingNotes(false)
    }
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0 || !profile) return
    setUploading(true)
    try {
      const id = await ensureInspection()
      if (!id) return
      for (const file of Array.from(files)) {
        await uploadInspectionPhoto(profile.tenantId, jobId, id, file)
      }
      toast.success(`${files.length} photo${files.length === 1 ? '' : 's'} uploaded`)
      const refreshed = await getInspectionForJob(jobId)
      setInspection(refreshed)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload photo')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Vehicle inspection — {plateNumber}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Document any existing scratches, dents, or damage before work starts.
            </p>

            <div className="flex flex-col gap-1.5">
              <Textarea
                rows={3}
                placeholder="e.g. Scratch on rear bumper, dent on left door…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <Button size="sm" variant="outline" className="w-fit" disabled={savingNotes} onClick={handleSaveNotes}>
                Save notes
              </Button>
            </div>

            {inspection && inspection.photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {inspection.photos.map((p) => (
                  <a key={p.id} href={p.url ?? undefined} target="_blank" rel="noreferrer">
                    {p.url ? (
                      <img src={p.url} alt="Vehicle condition" className="aspect-square w-full rounded-md object-cover" />
                    ) : (
                      <div className="aspect-square w-full rounded-md bg-muted" />
                    )}
                  </a>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />
              <Button disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                {uploading ? 'Uploading…' : 'Add photos'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
