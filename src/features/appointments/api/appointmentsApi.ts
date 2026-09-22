import { supabase } from '@/lib/supabase/client'
import type { Database, Json } from '@/lib/supabase/types'

export type Appointment = Database['public']['Tables']['appointments']['Row']

export interface AppointmentWithDetails extends Appointment {
  plateNumber: string
  customerName: string | null
  services: { serviceId: string; serviceName: string }[]
}

// Appointments are an inherently online, ahead-of-time administrative action -- unlike the job
// board, there's no offline-outbox need here (matches how Promotions/Fleet/Membership admin
// actions all work purely online too).
export async function listAppointmentsForDate(date: string): Promise<AppointmentWithDetails[]> {
  const dayStart = new Date(`${date}T00:00:00`).toISOString()
  const dayEnd = new Date(`${date}T23:59:59`).toISOString()

  const { data: appointments, error } = await supabase
    .from('appointments')
    .select('*')
    .gte('scheduled_at', dayStart)
    .lte('scheduled_at', dayEnd)
    .order('scheduled_at', { ascending: true })
  if (error) throw error
  if (!appointments || appointments.length === 0) return []

  const vehicleIds = [...new Set(appointments.map((a) => a.vehicle_id))]
  const { data: vehicles, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, plate_number, customer_id')
    .in('id', vehicleIds)
  if (vehicleError) throw vehicleError

  const customerIds = [...new Set((vehicles ?? []).map((v) => v.customer_id).filter((id): id is string => !!id))]
  const { data: customers, error: customerError } = customerIds.length
    ? await supabase.from('customers').select('id, full_name').in('id', customerIds)
    : { data: [] as { id: string; full_name: string }[], error: null }
  if (customerError) throw customerError

  const { data: apptServices, error: servicesError } = await supabase
    .from('appointment_services')
    .select('appointment_id, service_id')
    .in('appointment_id', appointments.map((a) => a.id))
  if (servicesError) throw servicesError

  const serviceIds = [...new Set((apptServices ?? []).map((s) => s.service_id))]
  const { data: services, error: serviceLookupError } = serviceIds.length
    ? await supabase.from('services').select('id, name').in('id', serviceIds)
    : { data: [] as { id: string; name: string }[], error: null }
  if (serviceLookupError) throw serviceLookupError

  const plateByVehicle = new Map((vehicles ?? []).map((v) => [v.id, v.plate_number]))
  const customerIdByVehicle = new Map((vehicles ?? []).map((v) => [v.id, v.customer_id]))
  const nameByCustomer = new Map((customers ?? []).map((c) => [c.id, c.full_name]))
  const nameByService = new Map((services ?? []).map((s) => [s.id, s.name]))
  const servicesByAppointment = new Map<string, { serviceId: string; serviceName: string }[]>()
  for (const link of apptServices ?? []) {
    const list = servicesByAppointment.get(link.appointment_id) ?? []
    list.push({ serviceId: link.service_id, serviceName: nameByService.get(link.service_id) ?? 'Service' })
    servicesByAppointment.set(link.appointment_id, list)
  }

  return appointments.map((a) => {
    const customerId = customerIdByVehicle.get(a.vehicle_id)
    return {
      ...a,
      plateNumber: plateByVehicle.get(a.vehicle_id) ?? '—',
      customerName: customerId ? (nameByCustomer.get(customerId) ?? null) : null,
      services: servicesByAppointment.get(a.id) ?? [],
    }
  })
}

export interface CreateAppointmentInput {
  tenantId: string
  locationId: string
  vehicleId: string
  vehicleSizeId: string
  scheduledAt: string
  notes?: string
  serviceIds: string[]
}

export async function createAppointment(input: CreateAppointmentInput) {
  const { data, error } = await supabase
    .from('appointments')
    .insert({
      tenant_id: input.tenantId,
      location_id: input.locationId,
      vehicle_id: input.vehicleId,
      vehicle_size_id: input.vehicleSizeId,
      scheduled_at: input.scheduledAt,
      notes: input.notes || null,
    })
    .select('id')
    .single()
  if (error) throw error

  const { error: linkError } = await supabase
    .from('appointment_services')
    .insert(input.serviceIds.map((serviceId) => ({ tenant_id: input.tenantId, appointment_id: data.id, service_id: serviceId })))
  if (linkError) throw linkError

  return data.id as string
}

export async function cancelAppointment(id: string) {
  const { error } = await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', id)
  if (error) throw error
}

export async function markNoShow(id: string) {
  const { error } = await supabase.from('appointments').update({ status: 'no_show' }).eq('id', id)
  if (error) throw error
}

export interface CheckInInput {
  appointmentId: string
  vehicleId: string
  vehicleSizeId: string
  services: { serviceId: string; attendantEmployeeIds: string[] }[]
}

// Reuses the existing create_job() RPC rather than duplicating its pricing/numbering/idempotency
// logic -- this is a plain online call, not routed through the offline mutation queue (booking
// ahead of time is inherently an online action, same as every other Phase 6 admin flow).
export async function checkInAppointment(input: CheckInInput) {
  const payload = {
    client_generated_id: crypto.randomUUID(),
    vehicle_id: input.vehicleId,
    vehicle_size_id: input.vehicleSizeId,
    services: input.services.map((s) => ({ service_id: s.serviceId, attendant_employee_ids: s.attendantEmployeeIds })),
  }

  const { data, error } = await supabase.rpc('create_job', { payload: payload as unknown as Json })
  if (error) throw error
  const job = data as { id: string; job_number: string }

  const { error: updateError } = await supabase
    .from('appointments')
    .update({ status: 'converted', converted_job_id: job.id })
    .eq('id', input.appointmentId)
  if (updateError) throw updateError

  return job
}
