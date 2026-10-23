import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMoney } from '@/lib/money'
import { localDateString } from '@/lib/date'
import {
  listExpenseCategories,
  listExpenses,
  recordExpense,
  voidExpense,
  type Expense,
  type ExpenseCategory,
} from './api/expensesApi'

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  gcash: 'GCash',
  maya: 'Maya',
  bank_transfer: 'Bank Transfer',
  card: 'Card',
}

function startOfMonth() {
  const d = new Date()
  d.setDate(1)
  return localDateString(d)
}

export function ExpensesPage() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)

  const [from, setFrom] = useState(startOfMonth())
  const [to, setTo] = useState(localDateString())

  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [expenseDate, setExpenseDate] = useState(localDateString())
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'gcash' | 'maya' | 'bank_transfer' | 'card'>('cash')
  const [paidTo, setPaidTo] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [voidTarget, setVoidTarget] = useState<Expense | null>(null)
  const [voidReason, setVoidReason] = useState('')

  async function reload() {
    setLoading(true)
    try {
      const [categoriesData, expensesData] = await Promise.all([listExpenseCategories(), listExpenses(from, to)])
      const active = categoriesData.filter((c) => c.is_active)
      setCategories(active)
      if (!categoryId && active[0]) setCategoryId(active[0].id)
      setExpenses(expensesData)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load expenses')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? 'Uncategorized'
  const total = expenses.filter((e) => !e.is_voided).reduce((sum, e) => sum + e.amount, 0)

  async function handleSubmit() {
    if (!categoryId || !description.trim() || !amount) return
    setSubmitting(true)
    try {
      await recordExpense({
        categoryId,
        description: description.trim(),
        amount: Number(amount),
        expenseDate,
        paymentMethod,
        paidTo: paidTo.trim() || undefined,
      })
      setDescription('')
      setAmount('')
      setPaidTo('')
      toast.success('Expense recorded')
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record expense')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitVoid() {
    if (!voidTarget || !voidReason.trim()) return
    try {
      await voidExpense(voidTarget.id, voidReason.trim())
      toast.success('Expense voided')
      setVoidTarget(null)
      setVoidReason('')
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to void expense')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Expenses</h1>
        <p className="text-muted-foreground">Operating expenses — rent, utilities, salaries, supplies, and more.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Record an expense</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Input className="w-56" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Electric bill" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Amount</Label>
            <Input type="number" step="0.01" className="w-28" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Date</Label>
            <Input type="date" className="w-40" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Payment method</Label>
            <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as typeof paymentMethod)}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(METHOD_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Paid to</Label>
            <Input className="w-40" value={paidTo} onChange={(e) => setPaidTo(e.target.value)} placeholder="Optional" />
          </div>
          <Button disabled={submitting || !categoryId || !description.trim() || !amount} onClick={handleSubmit}>
            Record
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="flex flex-col gap-1.5">
            <Label>From</Label>
            <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>To</Label>
            <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="ml-auto text-lg font-semibold">Total: {formatMoney(total)}</div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Paid to</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((row) => (
                <TableRow key={row.id} className={row.is_voided ? 'opacity-50' : undefined}>
                  <TableCell>{row.expense_date}</TableCell>
                  <TableCell>{categoryName(row.category_id)}</TableCell>
                  <TableCell>
                    {row.description}
                    {row.is_voided && (
                      <Badge variant="outline" className="ml-2">
                        Voided
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{row.paid_to ?? '—'}</TableCell>
                  <TableCell>{METHOD_LABELS[row.payment_method]}</TableCell>
                  <TableCell className="text-right">{formatMoney(row.amount)}</TableCell>
                  <TableCell>
                    {!row.is_voided && (
                      <Dialog open={voidTarget?.id === row.id} onOpenChange={(open) => !open && setVoidTarget(null)}>
                        <DialogTrigger asChild>
                          <Button size="sm" variant="ghost" onClick={() => setVoidTarget(row)}>
                            Void
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Void expense</DialogTitle>
                          </DialogHeader>
                          <div className="flex flex-col gap-3">
                            <p className="text-sm text-muted-foreground">
                              {row.description} — {formatMoney(row.amount)}
                            </p>
                            <Input
                              placeholder="Reason (required)"
                              value={voidReason}
                              onChange={(e) => setVoidReason(e.target.value)}
                            />
                            <Button onClick={submitVoid} disabled={!voidReason.trim()}>
                              Confirm void
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && expenses.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No expenses in this period.
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
