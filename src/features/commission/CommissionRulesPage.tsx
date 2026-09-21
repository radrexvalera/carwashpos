import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { listServices } from '@/features/catalog/api/catalogApi'
import { listCommissionRules, upsertCommissionRule } from './api/commissionApi'

type CommissionType = 'fixed_pool' | 'percentage' | 'fixed_per_attendant' | 'points'
type Basis = 'original_price' | 'discounted_price'

const TYPE_LABELS: Record<CommissionType, string> = {
  fixed_pool: 'Fixed pool (₱, split among crew)',
  percentage: '% of price (split among crew)',
  fixed_per_attendant: 'Fixed ₱ per attendant',
  points: 'Points per attendant',
}

interface RowState {
  serviceId: string | null
  label: string
  type: CommissionType
  rate: string
  basis: Basis
}

export function CommissionRulesPage() {
  const { profile } = useTenant()
  const [rows, setRows] = useState<RowState[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    try {
      const [servicesData, rulesData] = await Promise.all([listServices(), listCommissionRules()])

      const ruleFor = (serviceId: string | null) => rulesData.find((r) => r.service_id === serviceId)
      const defaultRule = ruleFor(null)
      const newRows: RowState[] = [
        {
          serviceId: null,
          label: 'Default (all other services)',
          type: (defaultRule?.commission_type as CommissionType) ?? 'fixed_pool',
          rate: defaultRule ? String(defaultRule.rate) : '',
          basis: (defaultRule?.basis as Basis) ?? 'discounted_price',
        },
        ...servicesData
          .filter((s) => s.is_active)
          .map((s) => {
            const r = ruleFor(s.id)
            return {
              serviceId: s.id,
              label: s.name,
              type: (r?.commission_type as CommissionType) ?? 'fixed_pool',
              rate: r ? String(r.rate) : '',
              basis: (r?.basis as Basis) ?? 'discounted_price',
            }
          }),
      ]
      setRows(newRows)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load commission rules')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Commission Rules</h1>
        <p className="text-muted-foreground">
          Set how much crew earn per service. A service without its own rule falls back to the
          default. Custom per-attendant splits are set at crew assignment time in the Register.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Basis</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const key = rowKey(row)
                  return (
                    <TableRow key={key}>
                      <TableCell className={row.serviceId === null ? 'font-medium' : ''}>{row.label}</TableCell>
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
                          placeholder={row.type === 'percentage' ? '%' : '₱'}
                        />
                      </TableCell>
                      <TableCell>
                        {row.type === 'percentage' && (
                          <Select value={row.basis} onValueChange={(v) => updateRow(key, { basis: v as Basis })}>
                            <SelectTrigger className="w-44">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="discounted_price">Discounted price</SelectItem>
                              <SelectItem value="original_price">Original price</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" disabled={savingKey === key || !row.rate} onClick={() => saveRow(row)}>
                          Save
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
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
