import Dexie, { type EntityTable } from 'dexie'
import type { Database } from '@/lib/supabase/types'
import type { LocalTicket, MutationQueueEntry } from '@/lib/offline/types'

// Read-cache tables: mirrors of Supabase catalog data, refreshed on reconnect, never locally
// mutated. The POS (Phase 1) reads services/prices/products/consumables from here so it keeps
// working offline; only admin/manager catalog *edits* require connectivity (see plan doc).
type VehicleSizeClassRow = Database['public']['Tables']['vehicle_size_classes']['Row']
type ServiceRow = Database['public']['Tables']['services']['Row']
type ServicePriceRow = Database['public']['Tables']['service_prices']['Row']
type ProductRow = Database['public']['Tables']['products']['Row']
type ConsumableRow = Database['public']['Tables']['consumables']['Row']
type BayRow = Database['public']['Tables']['bays']['Row']

class CarWashDB extends Dexie {
  vehicleSizeClasses!: EntityTable<VehicleSizeClassRow, 'id'>
  services!: EntityTable<ServiceRow, 'id'>
  servicePrices!: EntityTable<ServicePriceRow, 'id'>
  products!: EntityTable<ProductRow, 'id'>
  consumables!: EntityTable<ConsumableRow, 'id'>
  bays!: EntityTable<BayRow, 'id'>

  // Outbox-backed: local optimistic tickets (keyed by the client-generated id, stable across the
  // whole offline -> synced lifecycle) and the mutation queue that actually drives syncing them.
  tickets!: EntityTable<LocalTicket, 'clientGeneratedId'>
  mutationQueue!: EntityTable<MutationQueueEntry, 'id'>

  constructor() {
    super('carwash-pos')

    this.version(1).stores({
      vehicleSizeClasses: 'id, tenant_id, sort_order',
      services: 'id, tenant_id, category',
      servicePrices: 'id, tenant_id, service_id, vehicle_size_class_id',
      products: 'id, tenant_id, sku',
      consumables: 'id, tenant_id',
      bays: 'id, tenant_id, location_id, sort_order',
    })

    this.version(2).stores({
      tickets: 'clientGeneratedId, tenantId, status, syncStatus, createdAt',
      mutationQueue: 'id, tenantId, status, sequence',
    })
  }
}

export const db = new CarWashDB()
