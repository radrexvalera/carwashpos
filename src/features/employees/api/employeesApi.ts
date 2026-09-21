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
