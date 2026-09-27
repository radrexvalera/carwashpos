import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { replaceEmployeeRoles, updateEmployee, type Employee, type Role } from './api/employeesApi'

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
