import Dexie, { type EntityTable } from 'dexie'
import type { Database } from '@/lib/supabase/types'
import type { BoardJob, BoardTicket, CachedJobServiceLine, LocalJob, LocalTicket, MutationQueueEntry } from '@/lib/offline/types'

// Read-cache tables: mirrors of Supabase catalog data, refreshed on reconnect, never locally
// mutated. The POS (Phase 1) reads services/prices/products/consumables from here so it keeps
// working offline; only admin/manager catalog *edits* require connectivity (see plan doc).
type VehicleSizeRow = Database['public']['Tables']['vehicle_sizes']['Row']
type ServiceRow = Database['public']['Tables']['services']['Row']
type ServiceCategoryRow = Database['public']['Tables']['service_categories']['Row']
type ServicePriceRow = Database['public']['Tables']['service_prices']['Row']
type BayRow = Database['public']['Tables']['wash_bays']['Row']
type VehicleMakeRow = Database['public']['Tables']['vehicle_makes']['Row']
type VehicleModelRow = Database['public']['Tables']['vehicle_models']['Row']
type EmployeeRow = Database['public']['Tables']['employees']['Row']
type VehicleRow = Database['public']['Tables']['vehicles']['Row']
type CustomerRow = Database['public']['Tables']['customers']['Row']
type InventoryItemRow = Database['public']['Tables']['inventory_items']['Row']
type LocationRow = Database['public']['Tables']['locations']['Row']
type SettingsRow = Database['public']['Tables']['settings']['Row']

class CarWashDB extends Dexie {
  vehicleSizes!: EntityTable<VehicleSizeRow, 'id'>
  services!: EntityTable<ServiceRow, 'id'>
  serviceCategories!: EntityTable<ServiceCategoryRow, 'id'>
  servicePrices!: EntityTable<ServicePriceRow, 'id'>
  bays!: EntityTable<BayRow, 'id'>
  vehicleMakes!: EntityTable<VehicleMakeRow, 'id'>
  vehicleModels!: EntityTable<VehicleModelRow, 'id'>
  employees!: EntityTable<EmployeeRow, 'id'>
  vehicles!: EntityTable<VehicleRow, 'id'>
  customers!: EntityTable<CustomerRow, 'id'>
  inventoryItems!: EntityTable<InventoryItemRow, 'id'>
  locations!: EntityTable<LocationRow, 'id'>
  // One row per tenant (tenant_id IS the primary key server-side too) -- business name/address/
  // receipt header-footer/logo, needed to print a receipt offline just like everything else here.
  settings!: EntityTable<SettingsRow, 'tenant_id'>

  // Outbox-backed: local optimistic tickets/jobs (keyed by the client-generated id, stable across
  // the whole offline -> synced lifecycle) and the mutation queue that actually drives syncing them.
  tickets!: EntityTable<LocalTicket, 'clientGeneratedId'>
  jobs!: EntityTable<LocalJob, 'clientGeneratedId'>
  mutationQueue!: EntityTable<MutationQueueEntry, 'id'>

  // Read-cache mirrors of the board views -- ALL open tickets/jobs tenant-wide, not just ones this
  // device created. Keyed by the server id since populated from server reads; clientGeneratedId is
  // still indexed so a status-update mutation can find the row it should patch.
  boardTickets!: EntityTable<BoardTicket, 'id'>
  boardJobs!: EntityTable<BoardJob, 'id'>
  // job_services for every job currently on boardJobs -- see CachedJobServiceLine's own comment.
  jobServiceLines!: EntityTable<CachedJobServiceLine, 'id'>

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

    // Phase 2 (new roadmap): job-based POS + queue board, alongside employees for the crew-
    // assignment picker.
    this.version(5).stores({
      employees: 'id, tenant_id, active',
      jobs: 'clientGeneratedId, tenantId, status, syncStatus, createdAt',
      boardJobs: 'id, tenantId, clientGeneratedId, status, bayId',
      vehicles: 'id, tenant_id, plate_number, customer_id',
      customers: 'id, tenant_id, mobile',
    })

    // Phase 4 (new roadmap): products/consumables replaced by one unified inventory_items table
    // -- their Dexie stores are dropped (this was always just a read-cache) in favor of
    // inventoryItems.
    this.version(6).stores({
      products: null,
      consumables: null,
      inventoryItems: 'id, tenant_id, item_type, category_id',
    })

    // Collect Payment working fully offline: job_services (+ their real ids/prices) for every open
    // board job, plus locations/settings, so a sale can be built and printed without a live read.
    this.version(7).stores({
      jobServiceLines: 'id, tenantId, jobId',
      locations: 'id, tenant_id',
      settings: 'tenant_id',
    })

    // Full offline create+pay: a pending job_payment mutation needs to be looked up by entity type
    // to check "is a payment already queued for this job" (see getJobForPaymentFromPendingLocal /
    // JobQueuePage's queuedPaymentJobIds) -- entity was never an indexed field before this.
    this.version(8).stores({
      mutationQueue: 'id, tenantId, status, sequence, entity',
    })
  }
}

export const db = new CarWashDB()
