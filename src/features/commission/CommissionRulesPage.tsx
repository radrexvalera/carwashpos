import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { listServices } from '@/features/catalog/api/catalogApi'
import { getSettings, updateSettings } from '@/features/settings/api/settingsApi'
import { deleteCommissionRule, listCommissionRules, upsertCommissionRule } from './api/commissionApi'

type CommissionType = 'fixed_pool' | 'percentage' | 'fixed_per_attendant' | 'points'
type Basis = 'original_price' | 'discounted_price'

// 'percentage' is no longer selectable here -- crew commission on a job's regular carwash/other
// services is now the job-composition policy below, applied automatically at job completion.
// These per-service types are for extra bonuses on top of that (e.g. a fixed pool for a specific
// premium add-on), not the main commission mechanism anymore.
const TYPE_LABELS: Record<Exclude<CommissionType, 'percentage'>, string> = {
  fixed_pool: 'Fixed pool (₱, split among crew)',
  fixed_per_attendant: 'Fixed ₱ per attendant',
  points: 'Points per attendant',
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

function describeRule(type: CommissionType, rate: string) {
  if (!rate) return 'No bonus configured'
  if (type === 'percentage') return `${rate}% (legacy, no longer applied)`
  const unit = type === 'points' ? `${rate} pts` : `₱${rate}`
  return `${TYPE_LABELS[type as Exclude<CommissionType, 'percentage'>] ?? type} — ${unit}`
}

export function CommissionRulesPage() {
  const { profile } = useTenant()
  const [rows, setRows] = useState<RowState[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [overridingKeys, setOverridingKeys] = useState<Set<string>>(new Set())

  const [carwashRate, setCarwashRate] = useState('')
  const [otherRate, setOtherRate] = useState('')
  const [savingPolicy, setSavingPolicy] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      const [servicesData, rulesData, settings] = await Promise.all([
        listServices(),
        listCommissionRules(),
        profile ? getSettings(profile.tenantId) : Promise.resolve(null),
      ])

      if (settings) {
        setCarwashRate(String(settings.carwash_commission_rate))
        setOtherRate(String(settings.other_commission_rate))
      }

      const ruleFor = (serviceId: string | null) => rulesData.find((r) => r.service_id === serviceId)
      // A legacy 'percentage' rule from before this rule type was retired displays as an unset
      // fixed pool rather than a dead selection -- the manager has to consciously pick a new
      // method and rate rather than accidentally re-saving a now-meaningless percentage as one.
      const displayType = (type: string | undefined): CommissionType => (type && type !== 'percentage' ? (type as CommissionType) : 'fixed_pool')
      const displayRate = (r: { commission_type: string; rate: number } | undefined) => (r && r.commission_type !== 'percentage' ? String(r.rate) : '')

      const defaultRule = ruleFor(null)
      const newRows: RowState[] = [
        {
          serviceId: null,
          ruleId: defaultRule?.id ?? null,
          hasOwnRule: true,
          label: 'Default (all other services)',
          type: displayType(defaultRule?.commission_type),
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
              type: displayType(r?.commission_type),
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load commission rules')
    } finally {
      setLoading(false)
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
    const rate = Number(row.rate)
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Commission Rules</h1>
        <p className="text-muted-foreground">
          Crew commission on regular services is set by the policy below, based on job composition. The per-service
          table further down is only for extra bonuses on specific services, on top of that.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Commission policy</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            When a job is completed, its total revenue earns one of these rates, split evenly among every crew member
            assigned anywhere on the job. Which services count as "carwash" is set per category on the Service
            Categories page.
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
          <CardTitle className="text-base">Per-service bonuses</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
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

                    return (
                      <TableRow key={key}>
                        <TableCell className={isDefault ? 'font-medium' : ''}>{row.label}</TableCell>
                        <TableCell>
                          <Select value={row.type} onValueChange={(v) => updateRow(key, { type: v as CommissionType })}>
                            <SelectTrigger className="w-64">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            className="w-28"
                            value={row.rate}
                            onChange={(e) => updateRow(key, { rate: e.target.value })}
                            placeholder="₱"
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button size="sm" disabled={savingKey === key || !row.rate} onClick={() => saveRow(row)}>
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
