import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  createVehicleSizeClass,
  listVehicleSizeClasses,
  setVehicleSizeClassActive,
  type VehicleSizeClass,
} from './api/catalogApi'

export function VehicleSizeClassesPage() {
  const { profile } = useTenant()
  const [classes, setClasses] = useState<VehicleSizeClass[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [sortOrder, setSortOrder] = useState('0')
  const [submitting, setSubmitting] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      setClasses(await listVehicleSizeClasses())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load vehicle size classes')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!profile || !name.trim()) return
    setSubmitting(true)
    try {
      await createVehicleSizeClass({
        tenantId: profile.tenantId,
        name: name.trim(),
        sortOrder: Number(sortOrder) || 0,
      })
      setName('')
      setSortOrder('0')
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create vehicle size class')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(row: VehicleSizeClass) {
    try {
      await setVehicleSizeClassActive(row.id, !row.is_active)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update vehicle size class')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Vehicle Sizes</h1>
        <p className="text-muted-foreground">
          Used to price services (e.g. Sedan / SUV / Van-Pickup). Deactivate instead of deleting once
          pricing history references a size class.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a size class</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sedan" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sort-order">Sort order</Label>
              <Input
                id="sort-order"
                type="number"
                className="w-24"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
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
                <TableHead>Sort order</TableHead>
                <TableHead className="text-right">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {classes.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.sort_order}</TableCell>
                  <TableCell className="text-right">
                    <Switch checked={row.is_active} onCheckedChange={() => toggleActive(row)} />
                  </TableCell>
                </TableRow>
              ))}
              {!loading && classes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No vehicle size classes yet.
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
