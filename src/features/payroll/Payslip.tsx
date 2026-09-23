import { formatMoney } from '@/lib/money'

interface PayslipProps {
  businessName: string
  address?: string | null
  paperWidth: '58mm' | '80mm'
  employeeName: string
  periodLabel: string
  isDraft: boolean
  basePay: number
  commissionTotal: number
  tips: number
  bonus: number
  cashAdvance: number
  deductions: number
  adjustments: { reason: string; amount: number }[]
  netPay: number
}

function Dashed() {
  return <div className="my-1 border-t border-dashed border-black" />
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

export function Payslip({
  businessName,
  address,
  paperWidth,
  employeeName,
  periodLabel,
  isDraft,
  basePay,
  commissionTotal,
  tips,
  bonus,
  cashAdvance,
  deductions,
  adjustments,
  netPay,
}: PayslipProps) {
  const gross = basePay + commissionTotal + tips + bonus
  const adjustmentsTotal = adjustments.reduce((sum, a) => sum + a.amount, 0)
  // Same printable-width convention as Receipt.tsx -- the print head can't reach the roll's
  // outer edges, so 48mm/72mm are the safe printable widths for 58mm/80mm paper.
  const contentWidth = paperWidth === '80mm' ? '72mm' : '48mm'

  return (
    <div className="mx-auto font-mono text-xs break-words text-black" style={{ width: contentWidth }}>
      <style>{`@page { size: ${paperWidth} auto; margin: 0; }`}</style>

      <div className="flex flex-col items-center gap-0.5 text-center">
        <div className="text-sm font-bold">{businessName}</div>
        {address && <div>{address}</div>}
        <div className="font-bold">PAYSLIP</div>
        {isDraft && <div className="font-bold">DRAFT — SUBJECT TO CHANGE</div>}
      </div>

      <Dashed />

      <div>Employee: {employeeName}</div>
      <div>Period: {periodLabel}</div>

      <Dashed />

      <div className="flex flex-col gap-0.5">
        <div className="font-bold">Earnings</div>
        <Row label="Base pay" value={formatMoney(basePay)} />
        <Row label="Commission" value={formatMoney(commissionTotal)} />
        <Row label="Tips" value={formatMoney(tips)} />
        <Row label="Bonus" value={formatMoney(bonus)} />
        <Row label="Gross pay" value={formatMoney(gross)} bold />
      </div>

      <Dashed />

      <div className="flex flex-col gap-0.5">
        <div className="font-bold">Deductions</div>
        <Row label="Cash advance" value={`-${formatMoney(cashAdvance)}`} />
        <Row label="Deductions" value={`-${formatMoney(deductions)}`} />
      </div>

      {adjustments.length > 0 && (
        <>
          <Dashed />
          <div className="flex flex-col gap-0.5">
            <div className="font-bold">Adjustments</div>
            {adjustments.map((a, i) => (
              <Row key={i} label={a.reason} value={formatMoney(a.amount)} />
            ))}
            <Row label="Total adjustments" value={formatMoney(adjustmentsTotal)} bold />
          </div>
        </>
      )}

      <Dashed />
      <Row label="NET PAY" value={formatMoney(netPay)} bold />
      <Dashed />

      <div className="mt-4 flex flex-col gap-3">
        <div>Employee signature: _______________</div>
        <div>Prepared by: _______________</div>
      </div>
    </div>
  )
}
