import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  listServicePrices,
  listServices,
  listVehicleSizeClasses,
  upsertServicePrice,
  type Service,
  type ServicePrice,
  type VehicleSizeClass,
} from './api/catalogApi'

export function ServicePricesPage() {
  const { profile } = useTenant()
  const [services, setServices] = useState<Service[]>([])
  const [sizeClasses, setSizeClasses] = useState<VehicleSizeClass[]>([])
  const [prices, setPrices] = useState<ServicePrice[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    try {
      const [servicesData, sizeClassesData, pricesData] = await Promise.all([
        listServices(),
        listVehicleSizeClasses(),
        listServicePrices(),
      ])
      setServices(servicesData.filter((s) => s.is_active))
      setSizeClasses(sizeClassesData.filter((c) => c.is_active))
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
    for (const p of prices) map.set(`${p.service_id}:${p.vehicle_size_class_id}`, p)
    return map
  }, [prices])

  async function handlePriceChange(serviceId: string, vehicleSizeClassId: string, value: string) {
    if (!profile) return
    const key = `${serviceId}:${vehicleSizeClassId}`
    const price = Number(value)
    if (Number.isNaN(price) || price < 0) return

    setSavingKey(key)
    try {
      await upsertServicePrice({ tenantId: profile.tenantId, serviceId, vehicleSizeClassId, price })
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
          Set the price for each service at each vehicle size independently — prices don't have to
          scale proportionally between sizes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Price matrix</CardTitle>
        </CardHeader>
        <CardContent>
          {services.length === 0 || sizeClasses.length === 0 ? (
            <p className="text-muted-foreground">
              {loading ? 'Loading…' : 'Add at least one active service and vehicle size class first.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    {sizeClasses.map((sc) => (
                      <TableHead key={sc.id}>{sc.name}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {services.map((service) => (
                    <TableRow key={service.id}>
                      <TableCell className="font-medium">{service.name}</TableCell>
                      {sizeClasses.map((sc) => {
                        const key = `${service.id}:${sc.id}`
                        const existing = priceMap.get(key)
                        return (
                          <TableCell key={sc.id}>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              className="w-28"
                              defaultValue={existing?.price ?? ''}
                              placeholder="—"
                              disabled={savingKey === key}
                              onBlur={(e) => {
                                if (e.target.value !== '') handlePriceChange(service.id, sc.id, e.target.value)
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
