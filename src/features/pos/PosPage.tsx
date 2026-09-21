import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { useTenant } from '@/app/TenantProvider'
import { db } from '@/lib/db/dexie'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import type { LocalTicketLineItem } from '@/lib/offline/types'
import { completeTicketOffline } from './api/ticketMutations'
import { PaymentPanel } from './components/PaymentPanel'

export function PosPage() {
  const { profile } = useTenant()
  const navigate = useNavigate()

  const sizeClasses = useLiveQuery(
    () => db.vehicleSizeClasses.where('tenant_id').equals(profile?.tenantId ?? '').and((c) => c.is_active).sortBy('sort_order'),
    [profile?.tenantId],
    [],
  )
  const services = useLiveQuery(
    () => db.services.where('tenant_id').equals(profile?.tenantId ?? '').and((s) => s.is_active).toArray(),
    [profile?.tenantId],
    [],
  )
  const servicePrices = useLiveQuery(
    () => db.servicePrices.where('tenant_id').equals(profile?.tenantId ?? '').toArray(),
    [profile?.tenantId],
    [],
  )
  const products = useLiveQuery(
    () => db.products.where('tenant_id').equals(profile?.tenantId ?? '').and((p) => p.is_active).toArray(),
    [profile?.tenantId],
    [],
  )

  const [sizeClassId, setSizeClassId] = useState<string>('')
  const [lines, setLines] = useState<LocalTicketLineItem[]>([])
  const [submitting, setSubmitting] = useState(false)

  const effectiveSizeClassId = sizeClassId || sizeClasses?.[0]?.id || ''

  const priceFor = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of servicePrices ?? []) {
      if (p.is_active) map.set(`${p.service_id}:${p.vehicle_size_class_id}`, p.price)
    }
    return map
  }, [servicePrices])

  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0)

  function addServiceLine(serviceId: string, serviceName: string) {
    if (!effectiveSizeClassId) {
      toast.error('Pick a vehicle size first')
      return
    }
    const price = priceFor.get(`${serviceId}:${effectiveSizeClassId}`)
    if (price === undefined) {
      toast.error('No price set for this service at this vehicle size')
      return
    }
    const sizeName = sizeClasses?.find((c) => c.id === effectiveSizeClassId)?.name ?? ''
    setLines((prev) => [
      ...prev,
      {
        lineType: 'service',
        serviceId,
        serviceName,
        vehicleSizeClassId: effectiveSizeClassId,
        vehicleSizeClassName: sizeName,
        unitPrice: price,
        quantity: 1,
        lineTotal: price,
      },
    ])
  }

  function addProductLine(productId: string, productName: string, price: number, stockQty: number) {
    if (stockQty <= 0) {
      toast.warning(`${productName} may be out of stock (as of last sync) — adding anyway`)
    }
    setLines((prev) => {
      const existingIdx = prev.findIndex((l) => l.lineType === 'product' && l.productId === productId)
      if (existingIdx >= 0) {
        const next = [...prev]
        const line = next[existingIdx]
        const quantity = line.quantity + 1
        next[existingIdx] = { ...line, quantity, lineTotal: round2(line.unitPrice * quantity) }
        return next
      }
      return [...prev, { lineType: 'product', productId, productName, unitPrice: price, quantity: 1, lineTotal: price }]
    })
  }

  function updateQuantity(index: number, delta: number) {
    setLines((prev) => {
      const next = [...prev]
      const line = next[index]
      const quantity = Math.max(1, line.quantity + delta)
      next[index] = { ...line, quantity, lineTotal: round2(line.unitPrice * quantity) }
      return next
    })
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleComplete(payments: { method: 'cash' | 'e_wallet' | 'card'; amount: number; referenceNote?: string }[]) {
    if (!profile || lines.length === 0) return
    setSubmitting(true)
    try {
      const clientGeneratedId = await completeTicketOffline({
        tenantId: profile.tenantId,
        lineItems: lines,
        payments,
      })
      toast.success('Ticket completed')
      navigate(`/receipt/${clientGeneratedId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to complete ticket')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Register</h1>
          <p className="text-muted-foreground">Build the ticket, then take payment. Works offline.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Vehicle size</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={effectiveSizeClassId} onValueChange={setSizeClassId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select vehicle size" />
              </SelectTrigger>
              <SelectContent>
                {(sizeClasses ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Services</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(services ?? []).length === 0 && <p className="text-muted-foreground">No services set up yet.</p>}
            {(services ?? []).map((s) => {
              const price = priceFor.get(`${s.id}:${effectiveSizeClassId}`)
              return (
                <Button
                  key={s.id}
                  variant="outline"
                  className="h-auto flex-col items-start gap-1 py-3"
                  disabled={price === undefined}
                  onClick={() => addServiceLine(s.id, s.name)}
                >
                  <span>{s.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {price !== undefined ? `$${price.toFixed(2)}` : 'No price for this size'}
                  </span>
                </Button>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Products</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(products ?? []).length === 0 && <p className="text-muted-foreground">No products set up yet.</p>}
            {(products ?? []).map((p) => (
              <Button
                key={p.id}
                variant="outline"
                className="h-auto flex-col items-start gap-1 py-3"
                onClick={() => addProductLine(p.id, p.name, p.price, p.stock_qty)}
              >
                <span>{p.name}</span>
                <span className="text-xs text-muted-foreground">
                  ${p.price.toFixed(2)}
                  {p.stock_qty <= 0 && ' · low stock?'}
                </span>
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ticket</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {lines.length === 0 && <p className="text-muted-foreground">No items yet — add a service or product above.</p>}
            {lines.map((line, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-md border p-2">
                <div>
                  <div className="font-medium">
                    {line.lineType === 'service' ? line.serviceName : line.productName}
                    {line.lineType === 'service' && (
                      <Badge variant="secondary" className="ml-2">
                        {line.vehicleSizeClassName}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">${line.unitPrice.toFixed(2)} each</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => updateQuantity(i, -1)}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-6 text-center">{line.quantity}</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => updateQuantity(i, 1)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                  <span className="w-16 text-right font-medium">${line.lineTotal.toFixed(2)}</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeLine(i)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <PaymentPanel total={round2(subtotal)} disabled={lines.length === 0 || submitting} onComplete={handleComplete} />
    </div>
  )
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}
