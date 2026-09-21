import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMoney } from '@/lib/money'
import {
  adjustInventoryStock,
  createInventoryItem,
  listInventoryCategories,
  listInventoryUnits,
  listItemTransactions,
  listStockLevels,
  setInventoryItemActive,
  type InventoryCategory,
  type InventoryStockLevel,
  type InventoryTransaction,
  type InventoryUnit,
} from './api/inventoryApi'

const ITEM_TYPE_LABELS: Record<string, string> = {
  retail: 'Retail',
  consumable: 'Consumable',
  reusable_equipment: 'Reusable Equipment',
  asset: 'Asset',
}

const ADJUSTMENT_TYPES = [
  'opening_balance',
  'adjustment_positive',
  'adjustment_negative',
  'damaged',
  'expired',
  'lost',
  'returned',
  'manual_correction',
]

export function InventoryItemsPage() {
  const { profile } = useTenant()
  const [items, setItems] = useState<InventoryStockLevel[]>([])
  const [categories, setCategories] = useState<InventoryCategory[]>([])
  const [units, setUnits] = useState<InventoryUnit[]>([])
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [itemType, setItemType] = useState('consumable')
  const [categoryId, setCategoryId] = useState('none')
  const [unitId, setUnitId] = useState('')
  const [retailPrice, setRetailPrice] = useState('')
  const [reorderLevel, setReorderLevel] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [adjustItem, setAdjustItem] = useState<InventoryStockLevel | null>(null)
  const [adjustType, setAdjustType] = useState('adjustment_positive')
  const [adjustQty, setAdjustQty] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [history, setHistory] = useState<InventoryTransaction[]>([])

  async function reload() {
    setLoading(true)
    try {
      const [itemsData, categoriesData, unitsData] = await Promise.all([
        listStockLevels(),
        listInventoryCategories(),
        listInventoryUnits(),
      ])
      setItems(itemsData)
      setCategories(categoriesData.filter((c) => c.is_active))
      setUnits(unitsData)
      if (!unitId && unitsData[0]) setUnitId(unitsData[0].id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load inventory')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!profile || !name.trim() || !unitId) return
    setSubmitting(true)
    try {
      await createInventoryItem({
        tenantId: profile.tenantId,
        categoryId: categoryId === 'none' ? null : categoryId,
        name: name.trim(),
        sku: null,
        itemType: itemType as 'retail' | 'consumable' | 'reusable_equipment' | 'asset',
        unitId,
        retailPrice: retailPrice ? Number(retailPrice) : null,
        minStock: null,
        reorderLevel: reorderLevel ? Number(reorderLevel) : null,
        targetStock: null,
      })
      setName('')
      setRetailPrice('')
      setReorderLevel('')
      await reload()
      toast.success('Item added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create item')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(row: InventoryStockLevel) {
    try {
      await setInventoryItemActive(row.id, !row.is_active)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update item')
    }
  }

  async function openAdjust(item: InventoryStockLevel) {
    setAdjustItem(item)
    setAdjustQty('')
    setAdjustReason('')
    try {
      setHistory(await listItemTransactions(item.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load history')
    }
  }

  async function submitAdjustment() {
    if (!adjustItem) return
    const qty = Number(adjustQty)
    if (!qty || !adjustReason.trim()) {
      toast.error('Enter a non-zero quantity and a reason')
      return
    }
    try {
      await adjustInventoryStock({ itemId: adjustItem.id, transactionType: adjustType, quantityDelta: qty, reason: adjustReason.trim() })
      toast.success('Stock adjusted')
      setAdjustItem(null)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to adjust stock')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <p className="text-muted-foreground">Retail products, consumables, equipment, and assets in one place.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add an item</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Car Shampoo" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Type</Label>
              <Select value={itemType} onValueChange={setItemType}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Uncategorized" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Uncategorized</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Unit</Label>
              <Select value={unitId} onValueChange={setUnitId}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.abbreviation}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {itemType === 'retail' && (
              <div className="flex flex-col gap-1.5">
                <Label>Retail price (₱)</Label>
                <Input type="number" step="0.01" className="w-28" value={retailPrice} onChange={(e) => setRetailPrice(e.target.value)} />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label>Reorder level</Label>
              <Input type="number" step="0.01" className="w-28" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} />
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
                <TableHead>Type</TableHead>
                <TableHead>On hand</TableHead>
                <TableHead>Avg. cost</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{ITEM_TYPE_LABELS[row.item_type]}</TableCell>
                  <TableCell>
                    {row.on_hand_qty} {row.unit_abbreviation}
                  </TableCell>
                  <TableCell>{row.average_unit_cost ? formatMoney(row.average_unit_cost) : '—'}</TableCell>
                  <TableCell>{formatMoney(row.inventory_value)}</TableCell>
                  <TableCell>{row.is_low_stock && <Badge variant="destructive">Low stock</Badge>}</TableCell>
                  <TableCell className="text-right">
                    <input type="checkbox" checked={row.is_active} onChange={() => toggleActive(row)} className="h-4 w-4" />
                  </TableCell>
                  <TableCell>
                    <Dialog open={adjustItem?.id === row.id} onOpenChange={(open) => !open && setAdjustItem(null)}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" onClick={() => openAdjust(row)}>
                          Adjust
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Adjust {row.name}</DialogTitle>
                        </DialogHeader>
                        <div className="flex flex-col gap-3">
                          <div className="flex gap-2">
                            <Select value={adjustType} onValueChange={setAdjustType}>
                              <SelectTrigger className="w-48">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ADJUSTMENT_TYPES.map((t) => (
                                  <SelectItem key={t} value={t}>
                                    {t.replace(/_/g, ' ')}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              type="number"
                              step="0.0001"
                              placeholder={`Qty (+/-) in ${row.unit_abbreviation}`}
                              value={adjustQty}
                              onChange={(e) => setAdjustQty(e.target.value)}
                            />
                          </div>
                          <Input placeholder="Reason (required)" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} />
                          <Button onClick={submitAdjustment}>Save adjustment</Button>

                          <div className="mt-2 flex flex-col gap-1 border-t pt-2 text-sm">
                            <div className="font-medium">Recent history</div>
                            {history.map((h) => (
                              <div key={h.id} className="flex justify-between text-muted-foreground">
                                <span>
                                  {h.transaction_type.replace(/_/g, ' ')}
                                  {h.reason ? ` · ${h.reason}` : ''}
                                </span>
                                <span>
                                  {h.quantity_delta > 0 ? '+' : ''}
                                  {h.quantity_delta} ({h.new_qty})
                                </span>
                              </div>
                            ))}
                            {history.length === 0 && <p className="text-muted-foreground">No transactions yet.</p>}
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No inventory items yet.
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
