import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { useTenant } from '@/app/TenantProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { listServices, listVehicleSizes } from '@/features/catalog/api/catalogApi'
import type { Service, VehicleSize } from '@/features/catalog/api/catalogApi'
import { addServiceRecipeItem, deleteServiceRecipeItem, listServiceRecipeItems, listStockLevels } from './api/inventoryApi'
import type { InventoryStockLevel, ServiceRecipeItem } from './api/inventoryApi'

export function ServiceRecipesPage() {
  const { profile } = useTenant()
  const [services, setServices] = useState<Service[]>([])
  const [sizes, setSizes] = useState<VehicleSize[]>([])
  const [items, setItems] = useState<InventoryStockLevel[]>([])
  const [serviceId, setServiceId] = useState('')
  const [recipeItems, setRecipeItems] = useState<ServiceRecipeItem[]>([])
  const [loading, setLoading] = useState(true)

  const [sizeId, setSizeId] = useState('any')
  const [itemId, setItemId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      const [servicesData, sizesData, itemsData] = await Promise.all([listServices(), listVehicleSizes(), listStockLevels()])
      setServices(servicesData.filter((s) => s.is_active))
      setSizes(sizesData.filter((s) => s.is_active))
      setItems(itemsData.filter((i) => i.is_active && i.item_type === 'consumable'))
      if (!serviceId && servicesData[0]) setServiceId(servicesData[0].id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load service recipes')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!serviceId) return
    listServiceRecipeItems(serviceId)
      .then(setRecipeItems)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load recipe'))
  }, [serviceId])

  const sizeName = (id: string | null) => (id ? sizes.find((s) => s.id === id)?.name ?? '—' : 'Any size')
  const itemName = (id: string) => items.find((i) => i.id === id)?.name ?? 'Unknown'
  const itemUnit = (id: string) => items.find((i) => i.id === id)?.unit_abbreviation ?? ''

  async function handleAdd() {
    if (!profile || !serviceId || !itemId || !quantity) return
    setSubmitting(true)
    try {
      await addServiceRecipeItem({
        tenantId: profile.tenantId,
        serviceId,
        vehicleSizeId: sizeId === 'any' ? null : sizeId,
        itemId,
        quantityUsed: Number(quantity),
      })
      setQuantity('')
      setRecipeItems(await listServiceRecipeItems(serviceId))
      toast.success('Added to recipe')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add recipe item')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRemove(id: string) {
    try {
      await deleteServiceRecipeItem(id)
      setRecipeItems(await listServiceRecipeItems(serviceId))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove recipe item')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Service Recipes</h1>
        <p className="text-muted-foreground">
          Estimated consumable usage per service. Deducted automatically when a job's service is
          completed. A size-specific row overrides "Any size" for the same item.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Service</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={serviceId} onValueChange={setServiceId}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {services.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add ingredient</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground">Vehicle size</label>
            <Select value={sizeId} onValueChange={setSizeId}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any size</SelectItem>
                {sizes.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground">Consumable</label>
            <Select value={itemId} onValueChange={setItemId}>
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
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground">Quantity used</label>
            <Input type="number" step="0.0001" className="w-28" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <Button disabled={submitting || !itemId || !quantity} onClick={handleAdd}>
            Add
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vehicle size</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Quantity used</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipeItems.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{sizeName(r.vehicle_size_id)}</TableCell>
                  <TableCell>{itemName(r.item_id)}</TableCell>
                  <TableCell>
                    {r.quantity_used} {itemUnit(r.item_id)}
                  </TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleRemove(r.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && recipeItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No recipe set for this service yet.
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
