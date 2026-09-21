import { db } from '@/lib/db/dexie'
import { supabase } from '@/lib/supabase/client'

// Refreshes the local read-cache from Supabase. Called once the tenant is known (after login) and
// again on reconnect, so the POS can build tickets/jobs offline against whatever was last synced.
// Pulling all vehicles/customers wholesale is fine at this shop's scale; if that ever becomes slow,
// this is the place to switch to an incremental/paginated sync.
export async function refreshCatalogCache() {
  const [
    vehicleSizes,
    serviceCategories,
    services,
    servicePrices,
    bays,
    vehicleMakes,
    vehicleModels,
    employees,
    vehicles,
    customers,
    inventoryItems,
  ] = await Promise.all([
    supabase.from('vehicle_sizes').select('*'),
    supabase.from('service_categories').select('*'),
    supabase.from('services').select('*'),
    supabase.from('service_prices').select('*'),
    supabase.from('wash_bays').select('*'),
    supabase.from('vehicle_makes').select('*'),
    supabase.from('vehicle_models').select('*'),
    supabase.from('employees').select('*'),
    supabase.from('vehicles').select('*'),
    supabase.from('customers').select('*'),
    supabase.from('inventory_items').select('*'),
  ])

  await db.transaction(
    'rw',
    [
      db.vehicleSizes,
      db.serviceCategories,
      db.services,
      db.servicePrices,
      db.bays,
      db.vehicleMakes,
      db.vehicleModels,
      db.employees,
      db.vehicles,
      db.customers,
      db.inventoryItems,
    ],
    async () => {
      if (vehicleSizes.data) await db.vehicleSizes.bulkPut(vehicleSizes.data)
      if (serviceCategories.data) await db.serviceCategories.bulkPut(serviceCategories.data)
      if (services.data) await db.services.bulkPut(services.data)
      if (servicePrices.data) await db.servicePrices.bulkPut(servicePrices.data)
      if (bays.data) await db.bays.bulkPut(bays.data)
      if (vehicleMakes.data) await db.vehicleMakes.bulkPut(vehicleMakes.data)
      if (vehicleModels.data) await db.vehicleModels.bulkPut(vehicleModels.data)
      if (employees.data) await db.employees.bulkPut(employees.data)
      if (vehicles.data) await db.vehicles.bulkPut(vehicles.data)
      if (customers.data) await db.customers.bulkPut(customers.data)
      if (inventoryItems.data) await db.inventoryItems.bulkPut(inventoryItems.data)
    },
  )
}
