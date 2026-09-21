import { useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import { refreshJobBoardCache } from '../api/jobBoardSync'

// Same live-sync pattern as the old bay board's useBoardSync: immediate pull, Realtime
// subscription on the jobs table, and a periodic fallback poll.
export function useJobBoardSync(tenantId: string | undefined) {
  useEffect(() => {
    if (!tenantId) return

    refreshJobBoardCache(tenantId)

    const channel = supabase
      .channel(`jobs-board-${tenantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jobs', filter: `tenant_id=eq.${tenantId}` },
        () => refreshJobBoardCache(tenantId),
      )
      .subscribe()

    const interval = window.setInterval(() => refreshJobBoardCache(tenantId), 20_000)

    return () => {
      supabase.removeChannel(channel)
      window.clearInterval(interval)
    }
  }, [tenantId])
}
