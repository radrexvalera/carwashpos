// Local, denormalized shapes used by the offline outbox -- deliberately NOT the same shape as the
// Supabase Row types. A ticket here is one JSON blob (line items + payments embedded) because it's
// synced as one coarse-grained mutation (a single complete_ticket() call), not row-by-row. See plan
// doc "Dexie / Offline Sync Architecture".

export interface LocalTicketLineItem {
  lineType: 'service' | 'product'
  serviceId?: string
  serviceName?: string
  vehicleSizeClassId?: string
  vehicleSizeClassName?: string
  productId?: string
  productName?: string
  unitPrice: number
  quantity: number
  lineTotal: number
}

export type PaymentMethod = 'cash' | 'gcash' | 'maya' | 'bank_transfer' | 'card'

export interface LocalTicketPayment {
  method: PaymentMethod
  amount: number
  referenceNote?: string
}

export type TicketSyncStatus = 'pending' | 'syncing' | 'synced' | 'failed'

export interface LocalTicket {
  clientGeneratedId: string
  tenantId: string
  id?: string
  ticketNumber?: number
  status: string
  lineItems: LocalTicketLineItem[]
  payments: LocalTicketPayment[]
  subtotal: number
  total: number
  createdAt: string
  syncStatus: TicketSyncStatus
  syncError?: string
}

export type MutationStatus = 'pending' | 'syncing' | 'synced' | 'failed'

export interface MutationQueueEntry {
  id: string
  tenantId: string
  entity: 'ticket_complete' | 'ticket_status_update' | 'job_create' | 'job_status_update' | 'job_complete'
  clientGeneratedId: string
  payload: unknown
  createdAt: string
  attemptedAt?: string
  retryCount: number
  status: MutationStatus
  lastError?: string
  sequence: number
}

// A job's services are priced/created server-side (create_job()) -- this local shape is what the
// POS optimistically shows before sync confirms it, same "coarse-grained mutation" principle as
// LocalTicket.
export interface LocalJobServiceLine {
  serviceId: string
  serviceName: string
  unitPrice: number
  quantity: number
  lineTotal: number
  attendantEmployeeIds: string[]
  attendantNames: string[]
}

export type JobSyncStatus = 'pending' | 'syncing' | 'synced' | 'failed'

export interface LocalJob {
  clientGeneratedId: string
  tenantId: string
  id?: string
  jobNumber?: string
  status: string
  vehicleId: string
  vehiclePlate: string
  vehicleMake: string | null
  vehicleModel: string | null
  vehicleSizeId: string
  vehicleSizeName: string
  services: LocalJobServiceLine[]
  estimatedTotal: number
  createdAt: string
  syncStatus: JobSyncStatus
  syncError?: string
}

// Read-cache mirror of the job_board_entries view -- ALL open jobs tenant-wide, refreshed via
// Realtime + polling, same role as BoardTicket played for the old ticket-based board.
export interface BoardJob {
  id: string
  tenantId: string
  clientGeneratedId: string
  jobNumber: string
  status: string
  bayId: string | null
  bayName: string | null
  bayEnteredAt: string | null
  createdAt: string
  completedAt: string | null
  plateNumber: string
  vehicleMake: string | null
  vehicleModel: string | null
  vehicleSizeName: string
  estimatedTotal: number
  servicesSummary: string | null
  attendantsSummary: string | null
  isPaid: boolean
}

// Read-cache mirror of the ticket_board_entries view (Phase 2) -- refreshed via Realtime + polling,
// not locally mutated directly (status changes go through the mutation queue like everything else,
// and flow back into this cache once the resulting Postgres change round-trips through Realtime).
export interface BoardTicket {
  id: string
  tenantId: string
  clientGeneratedId: string
  ticketNumber: number
  status: string
  bayId: string | null
  bayName: string | null
  bayEnteredAt: string | null
  createdAt: string
  completedAt: string | null
  total: number
  summary: string | null
}
