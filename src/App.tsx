import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/app/AuthProvider'
import { TenantProvider } from '@/app/TenantProvider'
import { AppShell } from '@/app/AppShell'
import { RoleGuard } from '@/lib/rbac/RoleGuard'
import { LoginPage } from '@/features/auth/LoginPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { ServicesPage } from '@/features/catalog/ServicesPage'
import { ServiceCategoriesPage } from '@/features/catalog/ServiceCategoriesPage'
import { VehicleSizesPage } from '@/features/catalog/VehicleSizesPage'
import { ServicePricesPage } from '@/features/catalog/ServicePricesPage'
import { BaysPage } from '@/features/catalog/BaysPage'
import { EmployeesPage } from '@/features/employees/EmployeesPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { RegisterPage } from '@/features/jobs/RegisterPage'
import { JobQueuePage } from '@/features/jobs/JobQueuePage'
import { JobPaymentPage } from '@/features/jobs/JobPaymentPage'
import { ShiftPage } from '@/features/shifts/ShiftPage'
import { CommissionRulesPage } from '@/features/commission/CommissionRulesPage'
import { CommissionReportPage } from '@/features/commission/CommissionReportPage'
import { AttendantDashboardPage } from '@/features/commission/AttendantDashboardPage'
import { PayrollPage } from '@/features/payroll/PayrollPage'
import { InventoryCategoriesPage } from '@/features/inventory/InventoryCategoriesPage'
import { InventoryUnitsPage } from '@/features/inventory/InventoryUnitsPage'
import { InventoryItemsPage } from '@/features/inventory/InventoryItemsPage'
import { SuppliersPage } from '@/features/inventory/SuppliersPage'
import { PurchaseOrdersPage } from '@/features/inventory/PurchaseOrdersPage'
import { ServiceRecipesPage } from '@/features/inventory/ServiceRecipesPage'
import { ExpensesPage } from '@/features/expenses/ExpensesPage'
import { ExpenseCategoriesPage } from '@/features/expenses/ExpenseCategoriesPage'
import { SalesReportPage } from '@/features/reports/SalesReportPage'
import { PromotionsPage } from '@/features/promotions/PromotionsPage'
import { LoyaltyPage } from '@/features/loyalty/LoyaltyPage'
import { FleetAccountsPage } from '@/features/fleet/FleetAccountsPage'
import { MembershipProgramsPage } from '@/features/memberships/MembershipProgramsPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TenantProvider>
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
        </TenantProvider>
      </AuthProvider>
      <Toaster />
    </BrowserRouter>
  )
}
