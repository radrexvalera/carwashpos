import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { Role } from '@/lib/supabase/types'
import { useOfflineBootstrap } from '@/lib/offline/useOfflineBootstrap'
import { SyncStatusBadge } from '@/lib/offline/SyncStatusBadge'
import { useAuth } from './AuthProvider'
import { useTenant } from './TenantProvider'

const navItems: { to: string; label: string; roles?: Role[] }[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/pos', label: 'Register' },
  { to: '/bay-board', label: 'Bay Board' },
  { to: '/admin/services', label: 'Services', roles: ['admin', 'manager'] },
  { to: '/admin/vehicle-size-classes', label: 'Vehicle Sizes', roles: ['admin', 'manager'] },
  { to: '/admin/service-prices', label: 'Pricing', roles: ['admin', 'manager'] },
  { to: '/admin/bays', label: 'Bays', roles: ['admin', 'manager'] },
]

export function AppShell() {
  const { signOut } = useAuth()
  const { profile } = useTenant()
  useOfflineBootstrap(profile?.tenantId)

  const visibleItems = navItems.filter((item) => !item.roles || (profile && item.roles.includes(profile.role)))

  return (
    <div className="flex h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="border-b px-4 py-4 font-semibold">Car Wash POS</div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent',
                  isActive && 'bg-sidebar-accent font-medium',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3">
          <div className="mb-2 px-1 text-xs text-muted-foreground">
            {profile?.fullName} · {profile?.role}
          </div>
          <div className="mb-2">
            <SyncStatusBadge />
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={() => signOut()}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
