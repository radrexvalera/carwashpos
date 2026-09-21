import { useEffect } from 'react'
import { refreshCatalogCache } from './catalogSync'
import { startSyncEngine } from './syncEngine'

// Mounted once inside the authenticated shell: starts the outbox flush loop immediately, and
// pulls a fresh catalog snapshot into Dexie so the POS has something to read offline from the
// moment the tenant is known.
export function useOfflineBootstrap(tenantId: string | undefined) {
  useEffect(() => {
    if (!tenantId) return
    refreshCatalogCache().catch((err) => console.error('Catalog cache refresh failed', err))
  }, [tenantId])

  useEffect(() => startSyncEngine(), [])
}
