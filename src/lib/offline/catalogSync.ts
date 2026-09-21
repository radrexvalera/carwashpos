import { db } from '@/lib/db/dexie'
import { supabase } from '@/lib/supabase/client'

// Refreshes the local read-cache from Supabase. Called once the tenant is known (after login) and
// again on reconnect, so the POS can build tickets offline against whatever was last synced.
export async function refreshCatalogCache() {
  const [vehicleSizes, serviceCategories, services, servicePrices, products, consumables, bays, vehicleMakes, vehicleModels] =
    await Promise.all([
      supabase.from('vehicle_sizes').select('*'),
      supabase.from('service_categories').select('*'),
      supabase.from('services').select('*'),
      supabase.from('service_prices').select('*'),
      supabase.from('products').select('*'),
      supabase.from('consumables').select('*'),
      supabase.from('bays').select('*'),
      supabase.from('vehicle_makes').select('*'),
      supabase.from('vehicle_models').select('*'),
    ])

  await db.transaction(
    'rw',
    [
      db.vehicleSizes,
      db.serviceCategories,
      db.services,
      db.servicePrices,
      db.products,
      db.consumables,
      db.bays,
      db.vehicleMakes,
      db.vehicleModels,
    ],
    async () => {
      if (vehicleSizes.data) await db.vehicleSizes.bulkPut(vehicleSizes.data)
      if (serviceCategories.data) await db.serviceCategories.bulkPut(serviceCategories.data)
      if (services.data) await db.services.bulkPut(services.data)
      if (servicePrices.data) await db.servicePrices.bulkPut(servicePrices.data)
      if (products.data) await db.products.bulkPut(products.data)
      if (consumables.data) await db.consumables.bulkPut(consumables.data)
      if (bays.data) await db.bays.bulkPut(bays.data)
      if (vehicleMakes.data) await db.vehicleMakes.bulkPut(vehicleMakes.data)
      if (vehicleModels.data) await db.vehicleModels.bulkPut(vehicleModels.data)
    },
  )
}
