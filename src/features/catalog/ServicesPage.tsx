import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { createService, listServiceCategories, listServices, setServiceActive, type Service, type ServiceCategory } from './api/catalogApi'

export function ServicesPage() {
  const { profile } = useTenant()
  const [services, setServices] = useState<Service[]>([])
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [duration, setDuration] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      const [servicesData, categoriesData] = await Promise.all([listServices(), listServiceCategories()])
      setServices(servicesData)
      setCategories(categoriesData)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load services')
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
      toast.error(err instanceof Error ? err.message : 'Failed to create service')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(row: Service) {
    try {
      await setServiceActive(row.id, !row.is_active)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update service')
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

      <Card>
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
                <TableHead>Duration</TableHead>
                <TableHead className="text-right">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{categoryName(row.category_id)}</TableCell>
                  <TableCell>{row.default_duration_minutes ? `${row.default_duration_minutes} min` : '—'}</TableCell>
                  <TableCell className="text-right">
                    <Switch checked={row.is_active} onCheckedChange={() => toggleActive(row)} />
                  </TableCell>
                </TableRow>
              ))}
              {!loading && services.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No services yet.
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
