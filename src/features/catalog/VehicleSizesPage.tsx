import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ReorderButtons } from '@/components/ReorderButtons'
import { moveInSortOrder } from '@/lib/sortOrder'
import {
  createVehicleSize,
  listVehicleSizes,
  setVehicleSizeActive,
  updateVehicleSizeSortOrder,
  type VehicleSize,
} from './api/catalogApi'

export function VehicleSizesPage() {
  const { profile } = useTenant()
  const [sizes, setSizes] = useState<VehicleSize[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [sortOrder, setSortOrder] = useState('0')
  const [submitting, setSubmitting] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      setSizes(await listVehicleSizes())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load vehicle sizes')
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
      await createVehicleSize({ tenantId: profile.tenantId, name: name.trim(), sortOrder: Number(sortOrder) || 0 })
      setName('')
      setSortOrder('0')
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create vehicle size')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(row: VehicleSize) {
    try {
      await setVehicleSizeActive(row.id, !row.is_active)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update vehicle size')
    }
  }

  async function moveRow(index: number, direction: -1 | 1) {
    try {
      await moveInSortOrder(sizes, index, direction, updateVehicleSizeSortOrder)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reorder vehicle sizes')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Vehicle Sizes</h1>
        <p className="text-muted-foreground">
          The single pricing ladder used across every service (e.g. Motorcycle / Small / Medium /
          Large / XL / XXL). Deactivate instead of deleting once pricing history references a size.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a size</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Medium" required />
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
                <TableHead />
                <TableHead>Name</TableHead>
                <TableHead>Sort order</TableHead>
                <TableHead className="text-right">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sizes.map((row, i) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <ReorderButtons
                      canMoveUp={i > 0}
                      canMoveDown={i < sizes.length - 1}
                      onMoveUp={() => moveRow(i, -1)}
                      onMoveDown={() => moveRow(i, 1)}
                    />
                  </TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.sort_order}</TableCell>
                  <TableCell className="text-right">
                    <Switch checked={row.is_active} onCheckedChange={() => toggleActive(row)} />
                  </TableCell>
                </TableRow>
              ))}
              {!loading && sizes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No vehicle sizes yet.
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
