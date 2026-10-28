import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMoney } from '@/lib/money'
import { localDateString } from '@/lib/date'
import { createPurchaseOrder, listInventoryUnits, listPurchaseOrders, listStockLevels, listSuppliers } from './api/inventoryApi'
import type { InventoryStockLevel, Supplier } from './api/inventoryApi'

interface DraftLine {
  itemId: string
  itemName: string
  unitAbbr: string
  quantity: string
  unitCost: string
}

export function PurchaseOrdersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [items, setItems] = useState<InventoryStockLevel[]>([])
  const [orders, setOrders] = useState<Awaited<ReturnType<typeof listPurchaseOrders>>>([])
  const [loading, setLoading] = useState(true)

  const [supplierId, setSupplierId] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [deliveryCharge, setDeliveryCharge] = useState('0')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [pickedItemId, setPickedItemId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      const [suppliersData, itemsData, ordersData] = await Promise.all([listSuppliers(), listStockLevels(), listPurchaseOrders()])
      setSuppliers(suppliersData)
      setItems(itemsData.filter((i) => i.is_active))
      setOrders(ordersData)
      if (!supplierId && suppliersData[0]) setSupplierId(suppliersData[0].id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load purchase orders')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // also pull unit list so it's cached for any future edit UI, even though not directly rendered here
  useEffect(() => {
    listInventoryUnits().catch(() => {})
  }, [])

  function addLine() {
    const item = items.find((i) => i.id === pickedItemId)
    if (!item) return
    if (lines.some((l) => l.itemId === item.id)) return
    setLines((prev) => [...prev, { itemId: item.id, itemName: item.name, unitAbbr: item.unit_abbreviation, quantity: '', unitCost: '' }])
  }

  function updateLine(itemId: string, field: 'quantity' | 'unitCost', value: string) {
    setLines((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, [field]: value } : l)))
  }

  function removeLine(itemId: string) {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId))
  }

  const total = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0) + (Number(deliveryCharge) || 0)

  async function handleSubmit() {
    if (!supplierId || lines.length === 0) return
    const invalid = lines.some((l) => !Number(l.quantity) || Number(l.unitCost) < 0 || l.unitCost === '')
    if (invalid) {
      toast.error('Every line needs a quantity and unit cost')
      return
    }
    setSubmitting(true)
    try {
      await createPurchaseOrder({
        supplierId,
        referenceNumber: referenceNumber.trim() || null,
        orderDate: localDateString(),
        deliveryCharge: Number(deliveryCharge) || 0,
        items: lines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), unitCost: Number(l.unitCost), discountAmount: 0 })),
      })
      toast.success('Purchase order recorded, stock updated')
      setLines([])
      setReferenceNumber('')
      setDeliveryCharge('0')
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record purchase order')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Purchases / Stock-In</h1>
        <p className="text-muted-foreground">Recording a purchase immediately updates stock on hand.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New purchase</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Reference / invoice #</Label>
              <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Delivery charge</Label>
              <Input type="number" step="0.01" className="w-28" value={deliveryCharge} onChange={(e) => setDeliveryCharge(e.target.value)} />
            </div>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>Add item</Label>
              <Select value={pickedItemId} onValueChange={setPickedItemId}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Select item" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="secondary" onClick={addLine}>
              Add line
            </Button>
          </div>

          {lines.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Unit cost</TableHead>
                  <TableHead>Line total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.itemId}>
                    <TableCell>
                      {l.itemName} ({l.unitAbbr})
                    </TableCell>
                    <TableCell>
                      <Input type="number" step="0.0001" className="w-24" value={l.quantity} onChange={(e) => updateLine(l.itemId, 'quantity', e.target.value)} />
                    </TableCell>
                    <TableCell>
                      <Input type="number" step="0.01" className="w-24" value={l.unitCost} onChange={(e) => updateLine(l.itemId, 'unitCost', e.target.value)} />
                    </TableCell>
                    <TableCell>{formatMoney((Number(l.quantity) || 0) * (Number(l.unitCost) || 0))}</TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeLine(l.itemId)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold">Total: {formatMoney(total)}</span>
            <Button disabled={submitting || !supplierId || lines.length === 0} onClick={handleSubmit}>
              Record purchase
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent purchases</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="text-right">Delivery</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>{o.order_date}</TableCell>
                  <TableCell>{o.supplierName}</TableCell>
                  <TableCell>{o.reference_number ?? '—'}</TableCell>
                  <TableCell className="max-w-xs truncate" title={o.itemsSummary}>
                    {o.itemsSummary || '—'}
                  </TableCell>
                  <TableCell className="text-right">{o.delivery_charge > 0 ? formatMoney(o.delivery_charge) : '—'}</TableCell>
                  <TableCell className="text-right font-medium">{formatMoney(o.total)}</TableCell>
                </TableRow>
              ))}
              {!loading && orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No purchases yet.
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
