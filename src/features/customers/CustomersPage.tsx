import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useTenant } from '@/app/TenantProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { formatMoney } from '@/lib/money'
import { getSaleDetail, listSalesByCustomer, type SaleDetail, type SaleListRow } from '@/features/sales/api/salesApi'
import {
  createCustomer,
  listCustomerVehicles,
  listCustomers,
  updateCustomer,
  type CustomerRow,
  type CustomerVehicle,
} from './api/customersApi'

// A Postgrest error IS an Error instance in practice, but this is defensive against anything that
// logs a real .message without being one -- same helper as InventoryItemsPage.
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  console.error(err)
  return fallback
}

const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  individual: 'Individual',
  company: 'Company',
}

interface CustomerFormState {
  customerType: 'individual' | 'company'
  fullName: string
  mobile: string
  email: string
  address: string
  notes: string
  isActive: boolean
}

const EMPTY_FORM: CustomerFormState = {
  customerType: 'individual',
  fullName: '',
  mobile: '',
  email: '',
  address: '',
  notes: '',
  isActive: true,
}

function CustomerFormFields({
  idPrefix,
  form,
  onChange,
  showActiveToggle,
}: {
  idPrefix: string
  form: CustomerFormState
  onChange: (next: CustomerFormState) => void
  showActiveToggle: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-type`}>Type</Label>
        <Select value={form.customerType} onValueChange={(v) => onChange({ ...form, customerType: v as 'individual' | 'company' })}>
          <SelectTrigger id={`${idPrefix}-type`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(CUSTOMER_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-name`}>{form.customerType === 'company' ? 'Company name' : 'Full name'}</Label>
        <Input id={`${idPrefix}-name`} value={form.fullName} onChange={(e) => onChange({ ...form, fullName: e.target.value })} required />
      </div>
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-mobile`}>Mobile</Label>
          <Input id={`${idPrefix}-mobile`} value={form.mobile} onChange={(e) => onChange({ ...form, mobile: e.target.value })} />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-email`}>Email</Label>
          <Input id={`${idPrefix}-email`} type="email" value={form.email} onChange={(e) => onChange({ ...form, email: e.target.value })} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-address`}>Address</Label>
        <Input id={`${idPrefix}-address`} value={form.address} onChange={(e) => onChange({ ...form, address: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
        <Textarea id={`${idPrefix}-notes`} value={form.notes} onChange={(e) => onChange({ ...form, notes: e.target.value })} rows={3} />
      </div>
      {showActiveToggle && (
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>
            Active
            <span className="block text-xs text-muted-foreground">Inactive customers are kept for history but hidden from pickers.</span>
          </span>
          <Switch checked={form.isActive} onCheckedChange={(c) => onChange({ ...form, isActive: c })} />
        </label>
      )}
    </div>
  )
}

export function CustomersPage() {
  const { profile } = useTenant()
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState<CustomerFormState>(EMPTY_FORM)
  const [createSubmitting, setCreateSubmitting] = useState(false)

  const [editingCustomer, setEditingCustomer] = useState<CustomerRow | null>(null)
  const [editForm, setEditForm] = useState<CustomerFormState>(EMPTY_FORM)
  const [editSubmitting, setEditSubmitting] = useState(false)

  const [profileCustomer, setProfileCustomer] = useState<CustomerRow | null>(null)
  const [profileVehicles, setProfileVehicles] = useState<CustomerVehicle[]>([])
  const [profileSales, setProfileSales] = useState<SaleListRow[]>([])
  const [profileLoading, setProfileLoading] = useState(false)

  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null)
  const [saleDetail, setSaleDetail] = useState<SaleDetail | null>(null)
  const [saleDetailLoading, setSaleDetailLoading] = useState(false)

  async function reload(searchQuery = query) {
    setLoading(true)
    try {
      setCustomers(await listCustomers(searchQuery))
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to load customers'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCreateSubmit(event: FormEvent) {
    event.preventDefault()
    if (!profile || !createForm.fullName.trim()) return
    setCreateSubmitting(true)
    try {
      await createCustomer({
        tenantId: profile.tenantId,
        customerType: createForm.customerType,
        fullName: createForm.fullName.trim(),
        mobile: createForm.mobile.trim() || null,
        email: createForm.email.trim() || null,
        address: createForm.address.trim() || null,
        notes: createForm.notes.trim() || null,
      })
      toast.success('Customer added')
      setCreating(false)
      setCreateForm(EMPTY_FORM)
      await reload()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to add customer'))
    } finally {
      setCreateSubmitting(false)
    }
  }

  function openEdit(customer: CustomerRow) {
    setEditingCustomer(customer)
    setEditForm({
      customerType: customer.customerType,
      fullName: customer.fullName,
      mobile: customer.mobile ?? '',
      email: customer.email ?? '',
      address: customer.address ?? '',
      notes: customer.notes ?? '',
      isActive: customer.isActive,
    })
  }

  async function handleEditSubmit(event: FormEvent) {
    event.preventDefault()
    if (!editingCustomer || !editForm.fullName.trim()) return
    setEditSubmitting(true)
    try {
      await updateCustomer(editingCustomer.id, {
        customerType: editForm.customerType,
        fullName: editForm.fullName.trim(),
        mobile: editForm.mobile.trim() || null,
        email: editForm.email.trim() || null,
        address: editForm.address.trim() || null,
        notes: editForm.notes.trim() || null,
        isActive: editForm.isActive,
      })
      toast.success('Saved')
      setEditingCustomer(null)
      await reload()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save customer'))
    } finally {
      setEditSubmitting(false)
    }
  }

  function openProfile(customer: CustomerRow) {
    setProfileCustomer(customer)
    setProfileVehicles([])
    setProfileSales([])
    setProfileLoading(true)
    Promise.all([listCustomerVehicles(customer.id), listSalesByCustomer(customer.id)])
      .then(([vehicles, sales]) => {
        setProfileVehicles(vehicles)
        setProfileSales(sales)
      })
      .catch((err) => toast.error(errorMessage(err, 'Failed to load customer history')))
      .finally(() => setProfileLoading(false))
  }

  function openSale(saleId: string) {
    setSelectedSaleId(saleId)
    setSaleDetail(null)
    setSaleDetailLoading(true)
    getSaleDetail(saleId)
      .then(setSaleDetail)
      .catch((err) => toast.error(errorMessage(err, 'Failed to load transaction')))
      .finally(() => setSaleDetailLoading(false))
  }

  const completedSales = profileSales.filter((s) => s.status === 'completed')
  const lifetimeVisits = completedSales.length
  const lifetimeSpend = completedSales.reduce((sum, s) => sum + s.total, 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="text-muted-foreground">Edit contact details and look up a customer's transaction history.</p>
        </div>
        <Button onClick={() => setCreating(true)}>New customer</Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="flex flex-col gap-1.5">
            <Label>Search</Label>
            <Input
              placeholder="Name or mobile number"
              className="w-64"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && reload()}
            />
          </div>
          <Button variant="outline" onClick={() => reload()} disabled={loading}>
            Search
          </Button>
          {query && (
            <Button
              variant="ghost"
              onClick={() => {
                setQuery('')
                reload('')
              }}
              disabled={loading}
            >
              Clear
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : customers.length === 0 ? (
            <p className="text-muted-foreground">No customers found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Vehicles</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        {c.fullName}
                        {c.customerType === 'company' && <Badge variant="outline">Company</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>{c.mobile ?? '—'}</TableCell>
                    <TableCell>{c.email ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{c.plates.length > 0 ? c.plates.join(', ') : '—'}</TableCell>
                    <TableCell>
                      {c.isActive ? <Badge variant="outline">Active</Badge> : <Badge variant="destructive">Inactive</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => openProfile(c)}>
                          History
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openEdit(c)}>
                          Edit
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New customer</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="flex flex-col gap-3">
            <CustomerFormFields idPrefix="create" form={createForm} onChange={setCreateForm} showActiveToggle={false} />
            <DialogFooter>
              <Button type="submit" disabled={createSubmitting}>
                Add customer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingCustomer} onOpenChange={(o) => !o && setEditingCustomer(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit customer</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="flex flex-col gap-3">
            <CustomerFormFields idPrefix="edit" form={editForm} onChange={setEditForm} showActiveToggle />
            <DialogFooter>
              <Button type="submit" disabled={editSubmitting}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!profileCustomer} onOpenChange={(o) => !o && setProfileCustomer(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {profileCustomer?.fullName}
              {profileCustomer?.customerType === 'company' && <Badge variant="outline">Company</Badge>}
              {profileCustomer && !profileCustomer.isActive && <Badge variant="destructive">Inactive</Badge>}
            </DialogTitle>
          </DialogHeader>

          {profileLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="vehicles">Vehicles ({profileVehicles.length})</TabsTrigger>
                <TabsTrigger value="transactions">Transactions ({profileSales.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-sm text-muted-foreground">Lifetime visits</div>
                      <div className="text-xl font-semibold">{lifetimeVisits}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-sm text-muted-foreground">Lifetime spend</div>
                      <div className="text-xl font-semibold">{formatMoney(lifetimeSpend)}</div>
                    </CardContent>
                  </Card>
                </div>
                <div className="flex flex-col gap-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mobile</span>
                    <span>{profileCustomer?.mobile ?? '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Email</span>
                    <span>{profileCustomer?.email ?? '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Address</span>
                    <span className="text-right">{profileCustomer?.address ?? '—'}</span>
                  </div>
                  {profileCustomer?.notes && (
                    <div className="flex flex-col gap-1 border-t pt-2">
                      <span className="text-muted-foreground">Notes</span>
                      <span className="whitespace-pre-wrap">{profileCustomer.notes}</span>
                    </div>
                  )}
                </div>
                <Button variant="outline" onClick={() => profileCustomer && openEdit(profileCustomer)}>
                  Edit customer
                </Button>
              </TabsContent>

              <TabsContent value="vehicles">
                {profileVehicles.length === 0 ? (
                  <p className="text-muted-foreground">No vehicles on file.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Plate</TableHead>
                        <TableHead>Vehicle</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profileVehicles.map((v) => (
                        <TableRow key={v.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {v.plateNumber}
                              {v.plateIsPlaceholder && <Badge variant="outline">No plate</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {[v.make, v.model, v.color].filter(Boolean).join(' ') || '—'}
                          </TableCell>
                          <TableCell>{v.isActive ? <Badge variant="outline">Active</Badge> : <Badge variant="destructive">Inactive</Badge>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>

              <TabsContent value="transactions">
                {profileSales.length === 0 ? (
                  <p className="text-muted-foreground">No transactions yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Sale #</TableHead>
                        <TableHead>Plate</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profileSales.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell>{new Date(s.createdAt).toLocaleDateString()}</TableCell>
                          <TableCell>{s.saleNumber}</TableCell>
                          <TableCell>{s.plateNumber ?? '—'}</TableCell>
                          <TableCell>{formatMoney(s.total)}</TableCell>
                          <TableCell>
                            <Badge variant={s.status === 'completed' ? 'outline' : 'destructive'}>
                              {s.status === 'completed' ? s.paymentStatus : s.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button size="sm" variant="outline" onClick={() => openSale(s.id)}>
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedSaleId} onOpenChange={(o) => !o && setSelectedSaleId(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Transaction detail</DialogTitle>
          </DialogHeader>
          {saleDetailLoading || !saleDetail ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Sale number</span>
                <span className="font-medium">
                  {saleDetail.saleNumber}
                  {saleDetail.status === 'voided' && <Badge variant="destructive" className="ml-2">Voided</Badge>}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Date</span>
                <span>{new Date(saleDetail.createdAt).toLocaleString()}</span>
              </div>
              {saleDetail.plateNumber && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Vehicle</span>
                  <span>
                    {saleDetail.plateNumber}
                    {saleDetail.vehicleModel && ` — ${saleDetail.vehicleModel}`}
                  </span>
                </div>
              )}
              {saleDetail.crewNames.length > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Crew</span>
                  <span>{saleDetail.crewNames.join(', ')}</span>
                </div>
              )}

              <div className="mt-2 flex flex-col gap-1 border-t pt-2">
                {saleDetail.items.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span>
                      {item.name} × {item.quantity}
                    </span>
                    <span>{formatMoney(item.lineTotal)}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-1 border-t pt-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{formatMoney(saleDetail.subtotal)}</span>
                </div>
                {saleDetail.manualDiscount > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Discount</span>
                    <span>−{formatMoney(saleDetail.manualDiscount)}</span>
                  </div>
                )}
                {saleDetail.promotionDiscount > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Promotion discount</span>
                    <span>−{formatMoney(saleDetail.promotionDiscount)}</span>
                  </div>
                )}
                {saleDetail.membershipDiscount > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Free service (stamp card)</span>
                    <span>−{formatMoney(saleDetail.membershipDiscount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-semibold">
                  <span>Total</span>
                  <span>{formatMoney(saleDetail.total - saleDetail.cardProcessingFee)}</span>
                </div>
              </div>

              <div className="flex flex-col gap-1 border-t pt-2 text-sm">
                {saleDetail.payments.map((p, i) => (
                  <div key={i} className="flex justify-between">
                    <span>{p.methodLabel}</span>
                    <span>{formatMoney(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
