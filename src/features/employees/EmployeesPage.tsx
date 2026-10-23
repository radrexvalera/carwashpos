import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { useTenant } from '@/app/TenantProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EditEmployeeDialog } from './EditEmployeeDialog'
import {
  createEmployee,
  createStaffUser,
  deleteEmployee,
  listEmployeeRoleIds,
  listEmployees,
  listRoles,
  setEmployeeActive,
  type Employee,
  type Role,
} from './api/employeesApi'

const RATE_TYPES = [
  { value: 'daily', label: 'Per day' },
  { value: 'weekly', label: 'Per week' },
  { value: 'semi_monthly', label: 'Semi-monthly' },
  { value: 'monthly', label: 'Per month' },
] as const

const RATE_TYPE_LABELS: Record<string, string> = { daily: '/day', weekly: '/week', semi_monthly: '/semi-month', monthly: '/month' }

const employeeSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  nickname: z.string().optional(),
  mobile: z.string().optional(),
  employeeCode: z.string().optional(),
  hireDate: z.string().optional(),
  roleIds: z.array(z.string()),
})

type EmployeeFormValues = z.infer<typeof employeeSchema>

export function EmployeesPage() {
  const { profile } = useTenant()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [employeeRoleIds, setEmployeeRoleIds] = useState<{ employee_id: string; role_id: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [salaryRateType, setSalaryRateType] = useState('none')
  const [salaryRate, setSalaryRate] = useState('')
  const [createLogin, setCreateLogin] = useState(false)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: { fullName: '', nickname: '', mobile: '', employeeCode: '', hireDate: '', roleIds: [] },
  })

  async function reload() {
    setLoading(true)
    try {
      const [employeesData, rolesData, employeeRolesData] = await Promise.all([
        listEmployees(),
        listRoles(),
        listEmployeeRoleIds(),
      ])
      setEmployees(employeesData)
      setRoles(rolesData)
      setEmployeeRoleIds(employeeRolesData)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load employees')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  function rolesFor(employeeId: string) {
    const ids = new Set(employeeRoleIds.filter((er) => er.employee_id === employeeId).map((er) => er.role_id))
    return roles.filter((r) => ids.has(r.id)).map((r) => r.name)
  }

  async function onSubmit(values: EmployeeFormValues) {
    if (!profile) return
    const rate = salaryRateType === 'none' ? null : Number(salaryRate)
    if (salaryRateType !== 'none' && (Number.isNaN(rate) || (rate ?? 0) <= 0)) {
      toast.error('Enter a valid salary rate')
      return
    }
    if (createLogin) {
      if (!loginEmail.trim() || loginPassword.length < 8) {
        toast.error('Enter an email and a password of at least 8 characters')
        return
      }
      if (values.roleIds.length === 0) {
        toast.error('Pick at least one role for their login')
        return
      }
    }
    setSubmitting(true)
    try {
      if (createLogin) {
        await createStaffUser({
          email: loginEmail.trim(),
          password: loginPassword,
          fullName: values.fullName,
          roleIds: values.roleIds,
          nickname: values.nickname || null,
          mobile: values.mobile || null,
          employeeCode: values.employeeCode || null,
          hireDate: values.hireDate || null,
          salaryRate: rate,
          salaryRateType: salaryRateType === 'none' ? null : (salaryRateType as 'daily' | 'weekly' | 'semi_monthly' | 'monthly'),
        })
      } else {
        await createEmployee({
          tenantId: profile.tenantId,
          fullName: values.fullName,
          nickname: values.nickname || null,
          mobile: values.mobile || null,
          employeeCode: values.employeeCode || null,
          hireDate: values.hireDate || null,
          salaryRate: rate,
          salaryRateType: salaryRateType === 'none' ? null : (salaryRateType as 'daily' | 'weekly' | 'semi_monthly' | 'monthly'),
          roleIds: values.roleIds,
        })
      }
      form.reset()
      setSalaryRateType('none')
      setSalaryRate('')
      setCreateLogin(false)
      setLoginEmail('')
      setLoginPassword('')
      await reload()
      toast.success(createLogin ? 'Employee added with a login' : 'Employee added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create employee')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(row: Employee) {
    try {
      await setEmployeeActive(row.id, !row.active)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update employee')
    }
  }

  async function handleDelete(row: Employee) {
    if (!window.confirm(`Delete ${row.full_name}? This can't be undone.`)) return
    try {
      await deleteEmployee(row.id)
      await reload()
      toast.success('Employee deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete employee')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Employees</h1>
        <p className="text-muted-foreground">
          Everyone who works here, including attendants who never log into the system. Roles
          determine what they can do if they do have a login.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add an employee</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FormField
                  control={form.control}
                  name="fullName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full name</FormLabel>
                      <FormControl>
                        <Input placeholder="Juan Dela Cruz" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="nickname"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nickname</FormLabel>
                      <FormControl>
                        <Input placeholder="Optional" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="mobile"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mobile</FormLabel>
                      <FormControl>
                        <Input placeholder="09XX XXX XXXX" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="hireDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Hire date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Pay basis</Label>
                  <Select value={salaryRateType} onValueChange={setSalaryRateType}>
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Commission only</SelectItem>
                      {RATE_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {salaryRateType !== 'none' && (
                  <div className="flex flex-col gap-1.5">
                    <Label>Rate amount</Label>
                    <Input type="number" step="0.01" placeholder="e.g. 500" value={salaryRate} onChange={(e) => setSalaryRate(e.target.value)} />
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Switch id="create-login" checked={createLogin} onCheckedChange={setCreateLogin} />
                  <Label htmlFor="create-login">Create a login for this person</Label>
                </div>
                {createLogin && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="login-email">Email</Label>
                      <Input id="login-email" type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="juan@shop.com" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="login-password">Password</Label>
                      <Input
                        id="login-password"
                        type="text"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="At least 8 characters"
                      />
                      <p className="text-xs text-muted-foreground">Shown in plain text so you can write it down to give them.</p>
                    </div>
                  </div>
                )}
              </div>

              <FormField
                control={form.control}
                name="roleIds"
                render={() => (
                  <FormItem>
                    <FormLabel>{createLogin ? 'Roles (determines what they can access)' : 'Roles'}</FormLabel>
                    <div className="flex flex-wrap gap-4">
                      {roles.map((role) => (
                        <FormField
                          key={role.id}
                          control={form.control}
                          name="roleIds"
                          render={({ field }) => (
                            <FormItem className="flex items-center gap-2 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(role.id)}
                                  onCheckedChange={(checked) => {
                                    field.onChange(
                                      checked
                                        ? [...(field.value ?? []), role.id]
                                        : (field.value ?? []).filter((id: string) => id !== role.id),
                                    )
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="font-normal">{role.name}</FormLabel>
                            </FormItem>
                          )}
                        />
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" disabled={submitting} className="w-fit">
                {createLogin ? 'Add employee + create login' : 'Add employee'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Login</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Pay basis</TableHead>
                <TableHead>Hire date</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {row.full_name}
                    {row.nickname ? ` (${row.nickname})` : ''}
                  </TableCell>
                  <TableCell>{row.mobile ?? '—'}</TableCell>
                  <TableCell>
                    {row.user_id ? <Badge variant="outline">Has login</Badge> : <span className="text-muted-foreground">No login</span>}
                  </TableCell>
                  <TableCell>{rolesFor(row.id).join(', ') || '—'}</TableCell>
                  <TableCell>
                    {row.salary_rate != null && row.salary_rate_type
                      ? `₱${row.salary_rate}${RATE_TYPE_LABELS[row.salary_rate_type] ?? ''}`
                      : 'Commission only'}
                  </TableCell>
                  <TableCell>{row.hire_date ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    <Switch checked={row.active} onCheckedChange={() => toggleActive(row)} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditingEmployee(row)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(row)}>
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && employees.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No employees yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <EditEmployeeDialog
        employee={editingEmployee}
        roles={roles}
        currentRoleIds={editingEmployee ? employeeRoleIds.filter((er) => er.employee_id === editingEmployee.id).map((er) => er.role_id) : []}
        onOpenChange={(open) => !open && setEditingEmployee(null)}
        onSaved={reload}
      />
    </div>
  )
}
