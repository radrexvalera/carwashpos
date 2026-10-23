import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Search, Trash2 } from 'lucide-react'
import { useTenant } from '@/app/TenantProvider'
import { db } from '@/lib/db/dexie'
import { formatMoney } from '@/lib/money'
import { useOnlineStatus } from '@/lib/offline/useOnlineStatus'
import { safeGetItem, safeSetItem } from '@/lib/safeStorage'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Database } from '@/lib/supabase/types'
import type { LocalJobServiceLine } from '@/lib/offline/types'
import { createCustomer, createVehicle } from '@/features/vehicles/api/vehiclesApi'
import { EditVehicleDialog } from '@/features/vehicles/EditVehicleDialog'
import { getActiveShift } from '@/features/shifts/api/shiftsApi'
import { createJobOffline } from './api/jobMutations'

type VehicleRow = Database['public']['Tables']['vehicles']['Row']

export function RegisterPage() {
  const { profile } = useTenant()
  const navigate = useNavigate()

  const sizes = useLiveQuery(
    () => db.vehicleSizes.where('tenant_id').equals(profile?.tenantId ?? '').and((s) => s.is_active).sortBy('sort_order'),
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
  const employees = useLiveQuery(
    () => db.employees.where('tenant_id').equals(profile?.tenantId ?? '').and((e) => e.active).toArray(),
    [profile?.tenantId],
    [],
  )

  const [plateQuery, setPlateQuery] = useState('')
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleRow | null>(null)
  const [showNewVehicleForm, setShowNewVehicleForm] = useState(false)
  const [newPlate, setNewPlate] = useState('')
  const [newMake, setNewMake] = useState('')
  const [newModel, setNewModel] = useState('')
  const [newColor, setNewColor] = useState('')
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerMobile, setNewCustomerMobile] = useState('')
  const [creatingVehicle, setCreatingVehicle] = useState(false)
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null)

  const [sizeId, setSizeId] = useState('')
  const [lines, setLines] = useState<LocalJobServiceLine[]>([])
  const [submitting, setSubmitting] = useState(false)

  // Shift status is online-only data (no Dexie cache) -- this page is otherwise fully offline-
  // capable, so genuinely being offline must NOT hard-block job creation here (that would break
  // the one thing this page is explicitly designed to still do with no connection). Only an
  // ONLINE, confirmed "no open shift" blocks. The last confirmed state is cached per-user so a
  // shift opened earlier today still reads as open if connectivity drops later in the same shift.
  const online = useOnlineStatus()
  const [shiftCheckDone, setShiftCheckDone] = useState(false)
  const [hasOpenShift, setHasOpenShift] = useState(false)
  const shiftCacheKey = profile ? `hasOpenShift:${profile.id}` : null

  useEffect(() => {
    if (!profile) return
    if (!online) {
      setHasOpenShift(shiftCacheKey ? safeGetItem(shiftCacheKey) === 'true' : false)
      setShiftCheckDone(true)
      return
    }
    getActiveShift()
      .then((shift) => {
        const open = !!shift
        setHasOpenShift(open)
        if (shiftCacheKey) safeSetItem(shiftCacheKey, open ? 'true' : 'false')
      })
      .catch(() => {
        // Couldn't verify (e.g. a request that failed despite navigator.onLine saying we're
        // online) -- fall back to the last confirmed state rather than hard-blocking on a check
        // that itself didn't succeed.
        setHasOpenShift(shiftCacheKey ? safeGetItem(shiftCacheKey) === 'true' : false)
      })
      .finally(() => setShiftCheckDone(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, online])

  const matches = useLiveQuery<VehicleRow[], VehicleRow[]>(
    () =>
      plateQuery.trim().length > 0
        ? db.vehicles
            .where('tenant_id')
            .equals(profile?.tenantId ?? '')
            .filter((v) => v.plate_number.toLowerCase().includes(plateQuery.trim().toLowerCase()))
            .limit(8)
            .toArray()
        : Promise.resolve([]),
    [plateQuery, profile?.tenantId],
    [],
  )

  const effectiveSizeId = sizeId || selectedVehicle?.vehicle_size_id || sizes?.[0]?.id || ''

  const priceFor = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of servicePrices ?? []) {
      if (p.is_active) map.set(`${p.service_id}:${p.vehicle_size_id}`, p.price)
    }
    return map
  }, [servicePrices])

  function priceForService(service: Database['public']['Tables']['services']['Row']) {
    if (service.pricing_type === 'matrix') return priceFor.get(`${service.id}:${effectiveSizeId}`)
    return service.flat_price ?? undefined
  }

  function selectVehicle(v: VehicleRow) {
    setSelectedVehicle(v)
    setPlateQuery(v.plate_number)
    setShowNewVehicleForm(false)
    // Reset to this vehicle's own saved size -- otherwise a size picked earlier for a different
    // vehicle this session would win over this vehicle's actual saved size (sizeId, once set,
    // takes priority in effectiveSizeId's fallback chain regardless of which vehicle it was for).
    setSizeId(v.vehicle_size_id || '')
  }

  async function handleCreateVehicle() {
    const effectivePlate = (newPlate || plateQuery).trim()
    if (!profile || !effectivePlate) return
    setCreatingVehicle(true)
    try {
      let customerId: string | null = null
      if (newCustomerName.trim()) {
        customerId = await createCustomer({
          tenantId: profile.tenantId,
          fullName: newCustomerName.trim(),
          mobile: newCustomerMobile.trim() || null,
        })
      }
      const vehicleId = await createVehicle({
        tenantId: profile.tenantId,
        customerId,
        plateNumber: effectivePlate.toUpperCase(),
        make: newMake.trim() || null,
        model: newModel.trim() || null,
        color: newColor.trim() || null,
        vehicleType: null,
        vehicleSizeId: sizeId || null,
      })
      const vehicle: VehicleRow = {
        id: vehicleId,
        tenant_id: profile.tenantId,
        customer_id: customerId,
        plate_number: effectivePlate.toUpperCase(),
        make: newMake.trim() || null,
        model: newModel.trim() || null,
        year: null,
        color: newColor.trim() || null,
        vehicle_type: null,
        vehicle_size_id: sizeId || null,
        notes: null,
        is_active: true,
        created_at: new Date().toISOString(),
      }
      await db.vehicles.put(vehicle)
      selectVehicle(vehicle)
      toast.success('Vehicle added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add vehicle')
    } finally {
      setCreatingVehicle(false)
    }
  }

  function addServiceLine(service: Database['public']['Tables']['services']['Row']) {
    const price = priceForService(service)
    if (price === undefined) {
      toast.error('No price set for this service at this vehicle size')
      return
    }
    setLines((prev) => [
      ...prev,
      {
        serviceId: service.id,
        serviceName: service.name,
        unitPrice: price,
        quantity: 1,
        lineTotal: price,
        attendantEmployeeIds: [],
        attendantNames: [],
      },
    ])
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  function toggleAttendant(index: number, employeeId: string, employeeName: string) {
    setLines((prev) => {
      const next = [...prev]
      const line = next[index]
      const has = line.attendantEmployeeIds.includes(employeeId)
      next[index] = {
        ...line,
        attendantEmployeeIds: has
          ? line.attendantEmployeeIds.filter((id) => id !== employeeId)
          : [...line.attendantEmployeeIds, employeeId],
        attendantNames: has ? line.attendantNames.filter((n) => n !== employeeName) : [...line.attendantNames, employeeName],
      }
      return next
    })
  }

  function assignAllTo(employeeId: string, employeeName: string) {
    setLines((prev) =>
      prev.map((line) =>
        line.attendantEmployeeIds.includes(employeeId)
          ? line
          : {
              ...line,
              attendantEmployeeIds: [...line.attendantEmployeeIds, employeeId],
              attendantNames: [...line.attendantNames, employeeName],
            },
      ),
    )
  }

  const estimatedTotal = lines.reduce((sum, l) => sum + l.lineTotal, 0)

  async function handleCreateJob() {
    if (!profile || !selectedVehicle || lines.length === 0) return
    setSubmitting(true)
    try {
      const sizeName = sizes?.find((s) => s.id === effectiveSizeId)?.name ?? ''
      await createJobOffline({
        tenantId: profile.tenantId,
        vehicleId: selectedVehicle.id,
        vehiclePlate: selectedVehicle.plate_number,
        vehicleMake: selectedVehicle.make,
        vehicleModel: selectedVehicle.model,
        vehicleSizeId: effectiveSizeId,
        vehicleSizeName: sizeName,
        services: lines,
      })
      toast.success('Job created')
      setSelectedVehicle(null)
      setPlateQuery('')
      setLines([])
      navigate('/jobs')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create job')
    } finally {
      setSubmitting(false)
    }
  }

  if (shiftCheckDone && online && !hasOpenShift) {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="mb-4 text-muted-foreground">You need an open shift before creating a job.</p>
            <Button onClick={() => navigate('/shift')}>Open a shift</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <>
    <div className="grid grid-cols-1 gap-6 pb-28 lg:grid-cols-[1fr_360px] lg:pb-0">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Register</h1>
          <p className="text-muted-foreground">Search a plate, pick services, assign crew, create the job. Works offline.</p>
        </div>

        <Card id="tour-register-vehicle">
          <CardHeader>
            <CardTitle>Vehicle</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search plate number…"
                value={plateQuery}
                onChange={(e) => {
                  setPlateQuery(e.target.value)
                  setSelectedVehicle(null)
                }}
              />
            </div>

            {!selectedVehicle && plateQuery.trim() && (
              <div className="flex flex-col gap-1">
                {(matches ?? []).map((v) => (
                  <button
                    key={v.id}
                    className="flex items-center justify-between rounded-md border p-2 text-left text-sm hover:bg-accent"
                    onClick={() => selectVehicle(v)}
                  >
                    <span className="font-medium">{v.plate_number}</span>
                    <span className="text-muted-foreground">
                      {v.make} {v.model}
                    </span>
                  </button>
                ))}
                {(matches ?? []).length === 0 && (
                  <Button variant="outline" onClick={() => setShowNewVehicleForm(true)}>
                    No match — add "{plateQuery.trim().toUpperCase()}" as a new vehicle
                  </Button>
                )}
              </div>
            )}

            {selectedVehicle && (
              <div className="flex items-center justify-between rounded-md border bg-accent/40 p-3">
                <div>
                  <div className="font-medium">{selectedVehicle.plate_number}</div>
                  <div className="text-sm text-muted-foreground">
                    {selectedVehicle.make} {selectedVehicle.model}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditingVehicleId(selectedVehicle.id)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedVehicle(null)
                      setPlateQuery('')
                    }}
                  >
                    Change
                  </Button>
                </div>
              </div>
            )}

            {showNewVehicleForm && !selectedVehicle && (
              <div className="flex flex-col gap-2 rounded-md border p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <Label>Plate</Label>
                    <Input value={newPlate || plateQuery} onChange={(e) => setNewPlate(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Color</Label>
                    <Input value={newColor} onChange={(e) => setNewColor(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Make</Label>
                    <Input value={newMake} onChange={(e) => setNewMake(e.target.value)} placeholder="Toyota" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Model</Label>
                    <Input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder="Fortuner" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Vehicle size</Label>
                    <Select value={sizeId} onValueChange={setSizeId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select size" />
                      </SelectTrigger>
                      <SelectContent>
                        {(sizes ?? []).map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Customer name (optional)</Label>
                    <Input value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Mobile (optional)</Label>
                    <Input value={newCustomerMobile} onChange={(e) => setNewCustomerMobile(e.target.value)} />
                  </div>
                </div>
                <Button disabled={creatingVehicle || !(newPlate || plateQuery).trim()} onClick={handleCreateVehicle}>
                  Add vehicle
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vehicle size</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={effectiveSizeId} onValueChange={setSizeId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select vehicle size" />
              </SelectTrigger>
              <SelectContent>
                {(sizes ?? []).map((s) => (
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
            <CardTitle>Services</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(services ?? []).length === 0 && <p className="text-muted-foreground">No services set up yet.</p>}
            {(services ?? []).map((s) => {
              const price = priceForService(s)
              return (
                <Button
                  key={s.id}
                  variant="outline"
                  className="h-auto flex-col items-start gap-1 py-3"
                  disabled={price === undefined}
                  onClick={() => addServiceLine(s)}
                >
                  <span>{s.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {price !== undefined ? formatMoney(price) : 'No price for this size'}
                  </span>
                </Button>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Job</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {lines.length === 0 && <p className="text-muted-foreground">No services added yet.</p>}
            {lines.map((line, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{line.serviceName}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{formatMoney(line.lineTotal)}</span>
                    <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => removeLine(i)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-xs text-muted-foreground">Crew:</span>
                  {(employees ?? []).map((e) => (
                    <Badge
                      key={e.id}
                      variant={line.attendantEmployeeIds.includes(e.id) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => toggleAttendant(i, e.id, e.full_name)}
                    >
                      {e.nickname || e.full_name}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
            {lines.length > 0 && (employees ?? []).length > 0 && (
              <div className="flex flex-wrap items-center gap-1 border-t pt-2">
                <span className="text-xs text-muted-foreground">Assign to all:</span>
                {(employees ?? []).map((e) => (
                  <Badge key={e.id} variant="secondary" className="cursor-pointer" onClick={() => assignAllTo(e.id, e.full_name)}>
                    + {e.nickname || e.full_name}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit lg:sticky lg:top-6">
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex justify-between text-lg font-semibold">
            <span>Estimated total</span>
            <span>{formatMoney(estimatedTotal)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Payment is collected separately from the Job Queue once the vehicle is in — this only creates the job.
          </p>
          <Button
            size="lg"
            disabled={!selectedVehicle || lines.length === 0 || submitting}
            onClick={handleCreateJob}
          >
            Create job
          </Button>
        </CardContent>
      </Card>
    </div>

    {/* Tablet/phone only -- on the lg sidebar layout the Summary card above is already visible
        without scrolling, so this would just duplicate it. Below lg, the service list can run
        long enough that the total + Create button would otherwise require scrolling back up.
        Sits just above AppShell's own bottom nav bar (h-16), not at bottom-0, so the two don't
        overlap. */}
    <div className="fixed inset-x-0 bottom-16 z-40 flex items-center justify-between gap-3 border-t bg-background p-3 lg:hidden">
      <div>
        <div className="text-xs text-muted-foreground">Estimated total</div>
        <div className="text-lg font-semibold">{formatMoney(estimatedTotal)}</div>
      </div>
      <Button size="lg" disabled={!selectedVehicle || lines.length === 0 || submitting} onClick={handleCreateJob}>
        Create job
      </Button>
    </div>

    <EditVehicleDialog
      vehicleId={editingVehicleId}
      sizes={sizes ?? []}
      onOpenChange={(open) => !open && setEditingVehicleId(null)}
      onSaved={(updated) => {
        if (!selectedVehicle) return
        const patched: VehicleRow = {
          ...selectedVehicle,
          plate_number: updated.plateNumber,
          make: updated.make,
          model: updated.model,
          color: updated.color,
          vehicle_size_id: updated.vehicleSizeId,
        }
        setSelectedVehicle(patched)
        setPlateQuery(updated.plateNumber)
        setSizeId(updated.vehicleSizeId || '')
        db.vehicles.put(patched)
      }}
    />
    </>
  )
}
