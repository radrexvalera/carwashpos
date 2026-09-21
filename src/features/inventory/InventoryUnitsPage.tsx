import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { createInventoryUnit, listInventoryUnits, type InventoryUnit } from './api/inventoryApi'

export function InventoryUnitsPage() {
  const { profile } = useTenant()
  const [units, setUnits] = useState<InventoryUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [abbreviation, setAbbreviation] = useState('')
  const [baseUnitId, setBaseUnitId] = useState<string>('none')
  const [conversionFactor, setConversionFactor] = useState('1')
  const [submitting, setSubmitting] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      setUnits(await listInventoryUnits())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load units')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const unitName = (id: string | null) => units.find((u) => u.id === id)?.name ?? '—'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!profile || !name.trim() || !abbreviation.trim()) return
    setSubmitting(true)
    try {
      await createInventoryUnit({
        tenantId: profile.tenantId,
        name: name.trim(),
        abbreviation: abbreviation.trim(),
        baseUnitId: baseUnitId === 'none' ? null : baseUnitId,
        conversionFactor: Number(conversionFactor) || 1,
      })
      setName('')
      setAbbreviation('')
      setBaseUnitId('none')
      setConversionFactor('1')
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create unit')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Units of Measure</h1>
        <p className="text-muted-foreground">
          A unit can optionally convert to a base unit (e.g. 1 Gallon = 3.785 Liters), so purchases
          and recipes can use whatever unit is natural.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a unit</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gallon" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Abbreviation</Label>
              <Input className="w-24" value={abbreviation} onChange={(e) => setAbbreviation(e.target.value)} placeholder="gal" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Converts to</Label>
              <Select value={baseUnitId} onValueChange={setBaseUnitId}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (base unit)</SelectItem>
                  {units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {baseUnitId !== 'none' && (
              <div className="flex flex-col gap-1.5">
                <Label>1 {name || 'unit'} =</Label>
                <Input
                  type="number"
                  step="0.0001"
                  className="w-28"
                  value={conversionFactor}
                  onChange={(e) => setConversionFactor(e.target.value)}
                />
              </div>
            )}
            <Button type="submit" disabled={submitting}>
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Abbreviation</TableHead>
                <TableHead>Conversion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.abbreviation}</TableCell>
                  <TableCell>
                    {row.base_unit_id ? `1 ${row.name} = ${row.conversion_factor} ${unitName(row.base_unit_id)}` : '—'}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && units.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No units yet.
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
