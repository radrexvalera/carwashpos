import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/app/AuthProvider'
import { useTenant } from '@/app/TenantProvider'
import type { Role } from '@/lib/supabase/types'

interface RoleGuardProps {
  allowedRoles?: Role[]
  children: ReactNode
}

// Wraps a route: redirects to /login if unauthenticated, blocks with a message if the caller's
// role isn't in allowedRoles. This is a UX convenience only -- RLS on the Supabase side is the
// real enforcement boundary (see supabase/migrations/0002_rls_policies.sql).
export function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  const { session, loading: authLoading } = useAuth()
  const { profile, loading: tenantLoading } = useTenant()

  if (authLoading || (session && tenantLoading)) {
    return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading…</div>
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (!profile || !profile.active) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Your account isn't set up yet. Contact an admin.
      </div>
    )
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        You don't have access to this page.
      </div>
    )
  }

  return <>{children}</>
}
