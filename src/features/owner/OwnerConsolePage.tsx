import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '@/app/AuthProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { KNOWN_FEATURES, listOwnerTenants, updateTenantFeature, updateTenantTrial, type OwnerTenantRow } from './api/ownerConsoleApi'

function trialStatus(trialEndsAt: string | null): { label: string; variant: 'outline' | 'secondary' | 'destructive' } {
  if (!trialEndsAt) return { label: 'Active (no trial)', variant: 'outline' }
  const daysLeft = Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000)
  if (daysLeft < 0) return { label: 'Expired', variant: 'destructive' }
  return { label: `Trialing — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`, variant: 'secondary' }
}

export function OwnerConsolePage() {
  const { session, loading: authLoading } = useAuth()
  const [tenants, setTenants] = useState<OwnerTenantRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [customDate, setCustomDate] = useState<Record<string, string>>({})

  function load() {
    setLoading(true)
    setLoadError(null)
    listOwnerTenants()
      .then(setTenants)
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load subscribers'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (session) load()
  }, [session])

  async function handleUpdate(tenantId: string, trialEndsAt: string | null, successMessage: string) {
    setBusyId(tenantId)
    try {
      await updateTenantTrial(tenantId, trialEndsAt)
      setTenants((prev) => prev.map((t) => (t.id === tenantId ? { ...t, trialEndsAt } : t)))
      toast.success(successMessage)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setBusyId(null)
    }
  }

  function handleExtend14(tenant: OwnerTenantRow) {
    const base = tenant.trialEndsAt && new Date(tenant.trialEndsAt).getTime() > Date.now() ? new Date(tenant.trialEndsAt) : new Date()
    const next = new Date(base.getTime() + 14 * 86_400_000)
    handleUpdate(tenant.id, next.toISOString(), 'Extended 14 days')
  }

  function handleSetCustom(tenant: OwnerTenantRow) {
    const value = customDate[tenant.id]
    if (!value) return
    const date = new Date(`${value}T23:59:59`)
    handleUpdate(tenant.id, date.toISOString(), 'Trial date updated')
  }

  function handleClear(tenant: OwnerTenantRow) {
    handleUpdate(tenant.id, null, 'Trial cleared — account is now permanently active')
  }

  async function handleToggleFeature(tenant: OwnerTenantRow, feature: string, enabled: boolean) {
    setBusyId(tenant.id)
    try {
      await updateTenantFeature(tenant.id, feature, enabled)
      setTenants((prev) =>
        prev.map((t) => (t.id === tenant.id ? { ...t, features: { ...t.features, [feature]: enabled } } : t)),
      )
      toast.success(`${enabled ? 'Enabled' : 'Disabled'} ${feature} for ${tenant.name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update feature')
    } finally {
      setBusyId(null)
    }
  }

  if (authLoading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading…</div>
  if (!session) return <Navigate to="/login" replace />

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Owner Console</h1>
        <p className="text-muted-foreground">Manage subscriber trial status across every tenant. Not linked from the main app nav.</p>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : loadError ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">{loadError}</CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Subscribers ({tenants.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business</TableHead>
                  <TableHead>Admin email</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trial ends</TableHead>
                  <TableHead>Features</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((t) => {
                  const status = trialStatus(t.trialEndsAt)
                  const busy = busyId === t.id
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{t.adminEmail ?? '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{new Date(t.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {t.trialEndsAt ? new Date(t.trialEndsAt).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1.5">
                          {KNOWN_FEATURES.map((f) => (
                            <label key={f.key} className="flex items-center gap-2 text-sm">
                              <Switch
                                checked={!!t.features[f.key]}
                                disabled={busy}
                                onCheckedChange={(checked) => handleToggleFeature(t, f.key, checked)}
                              />
                              {f.label}
                            </label>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => handleExtend14(t)}>
                            +14 days
                          </Button>
                          <Input
                            type="date"
                            className="h-8 w-36"
                            value={customDate[t.id] ?? ''}
                            onChange={(e) => setCustomDate((prev) => ({ ...prev, [t.id]: e.target.value }))}
                          />
                          <Button size="sm" variant="outline" disabled={busy || !customDate[t.id]} onClick={() => handleSetCustom(t)}>
                            Set
                          </Button>
                          {t.trialEndsAt && (
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => handleClear(t)}>
                              Clear (upgrade)
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {tenants.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      No tenants yet.
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
