import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { db } from '@/lib/db/dexie'
import { formatMoney } from '@/lib/money'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { BoardTicket } from '@/lib/offline/types'
import { updateTicketStatus } from './api/boardMutations'
import { useBoardSync } from './hooks/useBoardSync'

export function BayBoardPage() {
  const { profile } = useTenant()
  useBoardSync(profile?.tenantId)

  const bays = useLiveQuery(
    () => db.bays.where('tenant_id').equals(profile?.tenantId ?? '').and((b) => b.is_active).sortBy('sort_order'),
    [profile?.tenantId],
    [],
  )
  const boardTickets = useLiveQuery(
    () => db.boardTickets.where('tenantId').equals(profile?.tenantId ?? '').toArray(),
    [profile?.tenantId],
    [],
  )

  // Elapsed-time labels are computed at render time -- this just forces a re-render periodically
  // so they stay roughly current without re-fetching anything.
  const [, tick] = useState(0)
  useEffect(() => {
    const interval = window.setInterval(() => tick((n) => n + 1), 30_000)
    return () => window.clearInterval(interval)
  }, [])

  const waiting = useMemo(
    () =>
      (boardTickets ?? [])
        .filter((t) => t.status === 'waiting')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [boardTickets],
  )
  const byBayId = useMemo(() => {
    const map = new Map<string, BoardTicket>()
    for (const t of boardTickets ?? []) {
      if ((t.status === 'in_bay' || t.status === 'ready_for_pickup') && t.bayId) map.set(t.bayId, t)
    }
    return map
  }, [boardTickets])

  async function assignToBay(ticket: BoardTicket, bayId: string) {
    if (!profile) return
    try {
      await updateTicketStatus({
        tenantId: profile.tenantId,
        boardTicketId: ticket.id,
        clientGeneratedId: ticket.clientGeneratedId,
        status: 'in_bay',
        bayId,
        bayEnteredAt: new Date().toISOString(),
        completedAt: null,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign bay')
    }
  }

  async function markReady(ticket: BoardTicket) {
    if (!profile) return
    try {
      await updateTicketStatus({
        tenantId: profile.tenantId,
        boardTicketId: ticket.id,
        clientGeneratedId: ticket.clientGeneratedId,
        status: 'ready_for_pickup',
        bayId: ticket.bayId,
        bayEnteredAt: ticket.bayEnteredAt,
        completedAt: null,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update')
    }
  }

  async function markPickedUp(ticket: BoardTicket) {
    if (!profile) return
    try {
      await updateTicketStatus({
        tenantId: profile.tenantId,
        boardTicketId: ticket.id,
        clientGeneratedId: ticket.clientGeneratedId,
        status: 'picked_up_paid',
        bayId: null,
        bayEnteredAt: null,
        completedAt: new Date().toISOString(),
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Bay Board</h1>
        <p className="text-muted-foreground">Live view of every bay and the waiting queue. Works offline.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Waiting Queue</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {waiting.length === 0 && <p className="text-muted-foreground">Nothing waiting.</p>}
            {waiting.map((t) => (
              <div key={t.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Ticket #{t.ticketNumber}</span>
                  <span className="text-xs text-muted-foreground">{elapsed(t.createdAt)}</span>
                </div>
                <div className="text-sm text-muted-foreground">{t.summary}</div>
                <div className="text-sm">{formatMoney(t.total)}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(bays ?? [])
                    .filter((b) => !byBayId.has(b.id))
                    .map((b) => (
                      <Button key={b.id} size="sm" variant="outline" onClick={() => assignToBay(t, b.id)}>
                        → {b.name}
                      </Button>
                    ))}
                  {(bays ?? []).every((b) => byBayId.has(b.id)) && (
                    <span className="text-xs text-muted-foreground">All bays occupied</span>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(bays ?? []).length === 0 && (
            <Card>
              <CardContent className="pt-6 text-muted-foreground">No bays set up yet — add some under Bays.</CardContent>
            </Card>
          )}
          {(bays ?? []).map((bay) => {
            const ticket = byBayId.get(bay.id)
            return (
              <Card key={bay.id}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    {bay.name}
                    {ticket ? (
                      <Badge variant={ticket.status === 'ready_for_pickup' ? 'default' : 'secondary'}>
                        {ticket.status === 'ready_for_pickup' ? 'Ready' : 'In bay'}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Open
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {ticket ? (
                    <div className="flex flex-col gap-2">
                      <div className="font-medium">Ticket #{ticket.ticketNumber}</div>
                      <div className="text-sm text-muted-foreground">{ticket.summary}</div>
                      <div className="text-sm">{formatMoney(ticket.total)}</div>
                      <div className="text-xs text-muted-foreground">
                        {ticket.bayEnteredAt ? `In bay ${elapsed(ticket.bayEnteredAt)}` : ''}
                      </div>
                      {ticket.status === 'in_bay' && (
                        <Button size="sm" onClick={() => markReady(ticket)}>
                          Mark ready
                        </Button>
                      )}
                      {ticket.status === 'ready_for_pickup' && (
                        <Button size="sm" onClick={() => markPickedUp(ticket)}>
                          Picked up
                        </Button>
                      )}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">Empty</p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function elapsed(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
