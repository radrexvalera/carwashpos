import { db } from '@/lib/db/dexie'
import { flushMutationQueue } from '@/lib/offline/syncEngine'
import type { LocalJob, LocalJobServiceLine } from '@/lib/offline/types'

interface CreateJobInput {
  tenantId: string
  vehicleId: string
  vehiclePlate: string
  vehicleMake: string | null
  vehicleModel: string | null
  vehicleSizeId: string
  vehicleSizeName: string
  services: LocalJobServiceLine[]
}

// Same "always write local + enqueue, then kick a flush" pattern as the old ticket POS: one code
// path regardless of connectivity. Vehicle creation/lookup happens before this is called (a plain
// insert/select against vehicles), so this only ever turns an existing vehicle into a job.
export async function createJobOffline(input: CreateJobInput) {
  const clientGeneratedId = crypto.randomUUID()
  const estimatedTotal = input.services.reduce((sum, s) => sum + s.lineTotal, 0)

  const localJob: LocalJob = {
    clientGeneratedId,
    tenantId: input.tenantId,
    status: 'waiting',
    vehicleId: input.vehicleId,
    vehiclePlate: input.vehiclePlate,
    vehicleMake: input.vehicleMake,
    vehicleModel: input.vehicleModel,
    vehicleSizeId: input.vehicleSizeId,
    vehicleSizeName: input.vehicleSizeName,
    services: input.services,
    estimatedTotal,
    createdAt: new Date().toISOString(),
    syncStatus: 'pending',
  }

  await db.jobs.add(localJob)

  await db.mutationQueue.add({
    id: crypto.randomUUID(),
    tenantId: input.tenantId,
    entity: 'job_create',
    clientGeneratedId,
    payload: {
      client_generated_id: clientGeneratedId,
      vehicle_id: input.vehicleId,
      vehicle_size_id: input.vehicleSizeId,
      services: input.services.map((s) => ({
        service_id: s.serviceId,
        quantity: s.quantity,
        attendant_employee_ids: s.attendantEmployeeIds,
      })),
    },
    createdAt: new Date().toISOString(),
    retryCount: 0,
    status: 'pending',
    sequence: Date.now(),
  })

  void flushMutationQueue()

  return clientGeneratedId
}
