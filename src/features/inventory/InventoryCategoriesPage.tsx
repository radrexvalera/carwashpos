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
  createInventoryCategory,
  listInventoryCategories,
  setInventoryCategoryActive,
  updateInventoryCategorySortOrder,
  type InventoryCategory,
} from './api/inventoryApi'

export function InventoryCategoriesPage() {
  const { profile } = useTenant()
  const [categories, setCategories] = useState<InventoryCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [sortOrder, setSortOrder] = useState('0')
  const [submitting, setSubmitting] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      setCategories(await listInventoryCategories())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load categories')
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
      await createInventoryCategory({ tenantId: profile.tenantId, name: name.trim(), sortOrder: Number(sortOrder) || 0 })
      setName('')
      setSortOrder('0')
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create category')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(row: InventoryCategory) {
    try {
      await setInventoryCategoryActive(row.id, !row.is_active)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update category')
    }
  }

  async function moveRow(index: number, direction: -1 | 1) {
    try {
      await moveInSortOrder(categories, index, direction, updateInventoryCategorySortOrder)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reorder categories')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Inventory Categories</h1>
        <p className="text-muted-foreground">Group inventory items (e.g. Chemicals, Supplies, Retail Items).</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a category</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chemicals" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sort-order">Sort order</Label>
              <Input id="sort-order" type="number" className="w-24" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
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
                    <Switch checked={row.is_active} onCheckedChange={() => toggleActive(row)} />
                  </TableCell>
                </TableRow>
              ))}
              {!loading && categories.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
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
