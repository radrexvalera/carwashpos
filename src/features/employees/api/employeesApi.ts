import { supabase } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

type Employee = Database['public']['Tables']['employees']['Row']
type Role = Database['public']['Tables']['roles']['Row']

export async function listEmployees() {
  const { data, error } = await supabase.from('employees').select('*').order('full_name', { ascending: true })
  if (error) throw error
  return data
}

export async function listRoles() {
  const { data, error } = await supabase.from('roles').select('*').order('name', { ascending: true })
  if (error) throw error
  return data
}

export async function listEmployeeRoleIds() {
  const { data, error } = await supabase.from('employee_roles').select('employee_id, role_id')
  if (error) throw error
  return data
}

export interface CreateEmployeeInput {
  tenantId: string
  fullName: string
  nickname: string | null
  mobile: string | null
  employeeCode: string | null
  hireDate: string | null
  salaryRate: number | null
  salaryRateType: 'daily' | 'weekly' | 'semi_monthly' | 'monthly' | null
  roleIds: string[]
}

export async function createEmployee(input: CreateEmployeeInput) {
  const { data, error } = await supabase
    .from('employees')
    .insert({
      tenant_id: input.tenantId,
      full_name: input.fullName,
      nickname: input.nickname,
      mobile: input.mobile,
      employee_code: input.employeeCode,
      hire_date: input.hireDate,
      salary_rate: input.salaryRate,
      salary_rate_type: input.salaryRateType,
    })
    .select('id')
    .single()
  if (error) throw error

  if (input.roleIds.length > 0) {
    const { error: roleError } = await supabase
      .from('employee_roles')
      .insert(input.roleIds.map((roleId) => ({ employee_id: data.id, role_id: roleId })))
    if (roleError) throw roleError
  }

  return data.id
}

export async function setEmployeeActive(id: string, active: boolean) {
  const { error } = await supabase.from('employees').update({ active }).eq('id', id)
  if (error) throw error
}

export interface UpdateEmployeeInput {
  fullName: string
  nickname: string | null
  mobile: string | null
  employeeCode: string | null
  hireDate: string | null
  salaryRate: number | null
  salaryRateType: 'daily' | 'weekly' | 'semi_monthly' | 'monthly' | null
}

export async function updateEmployee(id: string, input: UpdateEmployeeInput) {
  const { error } = await supabase
    .from('employees')
    .update({
      full_name: input.fullName,
      nickname: input.nickname,
      mobile: input.mobile,
      employee_code: input.employeeCode,
      hire_date: input.hireDate,
      salary_rate: input.salaryRate,
      salary_rate_type: input.salaryRateType,
    })
    .eq('id', id)
  if (error) throw error
}

export async function deleteEmployee(id: string) {
  const { error } = await supabase.rpc('delete_employee', { p_employee_id: id })
  if (error) throw error
}

export interface CreateStaffUserInput {
  email: string
  password: string
  fullName: string
  roleIds: string[]
  employeeId?: string
  nickname?: string | null
  mobile?: string | null
  employeeCode?: string | null
  hireDate?: string | null
  salaryRate?: number | null
  salaryRateType?: 'daily' | 'weekly' | 'semi_monthly' | 'monthly' | null
}

// Creates a real login (email + password) for a cashier/manager/admin/etc. Needs a service-role
// key to create another person's account, which must never reach the browser -- that's why this
// goes through an Edge Function instead of a direct table insert (see
// supabase/functions/create-staff-user). The function re-checks can_manage_employees itself under
// the caller's own JWT, so this isn't a client-side-only gate.
export async function createStaffUser(input: CreateStaffUserInput) {
  const { data, error } = await supabase.functions.invoke<{ userId: string; employeeId: string }>('create-staff-user', {
    body: {
      email: input.email,
      password: input.password,
      fullName: input.fullName,
      roleIds: input.roleIds,
      employeeId: input.employeeId,
      nickname: input.nickname,
      mobile: input.mobile,
      employeeCode: input.employeeCode,
      hireDate: input.hireDate,
      salaryRate: input.salaryRate,
      salaryRateType: input.salaryRateType,
    },
  })
  if (error) {
    // supabase-js only gives a generic "non-2xx" message for FunctionsHttpError -- the real
    // reason is in the response body, which the client wraps but doesn't surface automatically.
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
    throw new Error(serverMessage ?? error.message)
  }
  if (!data) throw new Error('No response from server')
  return data
}

export async function replaceEmployeeRoles(employeeId: string, roleIds: string[]) {
  const { error: deleteError } = await supabase.from('employee_roles').delete().eq('employee_id', employeeId)
  if (deleteError) throw deleteError

  if (roleIds.length > 0) {
    const { error: insertError } = await supabase
      .from('employee_roles')
      .insert(roleIds.map((roleId) => ({ employee_id: employeeId, role_id: roleId })))
    if (insertError) throw insertError
  }
}

export type { Employee, Role }
