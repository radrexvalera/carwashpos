import { Suspense } from 'react'
import { lazyWithRetry } from '@/lib/lazyWithRetry'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/app/AuthProvider'
import { TenantProvider } from '@/app/TenantProvider'
import { AppShell } from '@/app/AppShell'
import { RoleGuard } from '@/lib/rbac/RoleGuard'

// Route-level code splitting -- these 26+ pages were previously all eagerly bundled into one
// >1MB chunk (the build has warned about this since Phase 5). Each import() becomes its own
// chunk, fetched only when that route is actually visited.
const LoginPage = lazyWithRetry(() => import('@/features/auth/LoginPage').then((m) => ({ default: m.LoginPage })))
const DashboardPage = lazyWithRetry(() => import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const ServicesPage = lazyWithRetry(() => import('@/features/catalog/ServicesPage').then((m) => ({ default: m.ServicesPage })))
const ServiceCategoriesPage = lazyWithRetry(() =>
  import('@/features/catalog/ServiceCategoriesPage').then((m) => ({ default: m.ServiceCategoriesPage })),
)
const VehicleSizesPage = lazyWithRetry(() => import('@/features/catalog/VehicleSizesPage').then((m) => ({ default: m.VehicleSizesPage })))
const ServicePricesPage = lazyWithRetry(() => import('@/features/catalog/ServicePricesPage').then((m) => ({ default: m.ServicePricesPage })))
const BaysPage = lazyWithRetry(() => import('@/features/catalog/BaysPage').then((m) => ({ default: m.BaysPage })))
const EmployeesPage = lazyWithRetry(() => import('@/features/employees/EmployeesPage').then((m) => ({ default: m.EmployeesPage })))
const SettingsPage = lazyWithRetry(() => import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const RegisterPage = lazyWithRetry(() => import('@/features/jobs/RegisterPage').then((m) => ({ default: m.RegisterPage })))
const JobQueuePage = lazyWithRetry(() => import('@/features/jobs/JobQueuePage').then((m) => ({ default: m.JobQueuePage })))
const JobPaymentPage = lazyWithRetry(() => import('@/features/jobs/JobPaymentPage').then((m) => ({ default: m.JobPaymentPage })))
const ShiftPage = lazyWithRetry(() => import('@/features/shifts/ShiftPage').then((m) => ({ default: m.ShiftPage })))
const CommissionRulesPage = lazyWithRetry(() =>
  import('@/features/commission/CommissionRulesPage').then((m) => ({ default: m.CommissionRulesPage })),
)
const CommissionReportPage = lazyWithRetry(() =>
  import('@/features/commission/CommissionReportPage').then((m) => ({ default: m.CommissionReportPage })),
)
const PayrollPage = lazyWithRetry(() => import('@/features/payroll/PayrollPage').then((m) => ({ default: m.PayrollPage })))
const InventoryCategoriesPage = lazyWithRetry(() =>
  import('@/features/inventory/InventoryCategoriesPage').then((m) => ({ default: m.InventoryCategoriesPage })),
)
const InventoryUnitsPage = lazyWithRetry(() =>
  import('@/features/inventory/InventoryUnitsPage').then((m) => ({ default: m.InventoryUnitsPage })),
)
const InventoryItemsPage = lazyWithRetry(() =>
  import('@/features/inventory/InventoryItemsPage').then((m) => ({ default: m.InventoryItemsPage })),
)
const SuppliersPage = lazyWithRetry(() => import('@/features/inventory/SuppliersPage').then((m) => ({ default: m.SuppliersPage })))
const PurchaseOrdersPage = lazyWithRetry(() =>
  import('@/features/inventory/PurchaseOrdersPage').then((m) => ({ default: m.PurchaseOrdersPage })),
)
const ServiceRecipesPage = lazyWithRetry(() =>
  import('@/features/inventory/ServiceRecipesPage').then((m) => ({ default: m.ServiceRecipesPage })),
)
const ExpensesPage = lazyWithRetry(() => import('@/features/expenses/ExpensesPage').then((m) => ({ default: m.ExpensesPage })))
const ExpenseCategoriesPage = lazyWithRetry(() =>
  import('@/features/expenses/ExpenseCategoriesPage').then((m) => ({ default: m.ExpenseCategoriesPage })),
)
const SalesReportPage = lazyWithRetry(() => import('@/features/reports/SalesReportPage').then((m) => ({ default: m.SalesReportPage })))
const AppointmentsPage = lazyWithRetry(() => import('@/features/appointments/AppointmentsPage').then((m) => ({ default: m.AppointmentsPage })))
const TransactionsPage = lazyWithRetry(() => import('@/features/sales/TransactionsPage').then((m) => ({ default: m.TransactionsPage })))
const OwnerConsolePage = lazyWithRetry(() => import('@/features/owner/OwnerConsolePage').then((m) => ({ default: m.OwnerConsolePage })))

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
              {/* Cross-tenant, not part of the per-tenant app shell/nav -- see OwnerConsolePage's
                  own comment and supabase/functions/owner-console for why. */}
              <Route path="/owner-console" element={<OwnerConsolePage />} />
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
                <Route path="/transactions" element={<TransactionsPage />} />
                <Route path="/jobs" element={<JobQueuePage />} />
                <Route path="/jobs/:jobId/pay" element={<JobPaymentPage />} />
                <Route path="/shift" element={<ShiftPage />} />
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
