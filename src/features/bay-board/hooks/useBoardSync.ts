import { useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import { refreshBoardCache } from '../api/boardSync'

// Keeps the board's local cache live while the page is mounted: an immediate pull, a Realtime
// subscription on the tickets table (any device's status/bay change shows up here), and a
// periodic fallback poll in case Realtime is unavailable (e.g. offline, or briefly dropped).
export function useBoardSync(tenantId: string | undefined) {
  useEffect(() => {
    if (!tenantId) return

    refreshBoardCache(tenantId)

    const channel = supabase
      .channel(`tickets-board-${tenantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets', filter: `tenant_id=eq.${tenantId}` },
        () => refreshBoardCache(tenantId),
      )
      .subscribe()

    const interval = window.setInterval(() => refreshBoardCache(tenantId), 20_000)

    return () => {
      supabase.removeChannel(channel)
      window.clearInterval(interval)
    }
  }, [tenantId])
}
