import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMoney } from '@/lib/money'
import { searchCustomers, type Customer } from '@/features/loyalty/api/loyaltyApi'
import {
  createCompanyCustomer,
  createFleetAccount,
  listFleetAccounts,
  listOutstandingInvoices,
  recordFleetSettlement,
  setFleetAccountActive,
  updateFleetAccountTerms,
  type FleetAccountWithDetails,
} from './api/fleetApi'

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  gcash: 'GCash',
  maya: 'Maya',
  bank_transfer: 'Bank Transfer',
  card: 'Card',
}

export function FleetAccountsPage() {
  const { profile } = useTenant()
  const [accounts, setAccounts] = useState<FleetAccountWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  // New account dialog
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'search' | 'new'>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [pickedCustomerId, setPickedCustomerId] = useState<string | null>(null)
  const [pickedCustomerName, setPickedCustomerName] = useState('')
  const [newName, setNewName] = useState('')
  const [newMobile, setNewMobile] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [creditLimit, setCreditLimit] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('30')
  const [submitting, setSubmitting] = useState(false)

  // Invoices view
  const [expanded, setExpanded] = useState<FleetAccountWithDetails | null>(null)
  const [invoices, setInvoices] = useState<Awaited<ReturnType<typeof listOutstandingInvoices>>>([])
  const [settleTarget, setSettleTarget] = useState<{ id: string; remaining: number } | null>(null)
  const [settleAmount, setSettleAmount] = useState('')
  const [settleMethod, setSettleMethod] = useState('cash')
  const [settleNote, setSettleNote] = useState('')

  async function reload() {
    setLoading(true)
    try {
      setAccounts(await listFleetAccounts())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load fleet accounts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function runSearch() {
    try {
      setResults(await searchCustomers(query))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Search failed')
    }
  }

  function resetDialog() {
    setMode('search')
    setQuery('')
    setResults([])
    setPickedCustomerId(null)
    setPickedCustomerName('')
    setNewName('')
    setNewMobile('')
    setNewEmail('')
    setNewAddress('')
    setCreditLimit('')
    setPaymentTerms('30')
  }

  async function handleCreate() {
    if (!profile) return
    setSubmitting(true)
    try {
      let customerId = pickedCustomerId
      if (mode === 'new') {
        if (!newName.trim()) return
        customerId = await createCompanyCustomer({
          tenantId: profile.tenantId,
          fullName: newName.trim(),
          mobile: newMobile.trim() || undefined,
          email: newEmail.trim() || undefined,
          address: newAddress.trim() || undefined,
        })
      }
      if (!customerId) return
      await createFleetAccount({
        tenantId: profile.tenantId,
        customerId,
        creditLimit: creditLimit ? Number(creditLimit) : undefined,
        paymentTermsDays: Number(paymentTerms) || 30,
      })
      toast.success('Fleet account created')
      setOpen(false)
      resetDialog()
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create fleet account')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(account: FleetAccountWithDetails) {
    try {
      await setFleetAccountActive(account.id, !account.is_active)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update account')
    }
  }

  async function saveTerms(account: FleetAccountWithDetails, creditLimitValue: string, termsValue: string) {
    try {
      await updateFleetAccountTerms(account.id, creditLimitValue ? Number(creditLimitValue) : null, Number(termsValue) || 30)
      toast.success('Terms updated')
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update terms')
    }
  }

  async function viewInvoices(account: FleetAccountWithDetails) {
    setExpanded(account)
    try {
      setInvoices(await listOutstandingInvoices(account.customer_id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load invoices')
    }
  }

  async function submitSettlement() {
    if (!settleTarget || !settleAmount) return
    setSubmitting(true)
    try {
      await recordFleetSettlement(settleTarget.id, settleMethod, Number(settleAmount), settleNote.trim() || undefined)
      toast.success('Payment recorded')
      setSettleTarget(null)
      setSettleAmount('')
      setSettleNote('')
      if (expanded) await viewInvoices(expanded)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record settlement')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Fleet Accounts</h1>
          <p className="text-muted-foreground">Corporate clients billed on account instead of paying at checkout.</p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o)
            if (!o) resetDialog()
          }}
        >
          <DialogTrigger asChild>
            <Button>New fleet account</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New fleet account</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex gap-2">
                <Button variant={mode === 'search' ? 'default' : 'outline'} size="sm" onClick={() => setMode('search')}>
                  Existing customer
                </Button>
                <Button variant={mode === 'new' ? 'default' : 'outline'} size="sm" onClick={() => setMode('new')}>
                  New company
                </Button>
              </div>

              {mode === 'search' ? (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <Input placeholder="Search by name or mobile" value={query} onChange={(e) => setQuery(e.target.value)} />
                    <Button variant="secondary" onClick={runSearch} disabled={!query.trim()}>
                      Search
                    </Button>
                  </div>
                  {results.length > 0 && (
                    <div className="flex flex-col gap-1 rounded-md border p-2">
                      {results.map((c) => (
                        <button
                          key={c.id}
                          className={`flex justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent ${pickedCustomerId === c.id ? 'bg-accent' : ''}`}
                          onClick={() => {
                            setPickedCustomerId(c.id)
                            setPickedCustomerName(c.full_name)
                          }}
                        >
                          <span>{c.full_name}</span>
                          <span className="text-muted-foreground">{c.mobile ?? '—'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {pickedCustomerId && <p className="text-sm text-muted-foreground">Selected: {pickedCustomerName}</p>}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <Input placeholder="Company name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                  <Input placeholder="Mobile (optional)" value={newMobile} onChange={(e) => setNewMobile(e.target.value)} />
                  <Input placeholder="Email (optional)" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                  <Input placeholder="Address (optional)" value={newAddress} onChange={(e) => setNewAddress(e.target.value)} />
                </div>
              )}

              <Separator />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Credit limit (optional)</Label>
                  <Input type="number" step="0.01" placeholder="Unlimited" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Payment terms (days)</Label>
                  <Input type="number" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
                </div>
              </div>

              <Button
                onClick={handleCreate}
                disabled={submitting || (mode === 'search' ? !pickedCustomerId : !newName.trim())}
              >
                Create fleet account
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Credit limit</TableHead>
                <TableHead>Terms</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.customerName}</TableCell>
                  <TableCell>{a.credit_limit != null ? formatMoney(a.credit_limit) : 'Unlimited'}</TableCell>
                  <TableCell>Net {a.payment_terms_days}</TableCell>
                  <TableCell className="text-right">
                    {a.outstandingBalance > 0 ? (
                      <Badge variant="outline">{formatMoney(a.outstandingBalance)}</Badge>
                    ) : (
                      <span className="text-muted-foreground">₱0.00</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch checked={a.is_active} onCheckedChange={() => toggleActive(a)} />
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => viewInvoices(a)}>
                      Invoices
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && accounts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No fleet accounts yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {expanded && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Outstanding invoices — {expanded.customerName}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Credit limit</Label>
                <Input
                  type="number"
                  step="0.01"
                  defaultValue={expanded.credit_limit ?? ''}
                  placeholder="Unlimited"
                  onBlur={(e) => saveTerms(expanded, e.target.value, String(expanded.payment_terms_days))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Payment terms (days)</Label>
                <Input
                  type="number"
                  defaultValue={expanded.payment_terms_days}
                  onBlur={(e) => saveTerms(expanded, String(expanded.credit_limit ?? ''), e.target.value)}
                />
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>{inv.sale_number}</TableCell>
                    <TableCell>{new Date(inv.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>{formatMoney(inv.total)}</TableCell>
                    <TableCell>{formatMoney(inv.paidSoFar)}</TableCell>
                    <TableCell className="text-right font-medium">{formatMoney(inv.remaining)}</TableCell>
                    <TableCell>
                      <Dialog
                        open={settleTarget?.id === inv.id}
                        onOpenChange={(o) => !o && setSettleTarget(null)}
                      >
                        <DialogTrigger asChild>
                          <Button size="sm" variant="secondary" onClick={() => setSettleTarget({ id: inv.id, remaining: inv.remaining })}>
                            Record payment
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Record payment — {inv.sale_number}</DialogTitle>
                          </DialogHeader>
                          <div className="flex flex-col gap-3">
                            <p className="text-sm text-muted-foreground">Remaining: {formatMoney(inv.remaining)}</p>
                            <Input
                              type="number"
                              step="0.01"
                              max={inv.remaining}
                              placeholder="Amount"
                              value={settleAmount}
                              onChange={(e) => setSettleAmount(e.target.value)}
                            />
                            <Select value={settleMethod} onValueChange={setSettleMethod}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(METHOD_LABELS).map(([value, label]) => (
                                  <SelectItem key={value} value={value}>
                                    {label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input placeholder="Reference note (optional)" value={settleNote} onChange={(e) => setSettleNote(e.target.value)} />
                            <Button
                              onClick={submitSettlement}
                              disabled={submitting || !settleAmount || Number(settleAmount) > inv.remaining || Number(settleAmount) <= 0}
                            >
                              Confirm payment
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))}
                {invoices.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No outstanding invoices.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
