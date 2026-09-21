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
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </TenantProvider>
      </AuthProvider>
      <Toaster />
    </BrowserRouter>
  )
}
