import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { formatMoney } from '@/lib/money'
// Registers the Noto Sans font this document's styles name (see the notes in that file).
import './payslipPdfFonts'

export interface PayslipPdfJobRow {
  jobNumber: string
  plateNumber: string | null
  vehicleSizeName?: string | null
  date: string
  serviceName: string | null
  jobServiceNames?: string
  rate: number
  grossAmount: number
  discountAmount?: number
  discountDetail?: string
  hasFreebie?: boolean
  commissionBeforeDiscount?: number
  discountCommissionCut?: number
  commissionAmount: number
}

export interface PayslipPdfData {
  businessName: string
  logoUrl?: string | null
  address: string | null
  employeeName: string
  periodLabel: string
  daysInPeriod: number
  dateLabel: string
  basePay: number
  commissionTotal: number
  tips: number
  bonus: number
  cashAdvanceTotal: number
  otherDeductionsTotal: number
  withholdingTax: number
  sssContribution: number
  philhealthContribution: number
  pagibigContribution: number
  sssLoan: number
  hdmfLoan: number
  netPay: number
  commissionJobs?: PayslipPdfJobRow[]
}

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 9, fontFamily: 'Noto Sans' },
  border: { flex: 1, borderWidth: 1, borderColor: '#000', padding: 24 },
  center: { textAlign: 'center' },
  businessName: { fontSize: 16, fontWeight: 'bold', textAlign: 'center' },
  addressLine: { fontSize: 9, fontWeight: 'bold', textAlign: 'center', marginTop: 4 },
  title: { fontSize: 10, fontWeight: 'bold', textAlign: 'center', marginTop: 10 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  bold: { fontWeight: 'bold' },
  columns: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24 },
  column: { width: '47%' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  rowIndent: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingLeft: 12 },
  underlineTop: { borderTopWidth: 1, borderTopColor: '#000' },
  underlineBottom: { borderBottomWidth: 1, borderBottomColor: '#000' },
  netPayBox: { borderTopWidth: 1, borderBottomWidth: 3, borderBottomColor: '#000', borderTopColor: '#000' },
  spacer: { height: 14 },
  breakdownTitle: { fontSize: 11, fontWeight: 'bold', textAlign: 'center', marginBottom: 14 },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    paddingBottom: 4,
    fontWeight: 'bold',
    fontSize: 8,
  },
  tableRow: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: '#ccc', fontSize: 8 },
  // overflow: 'hidden' on every cell is a safety net -- react-pdf doesn't clip text that's too long
  // for its box by default, it just paints past the edge into whatever column comes next. The
  // column widths below are sized for realistic content (Job # is the last 4 digits only, not the
  // full "JOB-YYYYMMDD-NNNN" string -- that's what overflowed into "Plate" before), but this keeps
  // a one-off unusually long value from ever corrupting the row again.
  colJob: { width: '6%', overflow: 'hidden', paddingRight: 3 },
  colPlate: { width: '9%', overflow: 'hidden', paddingRight: 3 },
  colSize: { width: '8%', overflow: 'hidden', paddingRight: 3 },
  colDate: { width: '9%', overflow: 'hidden', paddingRight: 3 },
  colService: { width: '10%', overflow: 'hidden', paddingRight: 3 },
  colServicesOnJob: { width: '22%', overflow: 'hidden', paddingRight: 3 },
  colRate: { width: '6%', textAlign: 'right', overflow: 'hidden', paddingRight: 3 },
  // 10% fits a five-digit amount ("₱50,000.00") -- at 8% a repaint job total ran into its discount.
  colGross: { width: '10%', textAlign: 'right', overflow: 'hidden', paddingRight: 3 },
  colDiscount: { width: '10%', textAlign: 'right', overflow: 'hidden', paddingRight: 3 },
  colCommission: { width: '10%', textAlign: 'right', overflow: 'hidden' },
  // Discounted jobs table -- its own column set, sized to add up to 100% like the one above.
  discountedTitle: { fontSize: 10, fontWeight: 'bold', marginTop: 22, marginBottom: 6 },
  discountedNote: { fontSize: 7, color: '#444', marginBottom: 6 },
  dColJob: { width: '6%', overflow: 'hidden', paddingRight: 3 },
  dColPlate: { width: '9%', overflow: 'hidden', paddingRight: 3 },
  dColDate: { width: '9%', overflow: 'hidden', paddingRight: 3 },
  dColDetail: { width: '28%', overflow: 'hidden', paddingRight: 3 },
  dColMoney: { width: '12%', textAlign: 'right', overflow: 'hidden', paddingRight: 3 },
  dColLast: { width: '12%', textAlign: 'right', overflow: 'hidden' },
  totalRow: { flexDirection: 'row', paddingTop: 6, borderTopWidth: 1, borderTopColor: '#000', marginTop: 4 },
  logo: { height: 40, maxWidth: 160, objectFit: 'contain', alignSelf: 'center', marginBottom: 6 },
})

function dashOr(value: number) {
  return value > 0 ? formatMoney(value) : '-'
}

export function PayslipPdfDocument(d: PayslipPdfData) {
  const grossPay = d.basePay + d.commissionTotal + d.tips + d.bonus
  const discountedJobs = (d.commissionJobs ?? []).filter((j) => (j.discountAmount ?? 0) > 0)
  const totalDeductions =
    d.cashAdvanceTotal +
    d.otherDeductionsTotal +
    d.withholdingTax +
    d.sssContribution +
    d.philhealthContribution +
    d.pagibigContribution +
    d.sssLoan +
    d.hdmfLoan

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.border}>
          {d.logoUrl && <Image style={styles.logo} src={d.logoUrl} />}
          <Text style={styles.businessName}>{d.businessName}</Text>
          {d.address && <Text style={styles.addressLine}>{d.address}</Text>}
          <Text style={styles.title}>PAYSLIP</Text>
          <Text style={styles.title}>FOR THE PERIOD {d.periodLabel.toUpperCase()}</Text>

          <View style={styles.headerRow}>
            <Text style={styles.bold}>NAME OF EMPLOYEE: {d.employeeName}</Text>
            <Text style={styles.bold}>DATE: {d.dateLabel}</Text>
          </View>

          <View style={styles.columns}>
            <View style={styles.column}>
              <View style={styles.row}>
                <Text>No. of days:</Text>
                <Text>{d.daysInPeriod}</Text>
              </View>
              <View style={styles.row}>
                <Text>Basic Salary</Text>
                <Text>{formatMoney(d.basePay)}</Text>
              </View>
              <View style={[styles.row, styles.underlineBottom]}>
                <Text>Absences</Text>
                <Text>-</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.bold}>BASIC PAY</Text>
                <Text style={styles.bold}>{formatMoney(d.basePay)}</Text>
              </View>

              <View style={styles.spacer} />

              <View style={styles.row}>
                <Text>Commission</Text>
                <Text>{dashOr(d.commissionTotal)}</Text>
              </View>
              <View style={styles.row}>
                <Text>Tips</Text>
                <Text>{dashOr(d.tips)}</Text>
              </View>
              <View style={[styles.row, styles.underlineBottom]}>
                <Text>Bonus</Text>
                <Text>{dashOr(d.bonus)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.bold}>GROSS PAY</Text>
                <Text style={styles.bold}>{formatMoney(grossPay)}</Text>
              </View>
            </View>

            <View style={styles.column}>
              <Text style={styles.bold}>Less: Deductions</Text>
              <View style={styles.row}>
                <Text>Withholding Tax</Text>
                <Text>{dashOr(d.withholdingTax)}</Text>
              </View>
              <View style={styles.row}>
                <Text>SSS</Text>
                <Text>{dashOr(d.sssContribution)}</Text>
              </View>
              <View style={styles.row}>
                <Text>Philhealth</Text>
                <Text>{dashOr(d.philhealthContribution)}</Text>
              </View>
              <View style={styles.row}>
                <Text>Pag-ibig</Text>
                <Text>{dashOr(d.pagibigContribution)}</Text>
              </View>
              <View style={styles.row}>
                <Text>SSS Loan</Text>
                <Text>{dashOr(d.sssLoan)}</Text>
              </View>
              <View style={styles.row}>
                <Text>HDMF Loan</Text>
                <Text>{dashOr(d.hdmfLoan)}</Text>
              </View>
              <View style={styles.row}>
                <Text>Advances</Text>
                <Text>{dashOr(d.cashAdvanceTotal)}</Text>
              </View>
              <View style={[styles.row, styles.underlineBottom]}>
                <Text>Other deductions</Text>
                <Text>{dashOr(d.otherDeductionsTotal)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.bold}>TOTAL DEDUCTIONS</Text>
                <Text style={styles.bold}>{formatMoney(totalDeductions)}</Text>
              </View>

              <View style={styles.spacer} />
              <View style={styles.spacer} />

              <View style={[styles.row, styles.netPayBox]}>
                <Text style={styles.bold}>NET PAY</Text>
                <Text style={styles.bold}>{formatMoney(d.netPay)}</Text>
              </View>
            </View>
          </View>
        </View>
      </Page>

      {d.commissionJobs && d.commissionJobs.length > 0 && (
        <Page size="A4" style={styles.page}>
          <View style={styles.border}>
            {d.logoUrl && <Image style={styles.logo} src={d.logoUrl} />}
            <Text style={styles.businessName}>{d.businessName}</Text>
            {d.address && <Text style={styles.addressLine}>{d.address}</Text>}
            <Text style={styles.breakdownTitle}>
              COMMISSION BREAKDOWN — {d.employeeName.toUpperCase()} ({d.periodLabel})
            </Text>

            <View style={styles.tableHeaderRow}>
              <Text style={styles.colJob}>Job #</Text>
              <Text style={styles.colPlate}>Plate</Text>
              <Text style={styles.colSize}>Size</Text>
              <Text style={styles.colDate}>Date</Text>
              <Text style={styles.colService}>Service</Text>
              <Text style={styles.colServicesOnJob}>Services on job</Text>
              <Text style={styles.colRate}>Rate</Text>
              <Text style={styles.colGross}>Job total</Text>
              <Text style={styles.colDiscount}>Discount</Text>
              <Text style={styles.colCommission}>Commission</Text>
            </View>
            {d.commissionJobs.map((job, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.colJob}>#{job.jobNumber.slice(-4)}</Text>
                <Text style={styles.colPlate}>{job.plateNumber ?? '-'}</Text>
                <Text style={styles.colSize}>{job.vehicleSizeName ?? '-'}</Text>
                <Text style={styles.colDate}>{job.date}</Text>
                <Text style={styles.colService}>{job.serviceName ?? 'Whole job'}</Text>
                <Text style={styles.colServicesOnJob}>{job.jobServiceNames || '-'}</Text>
                <Text style={styles.colRate}>{job.rate}%</Text>
                <Text style={styles.colGross}>{formatMoney(job.grossAmount)}</Text>
                <Text style={styles.colDiscount}>{job.discountAmount ? formatMoney(job.discountAmount) : '-'}</Text>
                <Text style={styles.colCommission}>{formatMoney(job.commissionAmount)}</Text>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={[styles.colJob, styles.bold]}>Total</Text>
              <Text style={styles.colPlate} />
              <Text style={styles.colSize} />
              <Text style={styles.colDate} />
              <Text style={styles.colService} />
              <Text style={styles.colServicesOnJob} />
              <Text style={styles.colRate} />
              <Text style={styles.colGross} />
              <Text style={styles.colDiscount} />
              <Text style={[styles.colCommission, styles.bold]}>
                {formatMoney(d.commissionJobs.reduce((sum, j) => sum + j.commissionAmount, 0))}
              </Text>
            </View>

            {discountedJobs.length > 0 && (
              <View>
                <Text style={styles.discountedTitle} minPresenceAhead={60}>
                  DISCOUNTED JOBS
                </Text>
                <Text style={styles.discountedNote}>
                  A discount given at checkout reduces commission in proportion to the discount. A service given for free
                  (freebie) keeps its full commission.
                </Text>
                <View style={styles.tableHeaderRow}>
                  <Text style={styles.dColJob}>Job #</Text>
                  <Text style={styles.dColPlate}>Plate</Text>
                  <Text style={styles.dColDate}>Date</Text>
                  <Text style={styles.dColDetail}>Discounted</Text>
                  <Text style={styles.dColMoney}>Discount</Text>
                  <Text style={styles.dColMoney}>Commission before</Text>
                  <Text style={styles.dColMoney}>Less discount</Text>
                  <Text style={styles.dColLast}>Commission</Text>
                </View>
                {discountedJobs.map((job, i) => (
                  <View key={i} style={styles.tableRow}>
                    <Text style={styles.dColJob}>#{job.jobNumber.slice(-4)}</Text>
                    <Text style={styles.dColPlate}>{job.plateNumber ?? '-'}</Text>
                    <Text style={styles.dColDate}>{job.date}</Text>
                    <Text style={styles.dColDetail}>{job.discountDetail || '-'}</Text>
                    <Text style={styles.dColMoney}>{formatMoney(job.discountAmount ?? 0)}</Text>
                    <Text style={styles.dColMoney}>{formatMoney(job.commissionBeforeDiscount ?? job.commissionAmount)}</Text>
                    <Text style={styles.dColMoney}>
                      {job.discountCommissionCut ? `-${formatMoney(job.discountCommissionCut)}` : job.hasFreebie ? 'Freebie' : '-'}
                    </Text>
                    <Text style={styles.dColLast}>{formatMoney(job.commissionAmount)}</Text>
                  </View>
                ))}
                <View style={styles.totalRow}>
                  <Text style={[styles.dColJob, styles.bold]}>Total</Text>
                  <Text style={styles.dColPlate} />
                  <Text style={styles.dColDate} />
                  <Text style={styles.dColDetail} />
                  <Text style={[styles.dColMoney, styles.bold]}>
                    {formatMoney(discountedJobs.reduce((s, j) => s + (j.discountAmount ?? 0), 0))}
                  </Text>
                  <Text style={[styles.dColMoney, styles.bold]}>
                    {formatMoney(discountedJobs.reduce((s, j) => s + (j.commissionBeforeDiscount ?? j.commissionAmount), 0))}
                  </Text>
                  <Text style={[styles.dColMoney, styles.bold]}>
                    -{formatMoney(discountedJobs.reduce((s, j) => s + (j.discountCommissionCut ?? 0), 0))}
                  </Text>
                  <Text style={[styles.dColLast, styles.bold]}>
                    {formatMoney(discountedJobs.reduce((s, j) => s + j.commissionAmount, 0))}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </Page>
      )}
    </Document>
  )
}
