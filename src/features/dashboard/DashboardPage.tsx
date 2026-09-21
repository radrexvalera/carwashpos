import { useTenant } from '@/app/TenantProvider'

export function DashboardPage() {
  const { profile } = useTenant()

  return (
    <div>
      <h1 className="text-2xl font-semibold">Welcome{profile ? `, ${profile.fullName}` : ''}</h1>
      <p className="mt-2 text-muted-foreground">
        The register, bay board, and reports land in later phases. For now, set up your service
        catalog, vehicle sizes, pricing, and bays under the admin section.
      </p>
    </div>
  )
}
