import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/app/AuthProvider'
import { TenantProvider } from '@/app/TenantProvider'
import { AppShell } from '@/app/AppShell'
import { RoleGuard } from '@/lib/rbac/RoleGuard'

// Route-level code splitting -- these 26+ pages were previously all eagerly bundled into one
// >1MB chunk (the build has warned about this since Phase 5). Each import() becomes its own
// chunk, fetched only when that route is actually visited.
const LoginPage = lazy(() => import('@/features/auth/LoginPage').then((m) => ({ default: m.LoginPage })))
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const ServicesPage = lazy(() => import('@/features/catalog/ServicesPage').then((m) => ({ default: m.ServicesPage })))
const ServiceCategoriesPage = lazy(() =>
  import('@/features/catalog/ServiceCategoriesPage').then((m) => ({ default: m.ServiceCategoriesPage })),
)
const VehicleSizesPage = lazy(() => import('@/features/catalog/VehicleSizesPage').then((m) => ({ default: m.VehicleSizesPage })))
const ServicePricesPage = lazy(() => import('@/features/catalog/ServicePricesPage').then((m) => ({ default: m.ServicePricesPage })))
const BaysPage = lazy(() => import('@/features/catalog/BaysPage').then((m) => ({ default: m.BaysPage })))
const EmployeesPage = lazy(() => import('@/features/employees/EmployeesPage').then((m) => ({ default: m.EmployeesPage })))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const RegisterPage = lazy(() => import('@/features/jobs/RegisterPage').then((m) => ({ default: m.RegisterPage })))
const JobQueuePage = lazy(() => import('@/features/jobs/JobQueuePage').then((m) => ({ default: m.JobQueuePage })))
const JobPaymentPage = lazy(() => import('@/features/jobs/JobPaymentPage').then((m) => ({ default: m.JobPaymentPage })))
const ShiftPage = lazy(() => import('@/features/shifts/ShiftPage').then((m) => ({ default: m.ShiftPage })))
const CommissionRulesPage = lazy(() =>
  import('@/features/commission/CommissionRulesPage').then((m) => ({ default: m.CommissionRulesPage })),
)
const CommissionReportPage = lazy(() =>
  import('@/features/commission/CommissionReportPage').then((m) => ({ default: m.CommissionReportPage })),
)
const AttendantDashboardPage = lazy(() =>
  import('@/features/commission/AttendantDashboardPage').then((m) => ({ default: m.AttendantDashboardPage })),
)
const PayrollPage = lazy(() => import('@/features/payroll/PayrollPage').then((m) => ({ default: m.PayrollPage })))
const InventoryCategoriesPage = lazy(() =>
  import('@/features/inventory/InventoryCategoriesPage').then((m) => ({ default: m.InventoryCategoriesPage })),
)
const InventoryUnitsPage = lazy(() =>
  import('@/features/inventory/InventoryUnitsPage').then((m) => ({ default: m.InventoryUnitsPage })),
)
const InventoryItemsPage = lazy(() =>
  import('@/features/inventory/InventoryItemsPage').then((m) => ({ default: m.InventoryItemsPage })),
)
const SuppliersPage = lazy(() => import('@/features/inventory/SuppliersPage').then((m) => ({ default: m.SuppliersPage })))
const PurchaseOrdersPage = lazy(() =>
  import('@/features/inventory/PurchaseOrdersPage').then((m) => ({ default: m.PurchaseOrdersPage })),
)
const ServiceRecipesPage = lazy(() =>
  import('@/features/inventory/ServiceRecipesPage').then((m) => ({ default: m.ServiceRecipesPage })),
)
const ExpensesPage = lazy(() => import('@/features/expenses/ExpensesPage').then((m) => ({ default: m.ExpensesPage })))
const ExpenseCategoriesPage = lazy(() =>
  import('@/features/expenses/ExpenseCategoriesPage').then((m) => ({ default: m.ExpenseCategoriesPage })),
)
const SalesReportPage = lazy(() => import('@/features/reports/SalesReportPage').then((m) => ({ default: m.SalesReportPage })))
const PromotionsPage = lazy(() => import('@/features/promotions/PromotionsPage').then((m) => ({ default: m.PromotionsPage })))
const LoyaltyPage = lazy(() => import('@/features/loyalty/LoyaltyPage').then((m) => ({ default: m.LoyaltyPage })))
const FleetAccountsPage = lazy(() => import('@/features/fleet/FleetAccountsPage').then((m) => ({ default: m.FleetAccountsPage })))
const MembershipProgramsPage = lazy(() =>
  import('@/features/memberships/MembershipProgramsPage').then((m) => ({ default: m.MembershipProgramsPage })),
)
const AppointmentsPage = lazy(() => import('@/features/appointments/AppointmentsPage').then((m) => ({ default: m.AppointmentsPage })))

function RouteLoading() {
  return <p className="p-6 text-muted-foreground">Loading…</p>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TenantProvider>
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                element={
                  <RoleGuard>
                    <AppShell />
                  </RoleGuard>
                }
              >
                <Route path="/" element={<DashboardPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/appointments" element={<AppointmentsPage />} />
                <Route path="/jobs" element={<JobQueuePage />} />
                <Route path="/jobs/:jobId/pay" element={<JobPaymentPage />} />
                <Route path="/shift" element={<ShiftPage />} />
                <Route path="/my-commission" element={<AttendantDashboardPage />} />
                <Route
                  path="/admin/commission-rules"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <CommissionRulesPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/reports/commission"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <CommissionReportPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/payroll"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <PayrollPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/admin/services"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <ServicesPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/admin/service-categories"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <ServiceCategoriesPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/admin/vehicle-sizes"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <VehicleSizesPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/admin/service-prices"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <ServicePricesPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/admin/bays"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <BaysPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/admin/employees"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <EmployeesPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/admin/settings"
                  element={
                    <RoleGuard allowedRoles={['admin']}>
                      <SettingsPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/inventory"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <InventoryItemsPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/admin/inventory-categories"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <InventoryCategoriesPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/admin/inventory-units"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <InventoryUnitsPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/admin/suppliers"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <SuppliersPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/inventory/purchases"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <PurchaseOrdersPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/admin/service-recipes"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <ServiceRecipesPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/expenses"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <ExpensesPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/admin/expense-categories"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <ExpenseCategoriesPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/reports/sales"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <SalesReportPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/admin/promotions"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <PromotionsPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/loyalty"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <LoyaltyPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/admin/fleet-accounts"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <FleetAccountsPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/admin/membership-programs"
                  element={
                    <RoleGuard allowedRoles={['admin', 'manager']}>
                      <MembershipProgramsPage />
                    </RoleGuard>
                  }
                />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </TenantProvider>
      </AuthProvider>
      <Toaster />
    </BrowserRouter>
  )
}
