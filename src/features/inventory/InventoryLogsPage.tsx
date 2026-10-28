import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMoney } from '@/lib/money'
import { listInventoryLogs } from './api/inventoryApi'

type LogRow = Awaited<ReturnType<typeof listInventoryLogs>>['rows'][number]

const TYPE_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  purchase: 'default',
  opening_balance: 'secondary',
  stock_in: 'secondary',
  adjustment_positive: 'secondary',
  returned: 'secondary',
  service_consumption: 'outline',
  retail_sale: 'outline',
  transfer: 'outline',
  adjustment_negative: 'destructive',
  damaged: 'destructive',
  expired: 'destructive',
  lost: 'destructive',
  manual_correction: 'secondary',
}

export function InventoryLogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      const result = await listInventoryLogs(undefined, 0)
      setLogs(result.rows)
      setHasMore(result.hasMore)
      setPage(0)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load inventory logs')
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    setLoadingMore(true)
    try {
      const nextPage = page + 1
      const result = await listInventoryLogs(undefined, nextPage)
      setLogs((prev) => [...prev, ...result.rows])
      setHasMore(result.hasMore)
      setPage(nextPage)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load more inventory logs')
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Inventory Logs</h1>
        <p className="text-muted-foreground">Every stock movement across all items -- purchases, consumption, sales, and manual adjustments.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty change</TableHead>
                <TableHead className="text-right">New on hand</TableHead>
                <TableHead className="text-right">Unit cost</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>{new Date(log.created_at).toLocaleString()}</TableCell>
                  <TableCell>{log.itemName}</TableCell>
                  <TableCell>
                    <Badge variant={TYPE_VARIANTS[log.transaction_type] ?? 'secondary'}>{log.transaction_type.replace(/_/g, ' ')}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {log.quantity_delta > 0 ? '+' : ''}
                    {log.quantity_delta}
                  </TableCell>
                  <TableCell className="text-right">{log.new_qty}</TableCell>
                  <TableCell className="text-right">{log.unit_cost_at_time ? formatMoney(log.unit_cost_at_time) : '—'}</TableCell>
                  <TableCell className="max-w-xs truncate" title={log.referenceLabel}>
                    {log.referenceLabel}
                  </TableCell>
                  <TableCell className="max-w-xs truncate" title={log.reason ?? undefined}>
                    {log.reason ?? '—'}
                  </TableCell>
                  <TableCell>{log.createdByName}</TableCell>
                </TableRow>
              ))}
              {!loading && logs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    No inventory activity yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {hasMore && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
