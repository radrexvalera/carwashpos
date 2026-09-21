import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useParams } from 'react-router-dom'
import { db } from '@/lib/db/dexie'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { useTenant } from '@/app/TenantProvider'

export function ReceiptPage() {
  const { clientGeneratedId } = useParams<{ clientGeneratedId: string }>()
  const { profile } = useTenant()
  const ticket = useLiveQuery(() => db.tickets.get(clientGeneratedId ?? ''), [clientGeneratedId])

  if (ticket === undefined) {
    return <p className="text-muted-foreground">Loading…</p>
  }

  if (!ticket) {
    return <p className="text-muted-foreground">Ticket not found.</p>
  }

  const paymentLabels: Record<string, string> = { cash: 'Cash', e_wallet: 'E-wallet', card: 'Card' }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex items-center justify-between print:hidden">
        <Link to="/pos">
          <Button variant="outline">New sale</Button>
        </Link>
        <Button onClick={() => window.print()}>Print</Button>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 text-sm">
          <div className="text-center">
            <div className="text-lg font-semibold">Receipt</div>
            <div className="text-muted-foreground">
              {ticket.ticketNumber ? `Ticket #${ticket.ticketNumber}` : 'Pending — not yet synced'}
            </div>
            <div className="text-xs text-muted-foreground">{new Date(ticket.createdAt).toLocaleString()}</div>
            {ticket.syncStatus === 'pending' && (
              <div className="mt-1 text-xs text-amber-600">Will sync once back online</div>
            )}
            {ticket.syncStatus === 'failed' && <div className="mt-1 text-xs text-destructive">Sync failed: {ticket.syncError}</div>}
          </div>

          <Separator />

          <div className="flex flex-col gap-1">
            {ticket.lineItems.map((line, i) => (
              <div key={i} className="flex justify-between">
                <span>
                  {line.lineType === 'service' ? line.serviceName : line.productName}
                  {line.quantity > 1 ? ` ×${line.quantity}` : ''}
                  {line.lineType === 'service' && line.vehicleSizeClassName ? ` (${line.vehicleSizeClassName})` : ''}
                </span>
                <span>${line.lineTotal.toFixed(2)}</span>
              </div>
            ))}
          </div>

          <Separator />

          <div className="flex justify-between font-semibold">
            <span>Total</span>
            <span>${ticket.total.toFixed(2)}</span>
          </div>

          <Separator />

          <div className="flex flex-col gap-1">
            {ticket.payments.map((p, i) => (
              <div key={i} className="flex justify-between text-muted-foreground">
                <span>
                  {paymentLabels[p.method]}
                  {p.referenceNote ? ` · ${p.referenceNote}` : ''}
                </span>
                <span>${p.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>

          <div className="mt-2 text-center text-xs text-muted-foreground">Served by {profile?.fullName}</div>
        </CardContent>
      </Card>
    </div>
  )
}
