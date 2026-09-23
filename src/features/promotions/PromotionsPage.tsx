import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMoney } from '@/lib/money'
import { listServices } from '@/features/catalog/api/catalogApi'
import {
  createPromotion,
  listPromotionServiceIds,
  listPromotions,
  setPromotionActive,
  updatePromotion,
  type Promotion,
} from './api/promotionsApi'

type Service = { id: string; name: string }

const emptyForm = {
  name: '',
  description: '',
  discountType: 'percentage' as 'percentage' | 'fixed_amount',
  discountValue: '',
  minSpend: '',
  startsAt: '',
  endsAt: '',
  serviceIds: [] as string[],
}

export function PromotionsPage() {
  const { profile } = useTenant()
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)

  async function reload() {
    setLoading(true)
    try {
      const [promoData, serviceData] = await Promise.all([listPromotions(), listServices()])
      setPromotions(promoData)
      setServices((serviceData ?? []).filter((s) => s.is_active).map((s) => ({ id: s.id, name: s.name })))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load promotions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm)
    setOpen(true)
  }

  async function openEdit(promo: Promotion) {
    setEditingId(promo.id)
    const serviceIds = await listPromotionServiceIds(promo.id).catch(() => [])
    setForm({
      name: promo.name,
      description: promo.description ?? '',
      discountType: promo.discount_type as 'percentage' | 'fixed_amount',
      discountValue: String(promo.discount_value),
      minSpend: promo.min_spend != null ? String(promo.min_spend) : '',
      startsAt: promo.starts_at ?? '',
      endsAt: promo.ends_at ?? '',
      serviceIds,
    })
    setOpen(true)
  }

  function toggleService(id: string) {
    setForm((prev) => ({
      ...prev,
      serviceIds: prev.serviceIds.includes(id) ? prev.serviceIds.filter((s) => s !== id) : [...prev.serviceIds, id],
    }))
  }

  async function handleSubmit() {
    if (!profile || !form.name.trim() || !form.discountValue) return
    setSubmitting(true)
    try {
      const input = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        discountType: form.discountType,
        discountValue: Number(form.discountValue),
        minSpend: form.minSpend ? Number(form.minSpend) : undefined,
        startsAt: form.startsAt || undefined,
        endsAt: form.endsAt || undefined,
        serviceIds: form.serviceIds,
      }
      if (editingId) {
        await updatePromotion(editingId, input)
      } else {
        await createPromotion({ tenantId: profile.tenantId, ...input })
      }
      toast.success(editingId ? 'Promotion updated' : 'Promotion created')
      setOpen(false)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save promotion')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(promo: Promotion) {
    try {
      await setPromotionActive(promo.id, !promo.is_active)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update promotion')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Promotions</h1>
          <p className="text-muted-foreground">Staff-applied discounts, picked at checkout — no customer-facing codes.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>New promotion</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit promotion' : 'New promotion'}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Rainy Day 10% Off" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Description (optional)</Label>
                <Input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Discount type</Label>
                  <Select value={form.discountType} onValueChange={(v) => setForm((p) => ({ ...p, discountType: v as typeof p.discountType }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">Percentage off</SelectItem>
                      <SelectItem value="fixed_amount">Fixed peso off</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{form.discountType === 'percentage' ? 'Percent (%)' : 'Amount (₱)'}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.discountValue}
                    onChange={(e) => setForm((p) => ({ ...p, discountValue: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Min spend (optional)</Label>
                  <Input type="number" step="0.01" value={form.minSpend} onChange={(e) => setForm((p) => ({ ...p, minSpend: e.target.value }))} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Starts (optional)</Label>
                  <Input type="date" value={form.startsAt} onChange={(e) => setForm((p) => ({ ...p, startsAt: e.target.value }))} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Ends (optional)</Label>
                  <Input type="date" value={form.endsAt} onChange={(e) => setForm((p) => ({ ...p, endsAt: e.target.value }))} />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Restrict to specific services (optional — leave empty to apply to the whole sale)</Label>
                <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-md border p-2">
                  {services.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={form.serviceIds.includes(s.id)} onCheckedChange={() => toggleService(s.id)} />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>
              <Button onClick={handleSubmit} disabled={submitting || !form.name.trim() || !form.discountValue}>
                {editingId ? 'Save changes' : 'Create promotion'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All promotions</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Min spend</TableHead>
                <TableHead>Date range</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {promotions.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    {p.name}
                    {p.description && <div className="text-xs text-muted-foreground">{p.description}</div>}
                  </TableCell>
                  <TableCell>
                    {p.discount_type === 'percentage' ? `${p.discount_value}%` : formatMoney(p.discount_value)}
                  </TableCell>
                  <TableCell>{p.min_spend != null ? formatMoney(p.min_spend) : '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {p.starts_at || p.ends_at ? `${p.starts_at ?? '…'} → ${p.ends_at ?? '…'}` : 'Always'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch checked={p.is_active} onCheckedChange={() => toggleActive(p)} />
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && promotions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No promotions yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {promotions.length > 0 && <Badge variant="outline" className="w-fit">Empty service restriction = applies to the whole sale</Badge>}
    </div>
  )
}
