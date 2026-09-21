import { db } from '@/lib/db/dexie'
import { supabase } from '@/lib/supabase/client'

// Refreshes the local read-cache from Supabase. Called once the tenant is known (after login) and
// again on reconnect, so the POS can build tickets offline against whatever was last synced.
export async function refreshCatalogCache() {
  const [vehicleSizeClasses, services, servicePrices, products, consumables, bays] = await Promise.all([
    supabase.from('vehicle_size_classes').select('*'),
    supabase.from('services').select('*'),
    supabase.from('service_prices').select('*'),
    supabase.from('products').select('*'),
    supabase.from('consumables').select('*'),
    supabase.from('bays').select('*'),
  ])

  await db.transaction(
    'rw',
    [db.vehicleSizeClasses, db.services, db.servicePrices, db.products, db.consumables, db.bays],
    async () => {
      if (vehicleSizeClasses.data) await db.vehicleSizeClasses.bulkPut(vehicleSizeClasses.data)
      if (services.data) await db.services.bulkPut(services.data)
      if (servicePrices.data) await db.servicePrices.bulkPut(servicePrices.data)
      if (products.data) await db.products.bulkPut(products.data)
      if (consumables.data) await db.consumables.bulkPut(consumables.data)
      if (bays.data) await db.bays.bulkPut(bays.data)
    },
  )
}
