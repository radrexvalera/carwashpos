import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { listServices, listVehicleSizes, listLocations } from '@/features/catalog/api/catalogApi'
import { listEmployees } from '@/features/employees/api/employeesApi'
import { createCustomer, createVehicle, searchVehicles } from '@/features/vehicles/api/vehiclesApi'
import { EditVehicleDialog } from '@/features/vehicles/EditVehicleDialog'
import {
  cancelAppointment,
  checkInAppointment,
  createAppointment,
  listAppointmentsForDate,
  markNoShow,
  type AppointmentWithDetails,
} from './api/appointmentsApi'

type Service = { id: string; name: string }
type VehicleSize = { id: string; name: string }
type Employee = { id: string; full_name: string; nickname: string | null }
type VehicleMatch = { id: string; plate_number: string; vehicle_size_id: string | null; customerName: string | null }

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  converted: 'Checked in',
  cancelled: 'Cancelled',
  no_show: 'No-show',
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

export function AppointmentsPage() {
  const { profile } = useTenant()
  const navigate = useNavigate()

  const [date, setDate] = useState(today())
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [services, setServices] = useState<Service[]>([])
  const [vehicleSizes, setVehicleSizes] = useState<VehicleSize[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [locationId, setLocationId] = useState('')

  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [plateQuery, setPlateQuery] = useState('')
  const [matches, setMatches] = useState<VehicleMatch[]>([])
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleMatch | null>(null)
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null)
  const [showNewVehicleForm, setShowNewVehicleForm] = useState(false)
  const [newMake, setNewMake] = useState('')
  const [newModel, setNewModel] = useState('')
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerMobile, setNewCustomerMobile] = useState('')
  const [vehicleSizeId, setVehicleSizeId] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [notes, setNotes] = useState('')

  const [checkInTarget, setCheckInTarget] = useState<AppointmentWithDetails | null>(null)
  const [crewAssignments, setCrewAssignments] = useState<Record<string, string[]>>({})

  async function reload() {
    setLoading(true)
    try {
      setAppointments(await listAppointmentsForDate(date))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load appointments')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  useEffect(() => {
    Promise.all([listServices(), listVehicleSizes(), listEmployees(), listLocations()])
      .then(([s, vs, e, locs]) => {
        setServices((s ?? []).filter((x) => x.is_active).map((x) => ({ id: x.id, name: x.name })))
        setVehicleSizes((vs ?? []).filter((x) => x.is_active).map((x) => ({ id: x.id, name: x.name })))
        setEmployees((e ?? []).filter((x) => x.active).map((x) => ({ id: x.id, full_name: x.full_name, nickname: x.nickname })))
        setLocationId(locs?.[0]?.id ?? '')
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load catalog data'))
  }, [])

  function resetDialog() {
    setPlateQuery('')
    setMatches([])
    setSelectedVehicle(null)
    setShowNewVehicleForm(false)
    setNewMake('')
    setNewModel('')
    setNewCustomerName('')
    setNewCustomerMobile('')
    setVehicleSizeId('')
    setScheduledTime('')
    setSelectedServiceIds([])
    setNotes('')
  }

  async function runVehicleSearch(q: string) {
    setPlateQuery(q)
    setSelectedVehicle(null)
    if (!q.trim()) {
      setMatches([])
      return
    }
    try {
      setMatches((await searchVehicles(q)) as VehicleMatch[])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Search failed')
    }
  }

  function pickVehicle(v: VehicleMatch) {
    setSelectedVehicle(v)
    setPlateQuery(v.plate_number)
    setMatches([])
    setShowNewVehicleForm(false)
    if (v.vehicle_size_id) setVehicleSizeId(v.vehicle_size_id)
  }

  async function handleCreateVehicle() {
    if (!profile || !plateQuery.trim()) return
    setSubmitting(true)
    try {
      let customerId: string | null = null
      if (newCustomerName.trim()) {
        customerId = await createCustomer({ tenantId: profile.tenantId, fullName: newCustomerName.trim(), mobile: newCustomerMobile.trim() || null })
      }
      const vehicleId = await createVehicle({
        tenantId: profile.tenantId,
        customerId,
        plateNumber: plateQuery.trim().toUpperCase(),
        make: newMake.trim() || null,
        model: newModel.trim() || null,
        color: null,
        vehicleType: null,
        vehicleSizeId: vehicleSizeId || null,
      })
      pickVehicle({
        id: vehicleId,
        plate_number: plateQuery.trim().toUpperCase(),
        vehicle_size_id: vehicleSizeId || null,
        customerName: newCustomerName.trim() || null,
      })
      toast.success('Vehicle added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add vehicle')
    } finally {
      setSubmitting(false)
    }
  }

  function toggleService(id: string) {
    setSelectedServiceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
  }

  async function handleCreateAppointment() {
    if (!profile || !selectedVehicle || !vehicleSizeId || !scheduledTime || selectedServiceIds.length === 0) return
    setSubmitting(true)
    try {
      await createAppointment({
        tenantId: profile.tenantId,
        locationId,
        vehicleId: selectedVehicle.id,
        vehicleSizeId,
        scheduledAt: new Date(scheduledTime).toISOString(),
        notes: notes.trim() || undefined,
        serviceIds: selectedServiceIds,
      })
      toast.success('Appointment booked')
      setOpen(false)
      resetDialog()
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to book appointment')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel(appt: AppointmentWithDetails) {
    try {
      await cancelAppointment(appt.id)
      toast.success('Appointment cancelled')
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel')
    }
  }

  async function handleNoShow(appt: AppointmentWithDetails) {
    try {
      await markNoShow(appt.id)
      toast.success('Marked as no-show')
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update')
    }
  }

  function openCheckIn(appt: AppointmentWithDetails) {
    setCheckInTarget(appt)
    setCrewAssignments({})
  }

  function toggleCrew(serviceId: string, employeeId: string) {
    setCrewAssignments((prev) => {
      const current = prev[serviceId] ?? []
      return {
        ...prev,
        [serviceId]: current.includes(employeeId) ? current.filter((id) => id !== employeeId) : [...current, employeeId],
      }
    })
  }

  async function submitCheckIn() {
    if (!checkInTarget) return
    setSubmitting(true)
    try {
      await checkInAppointment({
        appointmentId: checkInTarget.id,
        vehicleId: checkInTarget.vehicle_id,
        vehicleSizeId: checkInTarget.vehicle_size_id,
        services: checkInTarget.services.map((s) => ({ serviceId: s.serviceId, attendantEmployeeIds: crewAssignments[s.serviceId] ?? [] })),
      })
      toast.success('Checked in')
      setCheckInTarget(null)
      navigate('/jobs')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to check in')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Appointments</h1>
          <p className="text-muted-foreground">Bookings made ahead of time — check one in when the vehicle arrives.</p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o)
            if (!o) resetDialog()
          }}
        >
          <DialogTrigger asChild>
            <Button>New appointment</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>New appointment</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Vehicle</Label>
                <Input placeholder="Search plate number…" value={plateQuery} onChange={(e) => runVehicleSearch(e.target.value)} />
                {!selectedVehicle && matches.length > 0 && (
                  <div className="flex flex-col gap-1 rounded-md border p-2">
                    {matches.map((v) => (
                      <button
                        key={v.id}
                        className="flex justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                        onClick={() => pickVehicle(v)}
                      >
                        <span className="font-medium">{v.plate_number}</span>
                        <span className="text-muted-foreground">{v.customerName ?? '—'}</span>
                      </button>
                    ))}
                  </div>
                )}
                {!selectedVehicle && plateQuery.trim() && matches.length === 0 && (
                  <Button variant="outline" size="sm" onClick={() => setShowNewVehicleForm(true)}>
                    No match — add "{plateQuery.trim().toUpperCase()}" as a new vehicle
                  </Button>
                )}
                {selectedVehicle && (
                  <div className="flex items-center justify-between rounded-md border bg-accent/40 p-2">
                    <span className="text-sm font-medium">{selectedVehicle.plate_number}</span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditingVehicleId(selectedVehicle.id)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => runVehicleSearch('')}>
                        Change
                      </Button>
                    </div>
                  </div>
                )}
                {showNewVehicleForm && !selectedVehicle && (
                  <div className="flex flex-col gap-2 rounded-md border p-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Input placeholder="Make" value={newMake} onChange={(e) => setNewMake(e.target.value)} />
                      <Input placeholder="Model" value={newModel} onChange={(e) => setNewModel(e.target.value)} />
                      <Input placeholder="Customer name (optional)" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} />
                      <Input placeholder="Mobile (optional)" value={newCustomerMobile} onChange={(e) => setNewCustomerMobile(e.target.value)} />
                    </div>
                    <Button size="sm" disabled={submitting} onClick={handleCreateVehicle}>
                      Add vehicle
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Vehicle size</Label>
                <Select value={vehicleSizeId} onValueChange={setVehicleSizeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select size" />
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

              <div className="flex flex-col gap-1.5">
                <Label>Date & time</Label>
                <Input type="datetime-local" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Requested services</Label>
                <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-md border p-2">
                  {services.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={selectedServiceIds.includes(s.id)} onCheckedChange={() => toggleService(s.id)} />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Notes (optional)</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              <Button
                onClick={handleCreateAppointment}
                disabled={submitting || !selectedVehicle || !vehicleSizeId || !scheduledTime || selectedServiceIds.length === 0}
              >
                Book appointment
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-1.5">
            <Label>Date</Label>
            <Input type="date" className="w-48" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {appointments.map((appt) => (
            <div key={appt.id} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {new Date(appt.scheduled_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <span className="font-medium">{appt.plateNumber}</span>
                  {appt.customerName && <span className="text-sm text-muted-foreground">{appt.customerName}</span>}
                  <Badge variant={appt.status === 'scheduled' ? 'outline' : 'secondary'}>{STATUS_LABELS[appt.status]}</Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  {appt.services.map((s) => (
                    <Badge key={s.serviceId} variant="outline" className="text-xs">
                      {s.serviceName}
                    </Badge>
                  ))}
                </div>
                {appt.notes && <p className="text-xs text-muted-foreground">{appt.notes}</p>}
              </div>
              {appt.status === 'scheduled' && (
                <div className="flex flex-wrap shrink-0 gap-2">
                  <Dialog open={checkInTarget?.id === appt.id} onOpenChange={(o) => !o && setCheckInTarget(null)}>
                    <DialogTrigger asChild>
                      <Button size="sm" onClick={() => openCheckIn(appt)}>
                        Check in
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Check in — {appt.plateNumber}</DialogTitle>
                      </DialogHeader>
                      <div className="flex flex-col gap-3">
                        {checkInTarget?.services.map((s) => (
                          <div key={s.serviceId} className="flex flex-col gap-1.5 rounded-md border p-2">
                            <span className="text-sm font-medium">{s.serviceName}</span>
                            <div className="flex flex-wrap gap-1">
                              {employees.map((e) => (
                                <Badge
                                  key={e.id}
                                  variant={(crewAssignments[s.serviceId] ?? []).includes(e.id) ? 'default' : 'outline'}
                                  className="cursor-pointer"
                                  onClick={() => toggleCrew(s.serviceId, e.id)}
                                >
                                  {e.nickname || e.full_name}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ))}
                        <Button disabled={submitting} onClick={submitCheckIn}>
                          Create job
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                  <Button size="sm" variant="outline" onClick={() => handleNoShow(appt)}>
                    No-show
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleCancel(appt)}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          ))}
          {!loading && appointments.length === 0 && <p className="text-center text-muted-foreground">No appointments this day.</p>}
        </CardContent>
      </Card>
    </div>

    <EditVehicleDialog
      vehicleId={editingVehicleId}
      sizes={vehicleSizes}
      onOpenChange={(open) => !open && setEditingVehicleId(null)}
      onSaved={(updated) => {
        if (!selectedVehicle) return
        setSelectedVehicle({ ...selectedVehicle, plate_number: updated.plateNumber, vehicle_size_id: updated.vehicleSizeId })
        setPlateQuery(updated.plateNumber)
        setVehicleSizeId(updated.vehicleSizeId || '')
      }}
    />
    </>
  )
}
