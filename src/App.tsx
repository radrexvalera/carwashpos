import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/app/AuthProvider'
import { TenantProvider } from '@/app/TenantProvider'
import { AppShell } from '@/app/AppShell'
import { RoleGuard } from '@/lib/rbac/RoleGuard'
import { LoginPage } from '@/features/auth/LoginPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { ServicesPage } from '@/features/catalog/ServicesPage'
import { VehicleSizeClassesPage } from '@/features/catalog/VehicleSizeClassesPage'
import { ServicePricesPage } from '@/features/catalog/ServicePricesPage'
import { BaysPage } from '@/features/catalog/BaysPage'
import { PosPage } from '@/features/pos/PosPage'
import { ReceiptPage } from '@/features/pos/ReceiptPage'

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
              <Route path="/pos" element={<PosPage />} />
              <Route path="/receipt/:clientGeneratedId" element={<ReceiptPage />} />
              <Route
                path="/admin/services"
                element={
                  <RoleGuard allowedRoles={['admin', 'manager']}>
                    <ServicesPage />
                  </RoleGuard>
                }
              />
              <Route
                path="/admin/vehicle-size-classes"
                element={
                  <RoleGuard allowedRoles={['admin', 'manager']}>
                    <VehicleSizeClassesPage />
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
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </TenantProvider>
      </AuthProvider>
      <Toaster />
    </BrowserRouter>
  )
}
