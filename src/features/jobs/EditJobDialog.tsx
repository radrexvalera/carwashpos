import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatMoney } from '@/lib/money'
import { listServicePrices, listServices, listVehicleSizes, type Service, type ServicePrice, type VehicleSize } from '@/features/catalog/api/catalogApi'
import {
  addJobService,
  getJobEditDetail,
  removeJobService,
  updateJobServiceQuantity,
  updateJobVehicleSize,
  type JobEditLine,
} from './api/jobEditApi'
import { refreshJobBoardCache } from './api/jobBoardSync'

interface EditJobDialogProps {
  jobId: string | null
  tenantId: string
  onOpenChange: (open: boolean) => void
}

export function EditJobDialog({ jobId, tenantId, onOpenChange }: EditJobDialogProps) {
  const [loading, setLoading] = useState(false)
  const [lines, setLines] = useState<JobEditLine[]>([])
  const [vehicleSizeId, setVehicleSizeId] = useState('')
  const [vehicleSizes, setVehicleSizes] = useState<VehicleSize[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [servicePrices, setServicePrices] = useState<ServicePrice[]>([])
  const [pickedServiceId, setPickedServiceId] = useState('')
  const [pickedQuantity, setPickedQuantity] = useState('1')
  const [pickedManualPrice, setPickedManualPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [resizing, setResizing] = useState(false)

  function load() {
    if (!jobId) return
    setLoading(true)
    Promise.all([getJobEditDetail(jobId), listVehicleSizes(), listServices(), listServicePrices()])
      .then(([detail, sizes, serviceRows, priceRows]) => {
        setLines(detail.lines)
        setVehicleSizeId(detail.vehicleSizeId)
        setVehicleSizes(sizes.filter((s) => s.is_active))
        setServices(serviceRows.filter((s) => s.is_active))
        setServicePrices(priceRows)
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load job'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [jobId])

  const priceFor = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of servicePrices) if (p.is_active) map.set(`${p.service_id}:${p.vehicle_size_id}`, p.price)
    return map
  }, [servicePrices])

  function priceForService(service: Service) {
    if (service.pricing_type === 'matrix') return priceFor.get(`${service.id}:${vehicleSizeId}`)
    if (service.pricing_type === 'quoted') return undefined
    return service.flat_price ?? undefined
  }

  const pickedService = services.find((s) => s.id === pickedServiceId)
  const total = lines.reduce((sum, l) => sum + l.lineTotal, 0)

  async function handleAddService() {
    if (!jobId || !pickedServiceId || !pickedService) return
    const quantity = Number(pickedQuantity) || 1
    const manualPrice = pickedService.pricing_type === 'quoted' ? Number(pickedManualPrice) || 0 : undefined
    setBusy(true)
    try {
      await addJobService(jobId, pickedServiceId, quantity, manualPrice)
      toast.success('Service added')
      setPickedServiceId('')
      setPickedQuantity('1')
      setPickedManualPrice('')
      load()
      await refreshJobBoardCache(tenantId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add service')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveLine(line: JobEditLine) {
    setBusy(true)
    try {
      await removeJobService(line.id)
      setLines((prev) => prev.filter((l) => l.id !== line.id))
      toast.success('Removed')
      await refreshJobBoardCache(tenantId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove service')
    } finally {
      setBusy(false)
    }
  }

  async function handleQuantityChange(line: JobEditLine, value: string) {
    const quantity = Number(value)
    if (!quantity || quantity <= 0) return
    setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, quantity } : l)))
    try {
      const result = await updateJobServiceQuantity(line.id, quantity)
      setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, quantity: result.quantity, lineTotal: result.line_total } : l)))
      await refreshJobBoardCache(tenantId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update quantity')
      load()
    }
  }

  async function handleResize(newSizeId: string) {
    if (!jobId || newSizeId === vehicleSizeId) return
    setVehicleSizeId(newSizeId)
    setResizing(true)
    try {
      const result = await updateJobVehicleSize(jobId, newSizeId)
      toast.success(
        result.skipped_count > 0
          ? `Vehicle size updated. ${result.repriced_count} line(s) repriced, ${result.skipped_count} have no price at this size and were left as-is.`
          : `Vehicle size updated. ${result.repriced_count} line(s) repriced.`,
      )
      load()
      await refreshJobBoardCache(tenantId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update vehicle size')
      load()
    } finally {
      setResizing(false)
    }
  }

  return (
    <Dialog open={!!jobId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit job</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Changes here save immediately. Only available before the job is paid for.
            </p>

            <div className="flex flex-col gap-1.5">
              <Label>Vehicle size</Label>
              <Select value={vehicleSizeId} onValueChange={handleResize}>
                <SelectTrigger className="w-48" disabled={resizing}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {vehicleSizes.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              {lines.length === 0 && <p className="text-sm text-muted-foreground">No services on this job.</p>}
              {lines.map((line) => (
                <div key={line.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{line.serviceName}</span>
                    <span className="text-xs text-muted-foreground">{formatMoney(line.unitPrice)} each</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="1"
                      min="1"
                      className="w-16"
                      value={line.quantity}
                      disabled={busy}
                      onChange={(e) => handleQuantityChange(line, e.target.value)}
                    />
                    <span className="w-20 text-right text-sm font-medium">{formatMoney(line.lineTotal)}</span>
                    <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy} onClick={() => handleRemoveLine(line)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
              {lines.length > 0 && (
                <div className="flex justify-between border-t pt-2 text-sm font-semibold">
                  <span>Total</span>
                  <span>{formatMoney(total)}</span>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t pt-3">
              <Label>Add a service</Label>
              <div className="flex flex-wrap items-end gap-2">
                <Select value={pickedServiceId} onValueChange={setPickedServiceId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select service" />
                  </SelectTrigger>
                  <SelectContent>
                    {services.map((s) => {
                      const price = priceForService(s)
                      return (
                        <SelectItem key={s.id} value={s.id} disabled={s.pricing_type !== 'quoted' && price === undefined}>
                          {s.name}
                          {price !== undefined ? ` — ${formatMoney(price)}` : s.pricing_type === 'quoted' ? ' — quoted' : ' — no price for this size'}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  step="1"
                  min="1"
                  className="w-16"
                  value={pickedQuantity}
                  onChange={(e) => setPickedQuantity(e.target.value)}
                />
              </div>
              {pickedService?.pricing_type === 'quoted' && (
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Manual price"
                  value={pickedManualPrice}
                  onChange={(e) => setPickedManualPrice(e.target.value)}
                />
              )}
              <Button variant="secondary" disabled={busy || !pickedServiceId} onClick={handleAddService}>
                Add service
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
