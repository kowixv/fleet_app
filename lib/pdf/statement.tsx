import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

/** Transliterate Turkish-specific glyphs so the built-in Helvetica renders cleanly. */
export function tr(s: string | null | undefined): string {
  if (!s) return "";
  const map: Record<string, string> = {
    ş: "s", Ş: "S", ğ: "g", Ğ: "G", ı: "i", İ: "I",
    ö: "o", Ö: "O", ü: "u", Ü: "U", ç: "c", Ç: "C",
  };
  return s.replace(/[şŞğĞıİöÖüÜçÇ]/g, (c) => map[c] ?? c);
}

function money(n: number): string {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${v < 0 ? "-" : ""}$${s}`;
}

export interface StatementData {
  title: string;
  companyName: string;
  scac?: string | null;
  sourceNote?: string;
  status?: string;
  payeeName: string;
  payeeRole: string;
  unitNumber?: string | null;
  period: string;
  invoiceDate?: string;
  paymentDate?: string;
  grossRevenue: number;
  netPay: number;
  ourCommission: number;
  lineItems: { key?: string; labelEn: string; labelTr: string; amount: number }[];
  calculationRows?: { key: string; labelEn: string; labelTr: string; amount: number; role: string }[];
  loads: { reference?: string; route?: string; type?: string; grossAmount: number; usageGroup?: string }[];
  expenses: { category: string; amount: number; usageGroup?: string }[];
  notes?: string | null;
}

const c = {
  brand: "#0f766e",
  ink: "#0f172a",
  sub: "#64748b",
  line: "#e2e8f0",
  band: "#f1f5f9",
};

const s = StyleSheet.create({
  page: { padding: 34, fontSize: 9, color: c.ink, fontFamily: "Helvetica" },
  h1: { fontSize: 14, fontFamily: "Helvetica-Bold", color: c.brand },
  sub: { fontSize: 8, color: c.sub, marginTop: 2 },
  section: { marginTop: 14 },
  sectionTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 5 },
  row: { flexDirection: "row" },
  infoCell: { width: "25%", paddingVertical: 3 },
  infoLabel: { fontSize: 7, color: c.sub },
  infoValue: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
  },
  summaryLabel: { color: c.sub },
  net: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 7,
    paddingHorizontal: 8,
    backgroundColor: c.brand,
    color: "#fff",
    marginTop: 6,
    borderRadius: 3,
  },
  netText: { color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 11 },
  th: { flexDirection: "row", backgroundColor: c.band, paddingVertical: 4, paddingHorizontal: 4 },
  td: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: c.line },
  cId: { width: "20%" },
  cRoute: { width: "45%" },
  cType: { width: "20%" },
  cAmt: { width: "15%", textAlign: "right" },
  bold: { fontFamily: "Helvetica-Bold" },
  sign: { marginTop: 34, flexDirection: "row", justifyContent: "space-between" },
  signBox: { width: "45%", borderTopWidth: 1, borderTopColor: c.ink, paddingTop: 4 },
  note: { marginTop: 12, fontSize: 7, color: c.sub },
  void: { marginTop: 8, padding: 6, backgroundColor: "#fee2e2", color: "#991b1b", fontFamily: "Helvetica-Bold", textAlign: "center" },
});

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.infoCell}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value}</Text>
    </View>
  );
}

export function StatementDocument({ data }: { data: StatementData }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View>
          <Text style={s.h1}>{tr(data.title)}</Text>
          <Text style={s.sub}>
            {tr(data.companyName)}
            {data.scac ? `   SCAC: ${data.scac}` : ""}
          </Text>
          {data.sourceNote ? <Text style={s.sub}>{tr(data.sourceNote)}</Text> : null}
          {data.status === "void" ? <Text style={s.void}>VOID / IPTAL</Text> : null}
        </View>

        {/* Info grid */}
        <View style={[s.section, s.row, { flexWrap: "wrap" }]}>
          <Info label="Driver / Sofor" value={tr(data.payeeName)} />
          <Info label="Role / Tip" value={tr(data.payeeRole)} />
          <Info label="Unit / Arac" value={data.unitNumber ?? "-"} />
          <Info label="Period / Donem" value={data.period} />
          {data.invoiceDate ? <Info label="Invoice / Fatura" value={data.invoiceDate} /> : null}
          {data.paymentDate ? <Info label="Payment / Odeme" value={data.paymentDate} /> : null}
        </View>

        {/* Calculation */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Calculation / Hesaplama</Text>
          {(data.calculationRows && data.calculationRows.length > 0 ? data.calculationRows : [
            { key: "gross", labelEn: "Gross revenue", labelTr: "Brut gelir", amount: data.grossRevenue, role: "base" },
            ...data.lineItems.map((li, i) => ({ key: `${li.key ?? "item"}-${i}`, labelEn: li.labelEn, labelTr: li.labelTr, amount: li.amount, role: "deduction" })),
            { key: "net", labelEn: "Net Pay", labelTr: "Net Odeme", amount: data.netPay, role: "net" },
          ]).map((li, i) => (
            <View key={i} style={s.summaryRow}>
              <Text style={s.summaryLabel}>
                {tr(li.labelEn)} / {tr(li.labelTr)}
              </Text>
              <Text style={li.role === "net" ? s.bold : undefined}>{money(li.amount)}</Text>
            </View>
          ))}
          <View style={s.net}>
            <Text style={s.netText}>Net Pay / Net Odeme</Text>
            <Text style={s.netText}>{money(data.netPay)}</Text>
          </View>
        </View>

        {/* Revenue details */}
        {data.loads.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Revenue Details / Gelir Detaylari</Text>
            <View style={s.th}>
              <Text style={[s.cId, s.bold]}>Load ID</Text>
              <Text style={[s.cRoute, s.bold]}>Route / Guzergah</Text>
              <Text style={[s.cType, s.bold]}>Type / Tip</Text>
              <Text style={[s.cAmt, s.bold]}>Gross</Text>
            </View>
            {data.loads.map((l, i) => (
              <View key={i} style={s.td}>
                <Text style={s.cId}>{l.reference ?? "-"}</Text>
                <Text style={s.cRoute}>{tr(l.route) || "-"}</Text>
                <Text style={s.cType}>{tr(l.usageGroup ?? l.type) || "-"}</Text>
                <Text style={s.cAmt}>{money(l.grossAmount)}</Text>
              </View>
            ))}
            <View style={[s.td, { borderBottomWidth: 0 }]}>
              <Text style={[s.cId, s.bold]}>Total / Toplam</Text>
              <Text style={s.cRoute}> </Text>
              <Text style={s.cType}> </Text>
              <Text style={[s.cAmt, s.bold]}>
                {money(data.loads.reduce((a, l) => a + l.grossAmount, 0))}
              </Text>
            </View>
          </View>
        )}

        {/* Expense details */}
        {data.expenses.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Expense Details / Masraf Detaylari</Text>
            {data.expenses.map((e, i) => (
              <View key={i} style={s.summaryRow}>
                <Text style={s.summaryLabel}>{tr(e.category)} {e.usageGroup ? `(${e.usageGroup})` : ""}</Text>
                <Text>{money(e.amount)}</Text>
              </View>
            ))}
          </View>
        )}

        {data.notes ? <Text style={s.note}>Note / Not: {tr(data.notes)}</Text> : null}

        {/* Signature block — no logo / MC / DOT / phone / email / address */}
        <View style={s.sign}>
          <View style={s.signBox}>
            <Text>{tr(data.companyName)}</Text>
            <Text style={s.infoLabel}>Company Signature / Sirket Imza</Text>
          </View>
          <View style={s.signBox}>
            <Text>{tr(data.payeeName)}</Text>
            <Text style={s.infoLabel}>Received By / Teslim Alan</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

const TITLES: Record<string, string> = {
  company_driver: "DRIVER PAYMENT STATEMENT",
  box_truck_driver: "BOX TRUCK DRIVER PAYMENT STATEMENT",
  owner_operator: "OWNER OPERATOR SETTLEMENT STATEMENT",
  managed_investor: "INVESTOR VEHICLE SETTLEMENT",
  external_carrier_statement: "EXTERNAL CARRIER STATEMENT SUMMARY",
};
export const ROLE_LABELS: Record<string, string> = {
  company_driver: "Company Driver",
  box_truck_driver: "Box Truck Driver",
  owner_operator: "Owner Operator",
  managed_investor: "Investor",
  external_carrier_statement: "External Carrier",
};
export function titleFor(type: string): string {
  return TITLES[type] ?? "SETTLEMENT STATEMENT";
}
