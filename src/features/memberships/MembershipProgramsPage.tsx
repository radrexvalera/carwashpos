import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { listServices } from '@/features/catalog/api/catalogApi'
import {
  createMembershipProgram,
  listMembershipPrograms,
  listProgramServiceIds,
  setMembershipProgramActive,
  updateMembershipProgram,
  type MembershipProgram,
} from './api/membershipsApi'

type Service = { id: string; name: string }

const emptyForm = {
  name: '',
  description: '',
  stampsRequired: '10',
  serviceIds: [] as string[],
}

export function MembershipProgramsPage() {
  const { profile } = useTenant()
  const [programs, setPrograms] = useState<MembershipProgram[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)

  async function reload() {
    setLoading(true)
    try {
      const [programData, serviceData] = await Promise.all([listMembershipPrograms(), listServices()])
      setPrograms(programData)
      setServices((serviceData ?? []).filter((s) => s.is_active).map((s) => ({ id: s.id, name: s.name })))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load membership programs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm)
    setOpen(true)
  }

  async function openEdit(program: MembershipProgram) {
    setEditingId(program.id)
    const serviceIds = await listProgramServiceIds(program.id).catch(() => [])
    setForm({
      name: program.name,
      description: program.description ?? '',
      stampsRequired: String(program.stamps_required),
      serviceIds,
    })
    setOpen(true)
  }

  function toggleService(id: string) {
    setForm((prev) => ({
      ...prev,
      serviceIds: prev.serviceIds.includes(id) ? prev.serviceIds.filter((s) => s !== id) : [...prev.serviceIds, id],
    }))
  }

  async function handleSubmit() {
    if (!profile || !form.name.trim() || !form.stampsRequired || form.serviceIds.length === 0) return
    setSubmitting(true)
    try {
      const input = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        stampsRequired: Number(form.stampsRequired),
        serviceIds: form.serviceIds,
      }
      if (editingId) {
        await updateMembershipProgram(editingId, input)
      } else {
        await createMembershipProgram({ tenantId: profile.tenantId, ...input })
      }
      toast.success(editingId ? 'Program updated' : 'Program created')
      setOpen(false)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save program')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(program: MembershipProgram) {
    try {
      await setMembershipProgramActive(program.id, !program.is_active)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update program')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Membership Programs</h1>
          <p className="text-muted-foreground">Stamp cards — buy N of a service, the next one's free.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>New program</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit program' : 'New membership program'}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Wash Club" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Description (optional)</Label>
                <Input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Stamps required for a free service</Label>
                <Input
                  type="number"
                  min="2"
                  className="w-32"
                  value={form.stampsRequired}
                  onChange={(e) => setForm((p) => ({ ...p, stampsRequired: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Eligible services (required — a stamp is earned per visit for these, and the reward applies to them)</Label>
                <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-md border p-2">
                  {services.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={form.serviceIds.includes(s.id)} onCheckedChange={() => toggleService(s.id)} />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>
              <Button
                onClick={handleSubmit}
                disabled={submitting || !form.name.trim() || !form.stampsRequired || form.serviceIds.length === 0}
              >
                {editingId ? 'Save changes' : 'Create program'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All programs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Stamps required</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {programs.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    {p.name}
                    {p.description && <div className="text-xs text-muted-foreground">{p.description}</div>}
                  </TableCell>
                  <TableCell>{p.stamps_required}</TableCell>
                  <TableCell className="text-right">
                    <Switch checked={p.is_active} onCheckedChange={() => toggleActive(p)} />
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && programs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No membership programs yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
