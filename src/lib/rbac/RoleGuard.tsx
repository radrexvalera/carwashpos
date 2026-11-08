import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
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
  const { session, loading: authLoading, signOut } = useAuth()
  const { profile, loading: tenantLoading } = useTenant()

  if (authLoading || (session && tenantLoading)) {
    return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading…</div>
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (!profile || !profile.active) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
        <p>Your account isn't set up yet. Contact an admin.</p>
        {/* Covers signing up on one device and confirming on another (e.g. phone) -- the browser
            here can be left holding an unrelated, already-expired session from earlier testing,
            which looks identical to this "no profile" case but just needs clearing so the real
            login form (with the right account's email/password) is reachable again. */}
        <Button variant="outline" size="sm" onClick={() => signOut()}>
          Sign out and try a different account
        </Button>
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
