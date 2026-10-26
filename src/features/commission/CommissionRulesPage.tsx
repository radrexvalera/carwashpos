import { Fragment, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { listServiceCategories, listServices, listVehicleSizes, type VehicleSize } from '@/features/catalog/api/catalogApi'
import { getSettings, updateSettings } from '@/features/settings/api/settingsApi'
import {
  deleteCommissionRule,
  listCommissionRules,
  listCommissionSizes,
  upsertCommissionRule,
  upsertCommissionSize,
} from './api/commissionApi'

type CommissionType = 'fixed_pool' | 'percentage' | 'fixed_per_attendant' | 'points' | 'fixed_pool_by_size'
type Basis = 'original_price' | 'discounted_price'

const TYPE_LABELS: Record<CommissionType, string> = {
  fixed_pool: 'Fixed pool (₱, split among crew)',
  percentage: "Percentage of this service's own revenue",
  fixed_per_attendant: 'Fixed ₱ per attendant',
  points: 'Points per attendant',
  fixed_pool_by_size: 'Fixed ₱ by vehicle size (e.g. PPF)',
}

interface RowState {
  serviceId: string | null
  ruleId: string | null
  hasOwnRule: boolean
  label: string
  type: CommissionType
  rate: string
  basis: Basis
}

// Wash is always the fixed carwash rate (set in the policy card above) -- no per-service override
// makes sense for it, so only the "bonus on top" types are offered. The tenant-wide default row
// (no specific service) also can't use 'percentage' (settings.other_commission_rate already covers
// that) or 'fixed_pool_by_size' (needs one specific service to pair with a size table).
function availableTypesFor(row: RowState, isCarwash: (serviceId: string) => boolean): CommissionType[] {
  if (row.serviceId === null) return ['fixed_pool', 'fixed_per_attendant', 'points']
  if (isCarwash(row.serviceId)) return ['fixed_pool', 'fixed_per_attendant', 'points']
  return ['fixed_pool', 'percentage', 'fixed_per_attendant', 'points', 'fixed_pool_by_size']
}

function describeRule(type: CommissionType, rate: string) {
  if (type === 'fixed_pool_by_size') return 'Fixed amount by vehicle size (set below)'
  if (!rate) return 'No bonus configured'
  if (type === 'percentage') return `${rate}%`
  const unit = type === 'points' ? `${rate} pts` : `₱${rate}`
  return `${TYPE_LABELS[type]} — ${unit}`
}

export function CommissionRulesPage() {
  const { profile } = useTenant()
  const [rows, setRows] = useState<RowState[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [overridingKeys, setOverridingKeys] = useState<Set<string>>(new Set())
  const [carwashServiceIds, setCarwashServiceIds] = useState<Set<string>>(new Set())
  const isCarwash = (serviceId: string) => carwashServiceIds.has(serviceId)

  const [vehicleSizes, setVehicleSizes] = useState<VehicleSize[]>([])
  // serviceId -> vehicleSizeId -> amount (string, as typed in the input)
  const [sizeAmounts, setSizeAmounts] = useState<Record<string, Record<string, string>>>({})
  const [savingSizesKey, setSavingSizesKey] = useState<string | null>(null)

  const [carwashRate, setCarwashRate] = useState('')
  const [otherRate, setOtherRate] = useState('')
  const [savingPolicy, setSavingPolicy] = useState(false)

  const [cardFeeRate, setCardFeeRate] = useState('')
  const [savingCardFeeRate, setSavingCardFeeRate] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      const [servicesData, categoriesData, rulesData, sizesData, settings] = await Promise.all([
        listServices(),
        listServiceCategories(),
        listCommissionRules(),
        listVehicleSizes(),
        profile ? getSettings(profile.tenantId) : Promise.resolve(null),
      ])

      if (settings) {
        setCarwashRate(String(settings.carwash_commission_rate))
        setOtherRate(String(settings.other_commission_rate))
        setCardFeeRate(String(settings.card_processing_fee_rate))
      }

      setVehicleSizes(sizesData.filter((s) => s.is_active))

      const carwashCategoryIds = new Set(categoriesData.filter((c) => c.is_carwash).map((c) => c.id))
      setCarwashServiceIds(new Set(servicesData.filter((s) => s.category_id && carwashCategoryIds.has(s.category_id)).map((s) => s.id)))

      const ruleFor = (serviceId: string | null) => rulesData.find((r) => r.service_id === serviceId)
      // The default row can't use 'percentage' or 'fixed_pool_by_size' (see availableTypesFor) --
      // a legacy row stuck on one of those (from before this was enforced) displays as an unset
      // fixed pool rather than a dead selection, so a save has to consciously pick a real method.
      const displayType = (serviceId: string | null, type: string | undefined): CommissionType => {
        if (!type) return 'fixed_pool'
        if (serviceId === null && (type === 'percentage' || type === 'fixed_pool_by_size')) return 'fixed_pool'
        return type as CommissionType
      }
      const displayRate = (r: { commission_type: string; rate: number } | undefined) => (r ? String(r.rate) : '')

      const defaultRule = ruleFor(null)
      const newRows: RowState[] = [
        {
          serviceId: null,
          ruleId: defaultRule?.id ?? null,
          hasOwnRule: true,
          label: 'Default (all other services)',
          type: displayType(null, defaultRule?.commission_type),
          rate: displayRate(defaultRule),
          basis: (defaultRule?.basis as Basis) ?? 'discounted_price',
        },
        ...servicesData
          .filter((s) => s.is_active)
          .map((s) => {
            const r = ruleFor(s.id)
            return {
              serviceId: s.id,
              ruleId: r?.id ?? null,
              hasOwnRule: !!r,
              label: s.name,
              type: displayType(s.id, r?.commission_type),
              rate: displayRate(r),
              basis: (r?.basis as Basis) ?? 'discounted_price',
            }
          }),
      ]
      setRows(newRows)
      // Merge in any newly-saved overrides without clobbering a row the manager just opened for
      // editing but hasn't saved yet (e.g. a reload triggered by saving a *different* row).
      setOverridingKeys((prev) => {
        const next = new Set(prev)
        for (const r of newRows) if (r.serviceId && r.hasOwnRule) next.add(r.serviceId)
        return next
      })

      // Preload size amounts for any row already using fixed_pool_by_size, so they show immediately
      // instead of only after the manager touches that row.
      for (const r of newRows) {
        if (r.serviceId && r.type === 'fixed_pool_by_size') void loadSizesForService(r.serviceId)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load commission rules')
    } finally {
      setLoading(false)
    }
  }

  async function loadSizesForService(serviceId: string) {
    try {
      const sizes = await listCommissionSizes(serviceId)
      setSizeAmounts((prev) => ({
        ...prev,
        [serviceId]: Object.fromEntries(sizes.map((s) => [s.vehicle_size_id, String(s.amount)])),
      }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load vehicle-size amounts')
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.tenantId])

  function updateRow(key: string, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r) => (rowKey(r) === key ? { ...r, ...patch } : r)))
  }

  async function saveRow(row: RowState) {
    if (!profile) return
    // Rate is meaningless for fixed_pool_by_size (the per-size table below is the real config) --
    // stored as 0 rather than left unset, since the column doesn't allow null.
    const rate = row.type === 'fixed_pool_by_size' ? 0 : Number(row.rate)
    if (Number.isNaN(rate) || rate < 0) {
      toast.error('Enter a valid rate')
      return
    }
    const key = rowKey(row)
    setSavingKey(key)
    try {
      await upsertCommissionRule({
        tenantId: profile.tenantId,
        serviceId: row.serviceId,
        commissionType: row.type,
        rate,
        basis: row.basis,
      })
      toast.success('Saved')
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save rule')
    } finally {
      setSavingKey(null)
    }
  }

  async function saveSizes(row: RowState) {
    if (!profile || !row.serviceId) return
    const amounts = sizeAmounts[row.serviceId] ?? {}
    setSavingSizesKey(row.serviceId)
    try {
      for (const size of vehicleSizes) {
        const raw = amounts[size.id]
        if (raw === undefined || raw === '') continue
        const amount = Number(raw)
        if (Number.isNaN(amount) || amount < 0) {
          toast.error(`Enter a valid amount for ${size.name}`)
          continue
        }
        await upsertCommissionSize({ tenantId: profile.tenantId, serviceId: row.serviceId, vehicleSizeId: size.id, amount })
      }
      toast.success('Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save vehicle-size amounts')
    } finally {
      setSavingSizesKey(null)
    }
  }

  function startOverride(row: RowState) {
    if (!row.serviceId) return
    setOverridingKeys((prev) => new Set(prev).add(row.serviceId!))
    // Seed with the default's current values as a sensible starting point to tweak, rather than a
    // blank/zero rule that'd pay nothing until filled in.
    const def = rows.find((r) => r.serviceId === null)
    if (def) updateRow(row.serviceId, { type: def.type, rate: def.rate, basis: def.basis })
  }

  async function removeOverride(row: RowState) {
    if (!row.ruleId || !row.serviceId) return
    try {
      await deleteCommissionRule(row.ruleId)
      setOverridingKeys((prev) => {
        const next = new Set(prev)
        next.delete(row.serviceId!)
        return next
      })
      toast.success('Reverted to default')
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove override')
    }
  }

  async function savePolicy() {
    if (!profile) return
    const cw = Number(carwashRate)
    const other = Number(otherRate)
    if (Number.isNaN(cw) || cw < 0 || Number.isNaN(other) || other < 0) {
      toast.error('Enter valid rates')
      return
    }
    setSavingPolicy(true)
    try {
      await updateSettings(profile.tenantId, { carwash_commission_rate: cw, other_commission_rate: other })
      toast.success('Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save commission policy')
    } finally {
      setSavingPolicy(false)
    }
  }

  async function saveCardFeeRate() {
    if (!profile) return
    const rate = Number(cardFeeRate)
    if (Number.isNaN(rate) || rate < 0) {
      toast.error('Enter a valid rate')
      return
    }
    setSavingCardFeeRate(true)
    try {
      await updateSettings(profile.tenantId, { card_processing_fee_rate: rate })
      toast.success('Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save card processing fee rate')
    } finally {
      setSavingCardFeeRate(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Commission Rules</h1>
        <p className="text-muted-foreground">
          Wash services always earn the fixed Wash rate below. Any other service earns the "other" rate below, unless
          you've set its own rate (or a fixed amount by vehicle size) in the table further down.
        </p>
      </div>

      <Card id="tour-commission-policy">
        <CardHeader>
          <CardTitle>Commission policy</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            When a job is completed, each service earns commission off its own revenue -- Wash services at the fixed
            rate on the left, every other service at the rate on the right (unless overridden below). Those amounts
            are added together into one pool, split evenly among every crew member assigned anywhere on the job.
            Which services count as "Wash" is set per category on the Service Categories page.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Carwash-only jobs</Label>
              <Input type="number" step="0.01" min="0" className="w-28" value={carwashRate} onChange={(e) => setCarwashRate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Jobs with any other service</Label>
              <Input type="number" step="0.01" min="0" className="w-28" value={otherRate} onChange={(e) => setOtherRate(e.target.value)} />
            </div>
            <Button disabled={savingPolicy} onClick={savePolicy}>
              Save policy
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Card processing fee</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            The cut your card terminal takes on a card payment. The customer still pays the listed price -- this just
            reduces what counts as revenue for that payment (shown as its own line on the transaction and sales
            report), and proportionally reduces the crew commission tied to that job.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Rate (%)</Label>
              <Input type="number" step="0.01" min="0" className="w-28" value={cardFeeRate} onChange={(e) => setCardFeeRate(e.target.value)} />
            </div>
            <Button disabled={savingCardFeeRate} onClick={saveCardFeeRate}>
              Save rate
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-service overrides</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="mb-3 text-sm text-muted-foreground">
            Wash services always earn the fixed Wash rate above -- only bonus types are offered for them. Any other
            service can instead earn its own percentage (overriding the default "other" rate), or a fixed ₱ amount
            that varies by vehicle size (e.g. PPF).
          </p>
          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  const defaultRow = rows.find((r) => r.serviceId === null)
                  return rows.map((row) => {
                    const key = rowKey(row)
                    const isDefault = row.serviceId === null
                    const isOverriding = isDefault || overridingKeys.has(row.serviceId!)

                    if (!isOverriding) {
                      return (
                        <TableRow key={key}>
                          <TableCell>{row.label}</TableCell>
                          <TableCell colSpan={2} className="text-muted-foreground">
                            Inherits default — {defaultRow ? describeRule(defaultRow.type, defaultRow.rate) : '…'}
                          </TableCell>
                          <TableCell>
                            <Button size="sm" variant="outline" onClick={() => startOverride(row)}>
                              Override
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    }

                    const options = availableTypesFor(row, isCarwash)
                    const isBySize = row.type === 'fixed_pool_by_size'

                    return (
                      <Fragment key={key}>
                        <TableRow>
                          <TableCell className={isDefault ? 'font-medium' : ''}>{row.label}</TableCell>
                          <TableCell>
                            <Select
                              value={row.type}
                              onValueChange={(v) => {
                                updateRow(key, { type: v as CommissionType })
                                if (v === 'fixed_pool_by_size' && row.serviceId) void loadSizesForService(row.serviceId)
                              }}
                            >
                              <SelectTrigger className="w-64">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {options.map((value) => (
                                  <SelectItem key={value} value={value}>
                                    {TYPE_LABELS[value]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            {isBySize ? (
                              <span className="text-xs text-muted-foreground">Set below</span>
                            ) : (
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                className="w-28"
                                value={row.rate}
                                onChange={(e) => updateRow(key, { rate: e.target.value })}
                                placeholder={row.type === 'percentage' ? '%' : row.type === 'points' ? 'pts' : '₱'}
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button size="sm" disabled={savingKey === key || (!isBySize && !row.rate)} onClick={() => saveRow(row)}>
                                Save
                              </Button>
                              {!isDefault && row.hasOwnRule && (
                                <Button size="sm" variant="ghost" onClick={() => removeOverride(row)}>
                                  Revert to default
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                        {isBySize && row.serviceId && (
                          <TableRow>
                            <TableCell colSpan={4} className="bg-muted/30">
                              <div className="flex flex-wrap items-end gap-3 py-1">
                                {vehicleSizes.map((size) => (
                                  <div key={size.id} className="flex flex-col gap-1.5">
                                    <Label className="text-xs">{size.name}</Label>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      className="w-24"
                                      placeholder="₱"
                                      value={sizeAmounts[row.serviceId!]?.[size.id] ?? ''}
                                      onChange={(e) =>
                                        setSizeAmounts((prev) => ({
                                          ...prev,
                                          [row.serviceId!]: { ...prev[row.serviceId!], [size.id]: e.target.value },
                                        }))
                                      }
                                    />
                                  </div>
                                ))}
                                <Button size="sm" disabled={savingSizesKey === row.serviceId} onClick={() => saveSizes(row)}>
                                  Save sizes
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    )
                  })
                })()}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function rowKey(row: RowState) {
  return row.serviceId ?? 'default'
}
