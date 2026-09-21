import Dexie, { type EntityTable } from 'dexie'
import type { Database } from '@/lib/supabase/types'
import type { BoardTicket, LocalTicket, MutationQueueEntry } from '@/lib/offline/types'

// Read-cache tables: mirrors of Supabase catalog data, refreshed on reconnect, never locally
// mutated. The POS (Phase 1) reads services/prices/products/consumables from here so it keeps
// working offline; only admin/manager catalog *edits* require connectivity (see plan doc).
type VehicleSizeRow = Database['public']['Tables']['vehicle_sizes']['Row']
type ServiceRow = Database['public']['Tables']['services']['Row']
type ServiceCategoryRow = Database['public']['Tables']['service_categories']['Row']
type ServicePriceRow = Database['public']['Tables']['service_prices']['Row']
type ProductRow = Database['public']['Tables']['products']['Row']
type ConsumableRow = Database['public']['Tables']['consumables']['Row']
type BayRow = Database['public']['Tables']['bays']['Row']
type VehicleMakeRow = Database['public']['Tables']['vehicle_makes']['Row']
type VehicleModelRow = Database['public']['Tables']['vehicle_models']['Row']

class CarWashDB extends Dexie {
  vehicleSizes!: EntityTable<VehicleSizeRow, 'id'>
  services!: EntityTable<ServiceRow, 'id'>
  serviceCategories!: EntityTable<ServiceCategoryRow, 'id'>
  servicePrices!: EntityTable<ServicePriceRow, 'id'>
  products!: EntityTable<ProductRow, 'id'>
  consumables!: EntityTable<ConsumableRow, 'id'>
  bays!: EntityTable<BayRow, 'id'>
  vehicleMakes!: EntityTable<VehicleMakeRow, 'id'>
  vehicleModels!: EntityTable<VehicleModelRow, 'id'>

  // Outbox-backed: local optimistic tickets (keyed by the client-generated id, stable across the
  // whole offline -> synced lifecycle) and the mutation queue that actually drives syncing them.
  tickets!: EntityTable<LocalTicket, 'clientGeneratedId'>
  mutationQueue!: EntityTable<MutationQueueEntry, 'id'>

  // Read-cache mirror of the ticket_board_entries view (Phase 2) -- ALL open tickets tenant-wide,
  // not just ones this device created. Keyed by the server id since it's populated from server
  // reads; boardTickets.clientGeneratedId is still indexed so a status-update mutation can find
  // the row it should patch.
  boardTickets!: EntityTable<BoardTicket, 'id'>

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

    this.version(3).stores({
      boardTickets: 'id, tenantId, clientGeneratedId, status, bayId',
    })

    // vehicle_size_classes -> vehicle_sizes rename (Phase 1 rework): Dexie has no rename
    // primitive, so the old store is dropped and a new one created. This is just a read-cache --
    // refreshCatalogCache() repopulates it on next load, no data loss of anything authoritative.
    this.version(4).stores({
      vehicleSizeClasses: null,
      vehicleSizes: 'id, tenant_id, sort_order',
      serviceCategories: 'id, tenant_id, sort_order',
      servicePrices: 'id, tenant_id, service_id, vehicle_size_id',
      vehicleMakes: 'id, tenant_id',
      vehicleModels: 'id, tenant_id, make_id',
    })
  }
}

export const db = new CarWashDB()
