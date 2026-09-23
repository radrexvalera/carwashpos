import { useEffect, useState } from 'react'
import {
  BarChart3,
  CalendarClock,
  Car,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  FlaskConical,
  FolderTree,
  LayoutDashboard,
  ListChecks,
  Menu,
  Moon,
  Package,
  Percent,
  Receipt,
  Ruler,
  Settings as SettingsIcon,
  ShoppingCart,
  Sun,
  Tags,
  Truck,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { Role } from '@/lib/supabase/types'
import { useOfflineBootstrap } from '@/lib/offline/useOfflineBootstrap'
import { useOnlineStatus } from '@/lib/offline/useOnlineStatus'
import { SyncStatusBadge } from '@/lib/offline/SyncStatusBadge'
import { useTheme } from '@/lib/theme/useTheme'
import { getSettings } from '@/features/settings/api/settingsApi'
import { listLocations } from '@/features/catalog/api/catalogApi'
import { useAuth } from './AuthProvider'
import { useTenant } from './TenantProvider'

type NavLeaf = { to: string; label: string; icon: LucideIcon }
type NavGroup = { label: string; roles: Role[]; items: NavLeaf[] }
type NavEntry = ({ kind: 'leaf' } & NavLeaf & { roles?: Role[] }) | ({ kind: 'group' } & NavGroup)

const navEntries: NavEntry[] = [
  { kind: 'leaf', to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { kind: 'leaf', to: '/register', label: 'Register', icon: ShoppingCart },
  { kind: 'leaf', to: '/appointments', label: 'Appointments', icon: CalendarClock },
  { kind: 'leaf', to: '/jobs', label: 'Job Queue', icon: ListChecks },
  { kind: 'leaf', to: '/shift', label: 'My Shift', icon: Clock },
  { kind: 'leaf', to: '/transactions', label: 'Transactions', icon: Receipt },
  {
    kind: 'group',
    label: 'Reports',
    roles: ['admin', 'manager'],
    items: [
      { to: '/reports/commission', label: 'Commission Report', icon: Percent },
      { to: '/reports/sales', label: 'Sales Report', icon: BarChart3 },
    ],
  },
  {
    kind: 'group',
    label: 'Catalog & Pricing',
    roles: ['admin', 'manager'],
    items: [
      { to: '/admin/services', label: 'Services', icon: Tags },
      { to: '/admin/service-categories', label: 'Service Categories', icon: FolderTree },
      { to: '/admin/vehicle-sizes', label: 'Vehicle Sizes', icon: Car },
      { to: '/admin/service-prices', label: 'Pricing', icon: DollarSign },
      { to: '/admin/bays', label: 'Bays', icon: Warehouse },
    ],
  },
  {
    kind: 'group',
    label: 'Inventory',
    roles: ['admin', 'manager'],
    items: [
      { to: '/inventory', label: 'Inventory', icon: Package },
      { to: '/inventory/purchases', label: 'Purchases', icon: ShoppingCart },
      { to: '/admin/suppliers', label: 'Suppliers', icon: Truck },
      { to: '/admin/service-recipes', label: 'Service Recipes', icon: FlaskConical },
      { to: '/admin/inventory-categories', label: 'Inventory Categories', icon: FolderTree },
      { to: '/admin/inventory-units', label: 'Inventory Units', icon: Ruler },
    ],
  },
  {
    kind: 'group',
    label: 'Staff & Payroll',
    roles: ['admin', 'manager'],
    items: [
      { to: '/admin/employees', label: 'Employees', icon: Users },
      { to: '/admin/commission-rules', label: 'Commission Rules', icon: Percent },
      { to: '/payroll', label: 'Payroll', icon: Wallet },
    ],
  },
  {
    kind: 'group',
    label: 'Finance',
    roles: ['admin', 'manager'],
    items: [
      { to: '/expenses', label: 'Expenses', icon: Receipt },
      { to: '/admin/expense-categories', label: 'Expense Categories', icon: FolderTree },
    ],
  },
  { kind: 'leaf', to: '/admin/settings', label: 'Settings', icon: SettingsIcon, roles: ['admin'] },
]

const navLinkClassName = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent',
    isActive && 'bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary',
  )

function SidebarNavContent({
  entries,
  openGroups,
  onToggleGroup,
  onNavigate,
}: {
  entries: NavEntry[]
  openGroups: Record<string, boolean>
  onToggleGroup: (label: string) => void
  onNavigate?: () => void
}) {
  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
      {entries.map((entry) => {
        if (entry.kind === 'leaf') {
          return (
            <NavLink key={entry.to} to={entry.to} end={entry.to === '/'} className={navLinkClassName} onClick={onNavigate}>
              <entry.icon className="size-4 shrink-0" />
              {entry.label}
            </NavLink>
          )
        }

        const isOpen = Boolean(openGroups[entry.label])
        return (
          <div key={entry.label}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => onToggleGroup(entry.label)}
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent"
            >
              {entry.label}
              {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
            {isOpen && (
              <div className="flex flex-col gap-1 pl-3">
                {entry.items.map((item) => (
                  <NavLink key={item.to} to={item.to} className={navLinkClassName} onClick={onNavigate}>
                    <item.icon className="size-4 shrink-0" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

function OnlineIndicator() {
  const online = useOnlineStatus()
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span className={cn('size-2 rounded-full', online ? 'bg-green-500' : 'bg-muted-foreground')} />
      <span className="hidden text-muted-foreground sm:inline">{online ? 'Online' : 'Offline'}</span>
    </div>
  )
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  return (
    <Button variant="ghost" size="icon" onClick={toggleTheme}>
      {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </Button>
  )
}

function AvatarMenu({ onSignOut }: { onSignOut: () => void }) {
  const { profile } = useTenant()
  const initial = profile?.fullName?.trim()?.[0]?.toUpperCase() ?? '?'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex size-8 items-center justify-center rounded-full bg-[#7e14ff] text-sm font-semibold text-white"
          aria-label="Account menu"
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          {profile?.fullName}
          <div className="text-xs font-normal text-muted-foreground">{profile?.role}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppShell() {
  const { signOut } = useAuth()
  const { profile } = useTenant()
  const { pathname } = useLocation()
  useOfflineBootstrap(profile?.tenantId)

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    for (const entry of navEntries) {
      if (entry.kind === 'group' && entry.items.some((item) => item.to === pathname)) {
        initial[entry.label] = true
      }
    }
    return initial
  })

  function toggleGroup(label: string) {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }))
  }

  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [businessName, setBusinessName] = useState('')
  const [locationName, setLocationName] = useState('')

  useEffect(() => {
    if (!profile) return
    Promise.all([getSettings(profile.tenantId), listLocations()])
      .then(([settings, locations]) => {
        setBusinessName(settings.business_name)
        setLocationName(locations[0]?.name ?? '')
      })
      .catch(() => {
        // Best-effort -- the breadcrumb is a nice-to-have, not worth surfacing an error toast for.
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.tenantId])

  const visibleEntries = navEntries.filter((entry) => !entry.roles || (profile && entry.roles.includes(profile.role)))

  return (
    <div className="flex h-screen flex-col print:h-auto">
      <header className="flex items-center justify-between border-b p-3 print:hidden">
        <div className="flex items-center gap-2">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileNavOpen(true)}>
              <Menu className="size-5" />
            </Button>
            <SheetContent side="left" className="flex w-72 flex-col gap-0 p-0">
              <SheetHeader className="border-b">
                <SheetTitle>{businessName || 'Car Wash POS'}</SheetTitle>
              </SheetHeader>
              <SidebarNavContent
                entries={visibleEntries}
                openGroups={openGroups}
                onToggleGroup={toggleGroup}
                onNavigate={() => setMobileNavOpen(false)}
              />
              <div className="border-t p-3">
                <SyncStatusBadge />
              </div>
            </SheetContent>
          </Sheet>
          <span className="font-semibold">
            {businessName || 'Car Wash POS'}
            {locationName && <span className="font-normal text-muted-foreground"> / {locationName}</span>}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <OnlineIndicator />
          <ThemeToggle />
          <AvatarMenu onSignOut={() => signOut()} />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden print:overflow-visible lg:flex-row">
        <aside className="hidden w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground print:hidden lg:flex">
          <SidebarNavContent entries={visibleEntries} openGroups={openGroups} onToggleGroup={toggleGroup} />
          <div className="border-t p-3">
            <SyncStatusBadge />
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto p-4 print:overflow-visible print:p-0 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
