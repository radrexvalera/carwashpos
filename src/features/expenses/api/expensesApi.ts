import { supabase } from '@/lib/supabase/client'
import type { Database, Json } from '@/lib/supabase/types'

export type ExpenseCategory = Database['public']['Tables']['expense_categories']['Row']
export type Expense = Database['public']['Tables']['expenses']['Row']

export async function listExpenseCategories() {
  const { data, error } = await supabase.from('expense_categories').select('*').order('sort_order', { ascending: true })
  if (error) throw error
  return data
}

export async function createExpenseCategory(input: { tenantId: string; name: string; sortOrder: number }) {
  const { error } = await supabase
    .from('expense_categories')
    .insert({ tenant_id: input.tenantId, name: input.name, sort_order: input.sortOrder })
  if (error) throw error
}

export async function setExpenseCategoryActive(id: string, isActive: boolean) {
  const { error } = await supabase.from('expense_categories').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}

export async function updateExpenseCategorySortOrder(id: string, sortOrder: number) {
  const { error } = await supabase.from('expense_categories').update({ sort_order: sortOrder }).eq('id', id)
  if (error) throw error
}

export async function listExpenses(from: string, to: string) {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .gte('expense_date', from)
    .lte('expense_date', to)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export interface RecordExpenseInput {
  categoryId: string
  description: string
  amount: number
  expenseDate: string
  paymentMethod: 'cash' | 'gcash' | 'maya' | 'bank_transfer' | 'card'
  paidTo?: string
  referenceNote?: string
}

export async function recordExpense(input: RecordExpenseInput) {
  const payload = {
    category_id: input.categoryId,
    description: input.description,
    amount: input.amount,
    expense_date: input.expenseDate,
    payment_method: input.paymentMethod,
    paid_to: input.paidTo,
    reference_note: input.referenceNote,
  }
  const { data, error } = await supabase.rpc('record_expense', { payload: payload as unknown as Json })
  if (error) throw error
  return data as { id: string }
}

export async function voidExpense(expenseId: string, reason: string) {
  const { error } = await supabase.rpc('void_expense', { p_expense_id: expenseId, p_reason: reason })
  if (error) throw error
}
