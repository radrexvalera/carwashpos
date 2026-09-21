import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { useTenant } from '@/app/TenantProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  createEmployee,
  listEmployeeRoleIds,
  listEmployees,
  listRoles,
  setEmployeeActive,
  type Employee,
  type Role,
} from './api/employeesApi'

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
    setSubmitting(true)
    try {
      await createEmployee({
        tenantId: profile.tenantId,
        fullName: values.fullName,
        nickname: values.nickname || null,
        mobile: values.mobile || null,
        employeeCode: values.employeeCode || null,
        hireDate: values.hireDate || null,
        roleIds: values.roleIds,
      })
      form.reset()
      await reload()
      toast.success('Employee added')
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

              <FormField
                control={form.control}
                name="roleIds"
                render={() => (
                  <FormItem>
                    <FormLabel>Roles</FormLabel>
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
                Add employee
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
                <TableHead>Roles</TableHead>
                <TableHead>Hire date</TableHead>
                <TableHead className="text-right">Active</TableHead>
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
                  <TableCell>{rolesFor(row.id).join(', ') || '—'}</TableCell>
                  <TableCell>{row.hire_date ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    <Switch checked={row.active} onCheckedChange={() => toggleActive(row)} />
                  </TableCell>
                </TableRow>
              ))}
              {!loading && employees.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No employees yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
