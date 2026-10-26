import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { createService, deleteService, listServiceCategories, listServices, setServiceActive, updateService, type Service, type ServiceCategory } from './api/catalogApi'

type PricingType = 'matrix' | 'flat' | 'starting_at' | 'quoted'

// A Postgrest/RPC error IS an Error instance in practice, but this is defensive against anything
// that logs a real .message without being one (e.g. an object that lost its prototype chain
// crossing a serialization boundary) -- better than silently falling back to a useless generic
// string when there's a real, specific message sitting right there.
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  console.error(err)
  return fallback
}

const PRICING_TYPE_LABELS: Record<PricingType, string> = {
  matrix: 'By vehicle size (set under Pricing)',
  flat: 'Flat price',
  starting_at: 'Starting at (flat, shown as "from")',
  quoted: 'Quoted manually at checkout',
}

export function ServicesPage() {
  const { profile } = useTenant()
  const [services, setServices] = useState<Service[]>([])
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [duration, setDuration] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [editingService, setEditingService] = useState<Service | null>(null)
  const [editName, setEditName] = useState('')
  const [editCategoryId, setEditCategoryId] = useState('')
  const [editPricingType, setEditPricingType] = useState<PricingType>('matrix')
  const [editFlatPrice, setEditFlatPrice] = useState('')
  const [editDuration, setEditDuration] = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      const [servicesData, categoriesData] = await Promise.all([listServices(), listServiceCategories()])
      setServices(servicesData)
      setCategories(categoriesData)
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to load services'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? '—'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!profile || !name.trim()) return
    setSubmitting(true)
    try {
      await createService({
        tenantId: profile.tenantId,
        name: name.trim(),
        categoryId: categoryId || null,
        defaultDurationMinutes: duration ? Number(duration) : null,
      })
      setName('')
      setDuration('')
      await reload()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to create service'))
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(row: Service) {
    try {
      await setServiceActive(row.id, !row.is_active)
      await reload()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to update service'))
    }
  }

  async function handleDelete(row: Service) {
    if (!window.confirm(`Delete ${row.name}? This can't be undone.`)) return
    try {
      await deleteService(row.id)
      await reload()
      toast.success('Service deleted')
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to delete service'))
    }
  }

  function openEdit(row: Service) {
    setEditingService(row)
    setEditName(row.name)
    setEditCategoryId(row.category_id ?? '')
    setEditPricingType(row.pricing_type as PricingType)
    setEditFlatPrice(row.flat_price != null ? String(row.flat_price) : '')
    setEditDuration(row.default_duration_minutes != null ? String(row.default_duration_minutes) : '')
  }

  async function handleEditSubmit(event: FormEvent) {
    event.preventDefault()
    if (!editingService || !editName.trim()) return
    setEditSubmitting(true)
    try {
      await updateService(editingService.id, {
        name: editName.trim(),
        categoryId: editCategoryId || null,
        pricingType: editPricingType,
        flatPrice: editPricingType === 'matrix' || editPricingType === 'quoted' ? null : (Number(editFlatPrice) || 0),
        defaultDurationMinutes: editDuration ? Number(editDuration) : null,
      })
      toast.success('Saved')
      setEditingService(null)
      await reload()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save service'))
    } finally {
      setEditSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Services</h1>
        <p className="text-muted-foreground">
          The wash/detailing services you offer. Set per-vehicle-size pricing for each one under
          Pricing. New categories can be added under Service Categories.
        </p>
      </div>

      <Card id="tour-add-service">
        <CardHeader>
          <CardTitle>Add a service</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Full Wash" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category">Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id="category" className="w-48">
                  <SelectValue placeholder="Uncategorized" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="duration">Duration (min)</Label>
              <Input
                id="duration"
                type="number"
                className="w-28"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={submitting}>
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Pricing</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{categoryName(row.category_id)}</TableCell>
                  <TableCell>
                    {row.pricing_type === 'matrix'
                      ? 'By vehicle size'
                      : row.pricing_type === 'quoted'
                        ? 'Quoted'
                        : `₱${row.flat_price ?? 0}${row.pricing_type === 'starting_at' ? ' (from)' : ''}`}
                  </TableCell>
                  <TableCell>{row.default_duration_minutes ? `${row.default_duration_minutes} min` : '—'}</TableCell>
                  <TableCell className="text-right">
                    <Switch checked={row.is_active} onCheckedChange={() => toggleActive(row)} />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(row)}>
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && services.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No services yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!editingService} onOpenChange={(o) => !o && setEditingService(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit service</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-name">Name</Label>
              <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-category">Category</Label>
              <Select value={editCategoryId} onValueChange={setEditCategoryId}>
                <SelectTrigger id="edit-category">
                  <SelectValue placeholder="Uncategorized" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-pricing-type">Pricing</Label>
              <Select value={editPricingType} onValueChange={(v) => setEditPricingType(v as PricingType)}>
                <SelectTrigger id="edit-pricing-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRICING_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(editPricingType === 'flat' || editPricingType === 'starting_at') && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-flat-price">Price (₱)</Label>
                <Input
                  id="edit-flat-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={editFlatPrice}
                  onChange={(e) => setEditFlatPrice(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-duration">Duration (min)</Label>
              <Input id="edit-duration" type="number" value={editDuration} onChange={(e) => setEditDuration(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={editSubmitting}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
