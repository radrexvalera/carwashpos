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
  createServiceCategory,
  listServiceCategories,
  setServiceCategoryActive,
  setServiceCategoryCarwash,
  updateServiceCategorySortOrder,
  type ServiceCategory,
} from './api/catalogApi'

export function ServiceCategoriesPage() {
  const { profile } = useTenant()
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [sortOrder, setSortOrder] = useState('0')
  const [isCarwash, setIsCarwash] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      setCategories(await listServiceCategories())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load service categories')
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
      await createServiceCategory({ tenantId: profile.tenantId, name: name.trim(), sortOrder: Number(sortOrder) || 0, isCarwash })
      setName('')
      setSortOrder('0')
      setIsCarwash(false)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create category')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(row: ServiceCategory) {
    try {
      await setServiceCategoryActive(row.id, !row.is_active)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update category')
    }
  }

  async function toggleCarwash(row: ServiceCategory) {
    try {
      await setServiceCategoryCarwash(row.id, !row.is_carwash)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update category')
    }
  }

  async function moveRow(index: number, direction: -1 | 1) {
    try {
      await moveInSortOrder(categories, index, direction, updateServiceCategorySortOrder)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reorder categories')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Service Categories</h1>
        <p className="text-muted-foreground">
          Group services for the register and reports (e.g. Wash, Detailing, Add-ons). Categories marked "Counts as
          carwash" determine crew commission: a job made only of carwash services earns the carwash rate; a job with
          any other service earns the other rate on its whole total (set both rates on the Commission Rules page).
        </p>
      </div>

      <Card id="tour-add-category">
        <CardHeader>
          <CardTitle>Add a category</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Interior" required />
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
            <div className="flex items-center gap-2 pb-2">
              <Switch id="is-carwash" checked={isCarwash} onCheckedChange={setIsCarwash} />
              <Label htmlFor="is-carwash">Counts as carwash</Label>
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
                <TableHead className="text-right">Counts as carwash</TableHead>
                <TableHead className="text-right">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((row, i) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <ReorderButtons
                      canMoveUp={i > 0}
                      canMoveDown={i < categories.length - 1}
                      onMoveUp={() => moveRow(i, -1)}
                      onMoveDown={() => moveRow(i, 1)}
                    />
                  </TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.sort_order}</TableCell>
                  <TableCell className="text-right">
                    <Switch checked={row.is_carwash} onCheckedChange={() => toggleCarwash(row)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch checked={row.is_active} onCheckedChange={() => toggleActive(row)} />
                  </TableCell>
                </TableRow>
              ))}
              {!loading && categories.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No categories yet.
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
