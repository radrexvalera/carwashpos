import { formatMoney } from '@/lib/money'

interface ReceiptLineItem {
  name: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

interface ReceiptPayment {
  methodLabel: string
  amount: number
  tenderedAmount?: number
  changeGiven?: number
}

interface ReceiptProps {
  businessName: string
  logoUrl?: string | null
  receiptHeader?: string | null
  address?: string | null
  locationName: string
  paperWidth: '58mm' | '80mm'
  saleNumber: string
  plateNumber?: string | null
  vehicleModel?: string | null
  crewNames?: string[]
  cashierName: string
  createdAt: string
  items: ReceiptLineItem[]
  subtotal: number
  discount?: number
  promotionDiscount: number
  membershipDiscount: number
  total: number
  payments: ReceiptPayment[]
  receiptFooter?: string | null
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

export function Receipt({
  businessName,
  logoUrl,
  receiptHeader,
  address,
  locationName,
  paperWidth,
  saleNumber,
  plateNumber,
  vehicleModel,
  crewNames,
  cashierName,
  createdAt,
  items,
  subtotal,
  discount,
  promotionDiscount,
  membershipDiscount,
  total,
  payments,
  receiptFooter,
}: ReceiptProps) {
  const totalChange = payments.reduce((sum, p) => sum + (p.changeGiven ?? 0), 0)
  // The printable width is narrower than the paper roll width -- the print head can't reach the
  // very edges of the roll, so sizing content to the full 58mm/80mm overflows and forces manual
  // print-dialog scaling. 48mm/72mm are the standard safe printable widths for 58mm/80mm rolls.
  const contentWidth = paperWidth === '80mm' ? '72mm' : '48mm'

  return (
    <div className="mx-auto font-mono text-xs break-words text-black" style={{ width: contentWidth }}>
      <style>{`@page { size: ${paperWidth} auto; margin: 0; }`}</style>

      <div className="flex flex-col items-center gap-0.5 text-center">
        {logoUrl && <img src={logoUrl} alt="" className="mb-1 max-h-12 max-w-[80%] object-contain" />}
        <div className="text-sm font-bold">{businessName}</div>
        {receiptHeader && <div>{receiptHeader}</div>}
        {address && <div>{address}</div>}
        <div>{locationName}</div>
      </div>

      <Dashed />

      <div className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <div key={i}>
            <div>{item.name}</div>
            <div className="flex justify-between">
              <span>
                {item.quantity} × {formatMoney(item.unitPrice)}
              </span>
              <span>{formatMoney(item.lineTotal)}</span>
            </div>
          </div>
        ))}
      </div>

      <Dashed />

      <div className="flex flex-col gap-0.5">
        <Row label="SUBTOTAL" value={formatMoney(subtotal)} />
        {!!discount && discount > 0 && <Row label="Discount" value={`-${formatMoney(discount)}`} />}
        {promotionDiscount > 0 && <Row label="Promotion discount" value={`-${formatMoney(promotionDiscount)}`} />}
        {membershipDiscount > 0 && <Row label="Free service" value={`-${formatMoney(membershipDiscount)}`} />}
        <Row label="TOTAL" value={formatMoney(total)} bold />
        {payments.map((p, i) => (
          <Row key={i} label={p.methodLabel.toUpperCase()} value={formatMoney(p.tenderedAmount ?? p.amount)} />
        ))}
        {totalChange > 0 && <Row label="CHANGE" value={formatMoney(totalChange)} />}
      </div>

      <Dashed />

      <div className="flex flex-col gap-0.5">
        <div>Transaction: {saleNumber}</div>
        {plateNumber && (
          <div>
            Vehicle: {plateNumber}
            {vehicleModel ? ` (${vehicleModel})` : ''}
          </div>
        )}
        {!!crewNames?.length && <div>Crew: {crewNames.join(', ')}</div>}
        <div>Cashier: {cashierName}</div>
        <div>{new Date(createdAt).toLocaleString()}</div>
      </div>

      {receiptFooter && (
        <>
          <Dashed />
          <div className="flex flex-col items-center gap-0.5 text-center">
            {receiptFooter.split('\n').map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
