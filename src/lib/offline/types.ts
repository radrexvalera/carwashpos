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
  entity: 'ticket_complete'
  clientGeneratedId: string
  payload: unknown
  createdAt: string
  attemptedAt?: string
  retryCount: number
  status: MutationStatus
  lastError?: string
  sequence: number
}
