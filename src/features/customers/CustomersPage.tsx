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
import { listVehicleSizes, type VehicleSize } from '@/features/catalog/api/catalogApi'
import { createVehicle, updateVehicle } from '@/features/vehicles/api/vehiclesApi'
import { getSaleDetail, listSalesByPlate, type SaleDetail, type SaleListRow } from '@/features/sales/api/salesApi'
import {
  createCustomer,
  linkVehicleCustomer,
  listCustomerVehicles,
  listVehicleCustomers,
  updateCustomer,
  type CustomerVehicle,
  type VehicleCustomerRow,
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

interface CreateFormState {
  plateNumber: string
  make: string
  model: string
  color: string
  vehicleSizeId: string
  customerName: string
  mobile: string
}

const EMPTY_CREATE_FORM: CreateFormState = {
  plateNumber: '',
  make: '',
  model: '',
  color: '',
  vehicleSizeId: '',
  customerName: '',
  mobile: '',
}

interface EditFormState {
  plateNumber: string
  make: string
  model: string
  color: string
  vehicleSizeId: string
  customerType: 'individual' | 'company'
  fullName: string
  mobile: string
  email: string
  address: string
  notes: string
  isActive: boolean
}

export function CustomersPage() {
  const { profile } = useTenant()
  const [rows, setRows] = useState<VehicleCustomerRow[]>([])
  const [sizes, setSizes] = useState<VehicleSize[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE_FORM)
  const [createSubmitting, setCreateSubmitting] = useState(false)

  const [editingRow, setEditingRow] = useState<VehicleCustomerRow | null>(null)
  const [editForm, setEditForm] = useState<EditFormState | null>(null)
  const [editSubmitting, setEditSubmitting] = useState(false)

  const [profileRow, setProfileRow] = useState<VehicleCustomerRow | null>(null)
  const [profileSiblingVehicles, setProfileSiblingVehicles] = useState<CustomerVehicle[]>([])
  const [profileSales, setProfileSales] = useState<SaleListRow[]>([])
  const [profileLoading, setProfileLoading] = useState(false)

  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null)
  const [saleDetail, setSaleDetail] = useState<SaleDetail | null>(null)
  const [saleDetailLoading, setSaleDetailLoading] = useState(false)

  async function reload(searchQuery = query) {
    setLoading(true)
    try {
      setRows(await listVehicleCustomers(searchQuery))
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to load customers'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    listVehicleSizes()
      .then((data) => setSizes(data.filter((s) => s.is_active)))
      .catch((err) => toast.error(errorMessage(err, 'Failed to load vehicle sizes')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const canSubmitCreate = !!(createForm.plateNumber.trim() || createForm.customerName.trim())

  async function handleCreateSubmit(event: FormEvent) {
    event.preventDefault()
    if (!profile || !canSubmitCreate) return
    setCreateSubmitting(true)
    try {
      const customerName = createForm.customerName.trim()
      let customerId: string | null = null
      if (customerName) {
        customerId = await createCustomer({
          tenantId: profile.tenantId,
          customerType: 'individual',
          fullName: customerName,
          mobile: createForm.mobile.trim() || null,
          email: null,
          address: null,
          notes: null,
        })
      }
      await createVehicle({
        tenantId: profile.tenantId,
        customerId,
        plateNumber: createForm.plateNumber.trim() || null,
        placeholderBase: customerName || null,
        make: createForm.make.trim() || null,
        model: createForm.model.trim() || null,
        color: createForm.color.trim() || null,
        vehicleType: null,
        vehicleSizeId: createForm.vehicleSizeId || null,
      })
      toast.success('Vehicle added')
      setCreating(false)
      setCreateForm(EMPTY_CREATE_FORM)
      await reload()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to add vehicle'))
    } finally {
      setCreateSubmitting(false)
    }
  }

  function openEdit(row: VehicleCustomerRow) {
    setProfileRow(null)
    setEditingRow(row)
    setEditForm({
      plateNumber: row.plateIsPlaceholder ? '' : row.plateNumber,
      make: row.make ?? '',
      model: row.model ?? '',
      color: row.color ?? '',
      vehicleSizeId: row.vehicleSizeId ?? '',
      customerType: row.customerType ?? 'individual',
      fullName: row.customerName ?? '',
      mobile: row.mobile ?? '',
      email: row.email ?? '',
      address: row.address ?? '',
      notes: row.notes ?? '',
      isActive: row.customerActive,
    })
  }

  async function handleEditSubmit(event: FormEvent) {
    event.preventDefault()
    if (!editingRow || !editForm || !profile) return
    const hasCustomer = !!editingRow.customerId
    if (hasCustomer && !editForm.fullName.trim()) {
      toast.error('Customer name is required')
      return
    }
    setEditSubmitting(true)
    try {
      if (editForm.plateNumber.trim()) {
        await updateVehicle(editingRow.vehicleId, {
          plateNumber: editForm.plateNumber.trim().toUpperCase(),
          make: editForm.make.trim() || null,
          model: editForm.model.trim() || null,
          color: editForm.color.trim() || null,
          vehicleSizeId: editForm.vehicleSizeId || null,
        })
      }

      if (hasCustomer) {
        await updateCustomer(editingRow.customerId as string, {
          customerType: editForm.customerType,
          fullName: editForm.fullName.trim(),
          mobile: editForm.mobile.trim() || null,
          email: editForm.email.trim() || null,
          address: editForm.address.trim() || null,
          notes: editForm.notes.trim() || null,
          isActive: editForm.isActive,
        })
      } else if (editForm.fullName.trim()) {
        const newCustomerId = await createCustomer({
          tenantId: profile.tenantId,
          customerType: editForm.customerType,
          fullName: editForm.fullName.trim(),
          mobile: editForm.mobile.trim() || null,
          email: editForm.email.trim() || null,
          address: editForm.address.trim() || null,
          notes: editForm.notes.trim() || null,
        })
        await linkVehicleCustomer(editingRow.vehicleId, newCustomerId)
      }

      toast.success('Saved')
      setEditingRow(null)
      await reload()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save'))
    } finally {
      setEditSubmitting(false)
    }
  }

  function openProfile(row: VehicleCustomerRow) {
    setProfileRow(row)
    setProfileSiblingVehicles([])
    setProfileSales([])
    setProfileLoading(true)
    const salesPromise = listSalesByPlate(row.plateNumber)
    const siblingsPromise = row.customerId ? listCustomerVehicles(row.customerId) : Promise.resolve<CustomerVehicle[]>([])
    Promise.all([salesPromise, siblingsPromise])
      .then(([sales, siblings]) => {
        setProfileSales(sales)
        setProfileSiblingVehicles(siblings.filter((v) => v.id !== row.vehicleId))
      })
      .catch((err) => toast.error(errorMessage(err, 'Failed to load history')))
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
          <p className="text-muted-foreground">
            Every registered vehicle, plate-only walk-ins included — edit contact details and look up transaction history.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>New vehicle</Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="flex flex-col gap-1.5">
            <Label>Search</Label>
            <Input
              placeholder="Plate number, customer name, or mobile"
              className="w-72"
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
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground">No vehicles found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plate</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.vehicleId}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        {row.plateIsPlaceholder ? '—' : row.plateNumber}
                        {row.plateIsPlaceholder && <Badge variant="outline">No plate</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {[row.make, row.model, row.color].filter(Boolean).join(' ') || '—'}
                    </TableCell>
                    <TableCell>
                      {row.customerName ? (
                        <div className="flex items-center gap-2">
                          {row.customerName}
                          {row.customerType === 'company' && <Badge variant="outline">Company</Badge>}
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic">Walk-in</span>
                      )}
                    </TableCell>
                    <TableCell>{row.mobile ?? '—'}</TableCell>
                    <TableCell>
                      {row.vehicleActive ? <Badge variant="outline">Active</Badge> : <Badge variant="destructive">Inactive</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => openProfile(row)}>
                          History
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
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
            <DialogTitle>New vehicle</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="create-plate">Plate{createForm.customerName.trim() ? ' (optional — leave blank if none yet)' : ''}</Label>
                <Input
                  id="create-plate"
                  value={createForm.plateNumber}
                  onChange={(e) => setCreateForm({ ...createForm, plateNumber: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="create-color">Color</Label>
                <Input id="create-color" value={createForm.color} onChange={(e) => setCreateForm({ ...createForm, color: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="create-make">Make</Label>
                <Input
                  id="create-make"
                  value={createForm.make}
                  onChange={(e) => setCreateForm({ ...createForm, make: e.target.value })}
                  placeholder="Toyota"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="create-model">Model</Label>
                <Input
                  id="create-model"
                  value={createForm.model}
                  onChange={(e) => setCreateForm({ ...createForm, model: e.target.value })}
                  placeholder="Fortuner"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="create-size">Vehicle size</Label>
                <Select value={createForm.vehicleSizeId} onValueChange={(v) => setCreateForm({ ...createForm, vehicleSizeId: v })}>
                  <SelectTrigger id="create-size">
                    <SelectValue placeholder="Select size" />
                  </SelectTrigger>
                  <SelectContent>
                    {sizes.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="create-customer">Customer name (optional)</Label>
                <Input
                  id="create-customer"
                  value={createForm.customerName}
                  onChange={(e) => setCreateForm({ ...createForm, customerName: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="create-mobile">Mobile (optional)</Label>
                <Input id="create-mobile" value={createForm.mobile} onChange={(e) => setCreateForm({ ...createForm, mobile: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createSubmitting || !canSubmitCreate}>
                Add vehicle
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingRow} onOpenChange={(o) => !o && setEditingRow(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit vehicle & customer</DialogTitle>
          </DialogHeader>
          {editForm && (
            <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-3">
                <div className="text-sm font-medium text-muted-foreground">Vehicle</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit-plate">Plate</Label>
                    <Input
                      id="edit-plate"
                      value={editForm.plateNumber}
                      onChange={(e) => setEditForm({ ...editForm, plateNumber: e.target.value })}
                      placeholder={editingRow?.plateIsPlaceholder ? 'No plate yet' : undefined}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit-color">Color</Label>
                    <Input id="edit-color" value={editForm.color} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit-make">Make</Label>
                    <Input id="edit-make" value={editForm.make} onChange={(e) => setEditForm({ ...editForm, make: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit-model">Model</Label>
                    <Input id="edit-model" value={editForm.model} onChange={(e) => setEditForm({ ...editForm, model: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit-size">Vehicle size</Label>
                    <Select value={editForm.vehicleSizeId} onValueChange={(v) => setEditForm({ ...editForm, vehicleSizeId: v })}>
                      <SelectTrigger id="edit-size">
                        <SelectValue placeholder="Select size" />
                      </SelectTrigger>
                      <SelectContent>
                        {sizes.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t pt-3">
                <div className="text-sm font-medium text-muted-foreground">
                  Customer {!editingRow?.customerId && <span className="font-normal">(optional — leave name blank to keep this a walk-in)</span>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-cust-type">Type</Label>
                  <Select
                    value={editForm.customerType}
                    onValueChange={(v) => setEditForm({ ...editForm, customerType: v as 'individual' | 'company' })}
                  >
                    <SelectTrigger id="edit-cust-type">
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
                  <Label htmlFor="edit-cust-name">{editForm.customerType === 'company' ? 'Company name' : 'Full name'}</Label>
                  <Input
                    id="edit-cust-name"
                    value={editForm.fullName}
                    onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                  />
                </div>
                <div className="flex gap-3">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="edit-cust-mobile">Mobile</Label>
                    <Input
                      id="edit-cust-mobile"
                      value={editForm.mobile}
                      onChange={(e) => setEditForm({ ...editForm, mobile: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="edit-cust-email">Email</Label>
                    <Input
                      id="edit-cust-email"
                      type="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-cust-address">Address</Label>
                  <Input
                    id="edit-cust-address"
                    value={editForm.address}
                    onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-cust-notes">Notes</Label>
                  <Textarea
                    id="edit-cust-notes"
                    value={editForm.notes}
                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                    rows={3}
                  />
                </div>
                {(editingRow?.customerId || editForm.fullName.trim()) && (
                  <label className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      Active
                      <span className="block text-xs text-muted-foreground">
                        Inactive customers are kept for history but hidden from pickers.
                      </span>
                    </span>
                    <Switch checked={editForm.isActive} onCheckedChange={(c) => setEditForm({ ...editForm, isActive: c })} />
                  </label>
                )}
              </div>

              <DialogFooter>
                <Button type="submit" disabled={editSubmitting}>
                  Save
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!profileRow} onOpenChange={(o) => !o && setProfileRow(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {profileRow?.plateIsPlaceholder ? profileRow?.customerName : profileRow?.plateNumber}
              {profileRow?.plateIsPlaceholder && <Badge variant="outline">No plate</Badge>}
              {profileRow && !profileRow.vehicleActive && <Badge variant="destructive">Inactive</Badge>}
            </DialogTitle>
          </DialogHeader>

          {profileLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
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
                    <span className="text-muted-foreground">Vehicle</span>
                    <span>{[profileRow?.make, profileRow?.model, profileRow?.color].filter(Boolean).join(' ') || '—'}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 border-t pt-2 text-sm">
                  {profileRow?.customerName ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Customer</span>
                        <span>
                          {profileRow.customerName}
                          {profileRow.customerType === 'company' && <Badge variant="outline" className="ml-2">Company</Badge>}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Mobile</span>
                        <span>{profileRow.mobile ?? '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Email</span>
                        <span>{profileRow.email ?? '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Address</span>
                        <span className="text-right">{profileRow.address ?? '—'}</span>
                      </div>
                      {profileRow.notes && (
                        <div className="flex flex-col gap-1 border-t pt-2">
                          <span className="text-muted-foreground">Notes</span>
                          <span className="whitespace-pre-wrap">{profileRow.notes}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-muted-foreground">No customer linked — plate-only walk-in.</p>
                  )}
                </div>

                {profileSiblingVehicles.length > 0 && (
                  <div className="flex flex-col gap-1 border-t pt-2 text-sm">
                    <span className="text-muted-foreground">Other vehicles for this customer</span>
                    <div className="flex flex-wrap gap-1.5">
                      {profileSiblingVehicles.map((v) => (
                        <Badge key={v.id} variant="outline">
                          {v.plateIsPlaceholder ? 'No plate' : v.plateNumber}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <Button variant="outline" onClick={() => profileRow && openEdit(profileRow)}>
                  Edit
                </Button>
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
                          <TableCell>{formatMoney(s.total)}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge variant={s.status === 'completed' ? 'outline' : 'destructive'}>
                                {s.status === 'completed' ? s.paymentStatus : s.status}
                              </Badge>
                              {s.status === 'completed' && s.missingCrew && (
                                <Badge variant="destructive" title="No crew assigned on this job yet -- commission hasn't been earned by anyone">
                                  No crew
                                </Badge>
                              )}
                            </div>
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
