import { supabase } from '@/lib/supabase/client'

export interface OwnerTenantRow {
  id: string
  name: string
  createdAt: string
  trialEndsAt: string | null
  adminEmail: string | null
}

// supabase.functions.invoke() only gives a generic "non-2xx" message for a FunctionsHttpError --
// the real reason is in the response body, which the client wraps but doesn't surface
// automatically. Same pattern as createStaffUser() in employeesApi.ts.
async function unwrapFunctionError(error: unknown): Promise<never> {
  const context = (error as { context?: Response }).context
  let serverMessage: string | undefined
  if (context) {
    try {
      const body = await context.clone().json()
      serverMessage = body?.error
    } catch {
      // response wasn't JSON -- fall through to the generic error below
    }
  }
  throw new Error(serverMessage ?? (error instanceof Error ? error.message : 'Request failed'))
}

export async function listOwnerTenants(): Promise<OwnerTenantRow[]> {
  const { data, error } = await supabase.functions.invoke<{ tenants: OwnerTenantRow[] }>('owner-console', {
    body: { action: 'list' },
  })
  if (error) await unwrapFunctionError(error)
  if (!data) throw new Error('No response from server')
  return data.tenants
}

export async function updateTenantTrial(tenantId: string, trialEndsAt: string | null): Promise<void> {
  const { error } = await supabase.functions.invoke('owner-console', {
    body: { action: 'update_trial', tenantId, trialEndsAt },
  })
  if (error) await unwrapFunctionError(error)
}
