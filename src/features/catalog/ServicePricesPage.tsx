import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  listServicePrices,
  listServices,
  listVehicleSizes,
  upsertServicePrice,
  type Service,
  type ServicePrice,
  type VehicleSize,
} from './api/catalogApi'

export function ServicePricesPage() {
  const { profile } = useTenant()
  const [services, setServices] = useState<Service[]>([])
  const [sizes, setSizes] = useState<VehicleSize[]>([])
  const [prices, setPrices] = useState<ServicePrice[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    try {
      const [servicesData, sizesData, pricesData] = await Promise.all([
        listServices(),
        listVehicleSizes(),
        listServicePrices(),
      ])
      setServices(servicesData.filter((s) => s.is_active))
      setSizes(sizesData.filter((c) => c.is_active))
      setPrices(pricesData)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load pricing')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const priceMap = useMemo(() => {
    const map = new Map<string, ServicePrice>()
    for (const p of prices) map.set(`${p.service_id}:${p.vehicle_size_id}`, p)
    return map
  }, [prices])

  async function handlePriceChange(serviceId: string, vehicleSizeId: string, value: string) {
    if (!profile) return
    const key = `${serviceId}:${vehicleSizeId}`
    const price = Number(value)
    if (Number.isNaN(price) || price < 0) return

    setSavingKey(key)
    try {
      await upsertServicePrice({ tenantId: profile.tenantId, serviceId, vehicleSizeId, price })
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save price')
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Pricing</h1>
        <p className="text-muted-foreground">
          Set the price for each service at each vehicle size independently. Leave a cell blank if
          a service doesn't apply to that size (e.g. Tint doesn't apply to motorcycles).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Price matrix (₱)</CardTitle>
        </CardHeader>
        <CardContent>
          {services.length === 0 || sizes.length === 0 ? (
            <p className="text-muted-foreground">
              {loading ? 'Loading…' : 'Add at least one active service and vehicle size first.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    {sizes.map((sz) => (
                      <TableHead key={sz.id}>{sz.name}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {services.map((service) => (
                    <TableRow key={service.id}>
                      <TableCell className="font-medium">{service.name}</TableCell>
                      {sizes.map((sz) => {
                        const key = `${service.id}:${sz.id}`
                        const existing = priceMap.get(key)
                        return (
                          <TableCell key={sz.id}>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              className="w-28"
                              defaultValue={existing?.price ?? ''}
                              placeholder="—"
                              disabled={savingKey === key}
                              onBlur={(e) => {
                                if (e.target.value !== '') handlePriceChange(service.id, sz.id, e.target.value)
                              }}
                            />
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
