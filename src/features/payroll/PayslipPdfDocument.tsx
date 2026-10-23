import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { formatMoney } from '@/lib/money'

export interface PayslipPdfJobRow {
  jobNumber: string
  plateNumber: string | null
  date: string
  serviceName: string | null
  rate: number
  grossAmount: number
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
  page: { padding: 24, fontSize: 9, fontFamily: 'Helvetica' },
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
  },
  tableRow: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: '#ccc' },
  colJob: { width: '16%' },
  colPlate: { width: '14%' },
  colDate: { width: '14%' },
  colService: { width: '26%' },
  colRate: { width: '10%', textAlign: 'right' },
  colGross: { width: '10%', textAlign: 'right' },
  colCommission: { width: '10%', textAlign: 'right' },
  totalRow: { flexDirection: 'row', paddingTop: 6, borderTopWidth: 1, borderTopColor: '#000', marginTop: 4 },
  logo: { height: 40, maxWidth: 160, objectFit: 'contain', alignSelf: 'center', marginBottom: 6 },
})

function dashOr(value: number) {
  return value > 0 ? formatMoney(value) : '-'
}

export function PayslipPdfDocument(d: PayslipPdfData) {
  const grossPay = d.basePay + d.commissionTotal + d.tips + d.bonus
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
              <Text style={styles.colDate}>Date</Text>
              <Text style={styles.colService}>Service</Text>
              <Text style={styles.colRate}>Rate</Text>
              <Text style={styles.colGross}>Job total</Text>
              <Text style={styles.colCommission}>Commission</Text>
            </View>
            {d.commissionJobs.map((job, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.colJob}>{job.jobNumber}</Text>
                <Text style={styles.colPlate}>{job.plateNumber ?? '-'}</Text>
                <Text style={styles.colDate}>{job.date}</Text>
                <Text style={styles.colService}>{job.serviceName ?? 'Whole job'}</Text>
                <Text style={styles.colRate}>{job.rate}%</Text>
                <Text style={styles.colGross}>{formatMoney(job.grossAmount)}</Text>
                <Text style={styles.colCommission}>{formatMoney(job.commissionAmount)}</Text>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={[styles.colJob, styles.bold]}>Total</Text>
              <Text style={styles.colPlate} />
              <Text style={styles.colDate} />
              <Text style={styles.colService} />
              <Text style={styles.colRate} />
              <Text style={styles.colGross} />
              <Text style={[styles.colCommission, styles.bold]}>
                {formatMoney(d.commissionJobs.reduce((sum, j) => sum + j.commissionAmount, 0))}
              </Text>
            </View>
          </View>
        </Page>
      )}
    </Document>
  )
}
