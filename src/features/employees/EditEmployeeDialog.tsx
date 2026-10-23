import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createStaffUser, replaceEmployeeRoles, updateEmployee, type Employee, type Role } from './api/employeesApi'

interface EditEmployeeDialogProps {
  employee: Employee | null
  roles: Role[]
  currentRoleIds: string[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

const RATE_TYPES = [
  { value: 'daily', label: 'Per day' },
  { value: 'weekly', label: 'Per week' },
  { value: 'semi_monthly', label: 'Semi-monthly' },
  { value: 'monthly', label: 'Per month' },
] as const

export function EditEmployeeDialog({ employee, roles, currentRoleIds, onOpenChange, onSaved }: EditEmployeeDialogProps) {
  const [fullName, setFullName] = useState('')
  const [nickname, setNickname] = useState('')
  const [mobile, setMobile] = useState('')
  const [employeeCode, setEmployeeCode] = useState('')
  const [hireDate, setHireDate] = useState('')
  const [salaryRate, setSalaryRate] = useState('')
  const [salaryRateType, setSalaryRateType] = useState<string>('none')
  const [roleIds, setRoleIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [grantingLogin, setGrantingLogin] = useState(false)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [creatingLogin, setCreatingLogin] = useState(false)

  useEffect(() => {
    if (!employee) return
    setFullName(employee.full_name)
    setNickname(employee.nickname ?? '')
    setMobile(employee.mobile ?? '')
    setEmployeeCode(employee.employee_code ?? '')
    setHireDate(employee.hire_date ?? '')
    setSalaryRate(employee.salary_rate != null ? String(employee.salary_rate) : '')
    setSalaryRateType(employee.salary_rate_type ?? 'none')
    setRoleIds(currentRoleIds)
    setGrantingLogin(false)
    setLoginEmail('')
    setLoginPassword('')
  }, [employee, currentRoleIds])

  async function handleSave() {
    if (!employee || !fullName.trim()) return
    const rate = salaryRateType === 'none' ? null : Number(salaryRate)
    if (salaryRateType !== 'none' && (Number.isNaN(rate) || (rate ?? 0) <= 0)) {
      toast.error('Enter a valid salary rate')
      return
    }
    setSaving(true)
    try {
      await updateEmployee(employee.id, {
        fullName: fullName.trim(),
        nickname: nickname.trim() || null,
        mobile: mobile.trim() || null,
        employeeCode: employeeCode.trim() || null,
        hireDate: hireDate || null,
        salaryRate: rate,
        salaryRateType: salaryRateType === 'none' ? null : (salaryRateType as 'daily' | 'weekly' | 'semi_monthly' | 'monthly'),
      })
      await replaceEmployeeRoles(employee.id, roleIds)
      onSaved()
      toast.success('Employee updated')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update employee')
    } finally {
      setSaving(false)
    }
  }

  async function handleGrantLogin() {
    if (!employee) return
    if (!loginEmail.trim() || loginPassword.length < 8) {
      toast.error('Enter an email and a password of at least 8 characters')
      return
    }
    if (roleIds.length === 0) {
      toast.error('Pick at least one role for their login')
      return
    }
    setCreatingLogin(true)
    try {
      await createStaffUser({
        email: loginEmail.trim(),
        password: loginPassword,
        fullName: fullName.trim(),
        roleIds,
        employeeId: employee.id,
      })
      onSaved()
      toast.success('Login created')
      setGrantingLogin(false)
      setLoginEmail('')
      setLoginPassword('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create login')
    } finally {
      setCreatingLogin(false)
    }
  }

  return (
    <Dialog open={!!employee} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit employee</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label>Full name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Nickname</Label>
            <Input value={nickname} onChange={(e) => setNickname(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Mobile</Label>
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Employee code</Label>
            <Input value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Hire date</Label>
            <Input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5 border-t pt-3">
          <Label>Pay basis</Label>
          <p className="text-xs text-muted-foreground">
            Leave as "Commission only" for staff paid purely per job. Set a rate for staff on a fixed salary (can still also
            earn commission).
          </p>
          <div className="flex gap-2">
            <Select value={salaryRateType} onValueChange={setSalaryRateType}>
              <SelectTrigger className="w-48">
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
            {salaryRateType !== 'none' && (
              <Input
                type="number"
                step="0.01"
                placeholder="Rate amount"
                value={salaryRate}
                onChange={(e) => setSalaryRate(e.target.value)}
              />
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 border-t pt-3">
          <Label>Roles</Label>
          <div className="flex flex-wrap gap-4">
            {roles.map((role) => (
              <div key={role.id} className="flex items-center gap-2">
                <Checkbox
                  checked={roleIds.includes(role.id)}
                  onCheckedChange={(checked) =>
                    setRoleIds((prev) => (checked ? [...prev, role.id] : prev.filter((id) => id !== role.id)))
                  }
                />
                <Label className="font-normal">{role.name}</Label>
              </div>
            ))}
          </div>
        </div>

        {employee && !employee.user_id && (
          <div className="flex flex-col gap-2 border-t pt-3">
            {!grantingLogin ? (
              <Button variant="outline" size="sm" className="w-fit" onClick={() => setGrantingLogin(true)}>
                Create a login for this person
              </Button>
            ) : (
              <>
                <Label>Create login</Label>
                <p className="text-xs text-muted-foreground">
                  Uses the roles selected above. Save any role changes first if you just changed them.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input type="email" placeholder="Email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
                  <Input
                    type="text"
                    placeholder="Password (8+ characters)"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={creatingLogin} onClick={handleGrantLogin}>
                    Create login
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setGrantingLogin(false)}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving || !fullName.trim()} onClick={handleSave}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
