import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  adjustLoyaltyPoints,
  getLoyaltyBalance,
  listLoyaltyTransactions,
  searchCustomers,
  type Customer,
  type LoyaltyTransaction,
} from './api/loyaltyApi'

const TYPE_LABELS: Record<string, string> = {
  earn: 'Earned',
  redeem: 'Redeemed',
  adjustment: 'Manual adjustment',
}

export function LoyaltyPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [selected, setSelected] = useState<Customer | null>(null)
  const [balance, setBalance] = useState(0)
  const [transactions, setTransactions] = useState<LoyaltyTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustPoints, setAdjustPoints] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function runSearch() {
    try {
      setResults(await searchCustomers(query))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Search failed')
    }
  }

  async function selectCustomer(customer: Customer) {
    setSelected(customer)
    setResults([])
    setQuery('')
    setLoading(true)
    try {
      const [bal, txns] = await Promise.all([getLoyaltyBalance(customer.id), listLoyaltyTransactions(customer.id)])
      setBalance(bal)
      setTransactions(txns)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load loyalty data')
    } finally {
      setLoading(false)
    }
  }

  async function submitAdjustment() {
    if (!selected || !adjustPoints || !adjustReason.trim()) return
    setSubmitting(true)
    try {
      await adjustLoyaltyPoints(selected.id, Number(adjustPoints), adjustReason.trim())
      toast.success('Loyalty points adjusted')
      setAdjustOpen(false)
      setAdjustPoints('')
      setAdjustReason('')
      await selectCustomer(selected)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to adjust points')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Loyalty</h1>
        <p className="text-muted-foreground">Search a customer to see their points balance and history.</p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex gap-2">
            <Input
              placeholder="Search by name or mobile number"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
            <Button onClick={runSearch} disabled={!query.trim()}>
              Search
            </Button>
          </div>
          {results.length > 0 && (
            <div className="flex flex-col gap-1 rounded-md border p-2">
              {results.map((c) => (
                <button
                  key={c.id}
                  className="flex justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => selectCustomer(c)}
                >
                  <span>{c.full_name}</span>
                  <span className="text-muted-foreground">{c.mobile ?? '—'}</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <>
          <Card>
            <CardContent className="flex items-center justify-between pt-6">
              <div>
                <div className="text-lg font-semibold">{selected.full_name}</div>
                <div className="text-sm text-muted-foreground">{selected.mobile ?? 'No mobile on file'}</div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">Points balance</div>
                  <div className="text-2xl font-semibold">{loading ? '…' : balance}</div>
                </div>
                <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline">Adjust</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Manual loyalty adjustment</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-3">
                      <Input
                        type="number"
                        placeholder="Points (negative to deduct)"
                        value={adjustPoints}
                        onChange={(e) => setAdjustPoints(e.target.value)}
                      />
                      <Input placeholder="Reason (required)" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} />
                      <Button onClick={submitAdjustment} disabled={submitting || !adjustPoints || !adjustReason.trim()}>
                        Confirm adjustment
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Transaction history</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{new Date(t.created_at).toLocaleString()}</TableCell>
                      <TableCell>{TYPE_LABELS[t.transaction_type] ?? t.transaction_type}</TableCell>
                      <TableCell className="text-muted-foreground">{t.reference_note ?? '—'}</TableCell>
                      <TableCell className={`text-right font-medium ${t.points_delta < 0 ? 'text-destructive' : ''}`}>
                        {t.points_delta > 0 ? '+' : ''}
                        {t.points_delta}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && transactions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        No transactions yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
