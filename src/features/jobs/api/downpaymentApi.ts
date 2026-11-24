import { db } from '@/lib/db/dexie'
import { supabase } from '@/lib/supabase/client'
import type { Json } from '@/lib/supabase/types'
import { flushMutationQueue } from '@/lib/offline/syncEngine'

export type PaymentMethod = 'cash' | 'gcash' | 'maya' | 'bank_transfer' | 'card' | 'maribank' | 'gotyme' | 'rcbc' | 'bpi' | 'unionbank' | 'qrph'

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  gcash: 'GCash',
  maya: 'Maya',
  bank_transfer: 'Bank Transfer',
  card: 'Card',
  maribank: 'Maribank',
  gotyme: 'GoTyme',
  rcbc: 'RCBC',
  bpi: 'BPI',
  unionbank: 'UnionBank',
  qrph: 'QR Ph',
}

export interface HeldDownpayment {
  id: string
  method: PaymentMethod
  amount: number
  referenceNote: string | null
  createdAt: string
}

export interface DownpaymentInput {
  tenantId: string
  jobId: string
  shiftId?: string | null
  method: PaymentMethod
  amount: number
  referenceNote?: string
}

function buildPayload(input: DownpaymentInput, clientGeneratedId: string) {
  return {
    client_generated_id: clientGeneratedId,
    job_id: input.jobId,
    shift_id: input.shiftId ?? null,
    method: input.method,
    amount: input.amount,
    reference_note: input.referenceNote?.trim() || null,
  }
}

// Downpayments still counting toward a job's balance (not yet folded into its sale, refunded, or kept).
export async function listHeldDownpayments(jobId: string): Promise<HeldDownpayment[]> {
  const { data, error } = await supabase
    .from('job_downpayments')
    .select('id, method, amount, reference_note, created_at')
    .eq('job_id', jobId)
    .eq('status', 'held')
    .order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []).map((d) => ({
    id: d.id,
    method: d.method,
    amount: d.amount,
    referenceNote: d.reference_note,
    createdAt: d.created_at,
  }))
}

export async function recordDownpayment(input: DownpaymentInput) {
  const { error } = await supabase.rpc('record_job_downpayment', {
    payload: buildPayload(input, crypto.randomUUID()) as unknown as Json,
  })
  if (error) throw new Error(error.message)
}

// Registration path: the job itself only exists in the offline outbox at this point, so the
// downpayment queues right behind its create_job() (higher sequence = synced after it).
export async function queueDownpayment(input: DownpaymentInput) {
  const clientGeneratedId = crypto.randomUUID()
  await db.mutationQueue.add({
    id: crypto.randomUUID(),
    tenantId: input.tenantId,
    entity: 'job_downpayment',
    clientGeneratedId,
    payload: buildPayload(input, clientGeneratedId),
    createdAt: new Date().toISOString(),
    retryCount: 0,
    status: 'pending',
    sequence: Date.now() + 1,
  })
  void flushMutationQueue()
}

export async function refundDownpayment(downpaymentId: string, reason: string) {
  const { error } = await supabase.rpc('refund_job_downpayment', { p_downpayment_id: downpaymentId, p_reason: reason })
  if (error) throw new Error(error.message)
}

// Downpayments sitting in the outbox that the server (and so job_board_entries.downpayment_total)
// doesn't know about yet, per job id.
export async function getUnsyncedDownpaymentTotals(): Promise<Map<string, number>> {
  const rows = await db.mutationQueue.where('entity').equals('job_downpayment').toArray()
  const totals = new Map<string, number>()
  for (const m of rows) {
    if (m.status === 'synced') continue
    const p = m.payload as { job_id: string; amount: number }
    totals.set(p.job_id, (totals.get(p.job_id) ?? 0) + p.amount)
  }
  return totals
}
