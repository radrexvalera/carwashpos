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
  { to: '/register', label: 'Register' },
  { to: '/jobs', label: 'Job Queue' },
  { to: '/shift', label: 'My Shift' },
  { to: '/my-commission', label: 'My Commission' },
  { to: '/reports/commission', label: 'Commission Report', roles: ['admin', 'manager'] },
  { to: '/reports/sales', label: 'Sales Report', roles: ['admin', 'manager'] },
  { to: '/payroll', label: 'Payroll', roles: ['admin', 'manager'] },
  { to: '/expenses', label: 'Expenses', roles: ['admin', 'manager'] },
  { to: '/loyalty', label: 'Loyalty', roles: ['admin', 'manager'] },
  { to: '/admin/services', label: 'Services', roles: ['admin', 'manager'] },
  { to: '/admin/service-categories', label: 'Service Categories', roles: ['admin', 'manager'] },
  { to: '/admin/vehicle-sizes', label: 'Vehicle Sizes', roles: ['admin', 'manager'] },
  { to: '/admin/service-prices', label: 'Pricing', roles: ['admin', 'manager'] },
  { to: '/admin/bays', label: 'Bays', roles: ['admin', 'manager'] },
  { to: '/admin/employees', label: 'Employees', roles: ['admin', 'manager'] },
  { to: '/admin/commission-rules', label: 'Commission Rules', roles: ['admin', 'manager'] },
  { to: '/admin/promotions', label: 'Promotions', roles: ['admin', 'manager'] },
  { to: '/inventory', label: 'Inventory', roles: ['admin', 'manager'] },
  { to: '/inventory/purchases', label: 'Purchases', roles: ['admin', 'manager'] },
  { to: '/admin/suppliers', label: 'Suppliers', roles: ['admin', 'manager'] },
  { to: '/admin/service-recipes', label: 'Service Recipes', roles: ['admin', 'manager'] },
  { to: '/admin/inventory-categories', label: 'Inventory Categories', roles: ['admin', 'manager'] },
  { to: '/admin/inventory-units', label: 'Inventory Units', roles: ['admin', 'manager'] },
  { to: '/admin/expense-categories', label: 'Expense Categories', roles: ['admin', 'manager'] },
  { to: '/admin/settings', label: 'Settings', roles: ['admin'] },
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
