import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { formatMoney } from '@/lib/money'

export interface PayslipPdfData {
  businessName: string
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
    </Document>
  )
}
