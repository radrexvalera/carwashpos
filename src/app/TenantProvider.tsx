import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { Role } from '@/lib/supabase/types'
import { useAuth } from './AuthProvider'

interface Profile {
  id: string
  tenantId: string
  role: Role
  fullName: string
  active: boolean
}

interface TenantContextValue {
  profile: Profile | null
  loading: boolean
}

const TenantContext = createContext<TenantContextValue | null>(null)

// Resolves the logged-in user's tenant + role by reading their user_profiles row. Every
// role-gated route and RLS-scoped query downstream of login depends on this having loaded.
export function TenantProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session) {
      setProfile(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    supabase
      .from('user_profiles')
      .select('id, tenant_id, role, full_name, active')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) {
          setProfile(null)
        } else {
          setProfile({
            id: data.id,
            tenantId: data.tenant_id,
            role: data.role,
            fullName: data.full_name,
            active: data.active,
          })
        }
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [session])

  return <TenantContext.Provider value={{ profile, loading }}>{children}</TenantContext.Provider>
}

export function useTenant() {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant must be used within TenantProvider')
  return ctx
}
