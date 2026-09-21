import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db/dexie'
import { Badge } from '@/components/ui/badge'
import { useOnlineStatus } from './useOnlineStatus'

export function SyncStatusBadge() {
  const online = useOnlineStatus()
  const pendingCount = useLiveQuery(
    () => db.mutationQueue.where('status').anyOf('pending', 'syncing').count(),
    [],
    0,
  )
  const failedCount = useLiveQuery(() => db.mutationQueue.where('status').equals('failed').count(), [], 0)

  if (!online) {
    return (
      <Badge variant="destructive" className="w-full justify-center">
        Offline{pendingCount ? ` · ${pendingCount} pending` : ''}
      </Badge>
    )
  }

  if (failedCount) {
    return (
      <Badge variant="destructive" className="w-full justify-center">
        {failedCount} sync issue{failedCount === 1 ? '' : 's'}
      </Badge>
    )
  }

  if (pendingCount) {
    return (
      <Badge variant="secondary" className="w-full justify-center">
        Syncing {pendingCount}…
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="w-full justify-center text-muted-foreground">
      Online · synced
    </Badge>
  )
}
