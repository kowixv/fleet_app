import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate, formatMoney, formatNumber, pdfSafeText } from "./statement-formatting";
import type { AmazonStatementRevenueLine, AmazonStatementViewModel } from "./statement-view-model";

const colors = {
  navy: "#173f5f",
  navyDark: "#12344d",
  paleBlue: "#eaf3f8",
  paleGold: "#fff6df",
  paleGreen: "#e9f6ec",
  paleRose: "#fff0eb",
  white: "#ffffff",
  ink: "#273444",
  muted: "#667085",
  line: "#b9c9d6",
  danger: "#a83b2f",
  green: "#137a55",
};

const s = StyleSheet.create({
  page: {
    paddingTop: 92,
    paddingBottom: 36,
    paddingHorizontal: 28,
    fontFamily: "Helvetica",
    fontSize: 7.2,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 76,
    paddingTop: 17,
    paddingBottom: 14,
    paddingHorizontal: 32,
    backgroundColor: colors.navy,
    flexDirection: "row",
  },
  headerLeft: { width: "70%" },
  headerRight: { width: "30%", paddingLeft: 10 },
  title: {
    fontFamily: "Helvetica-Bold",
    fontSize: 17,
    color: colors.white,
    letterSpacing: 0.3,
  },
  subtitle: { marginTop: 5, fontSize: 8, color: "#d9e9f2" },
  company: { fontFamily: "Helvetica-Bold", fontSize: 11, color: colors.white },
  companySecondary: { marginTop: 4, fontSize: 7, color: "#d9e9f2" },
  status: {
    marginTop: 7,
    alignSelf: "flex-start",
    paddingVertical: 3,
    paddingHorizontal: 6,
    backgroundColor: colors.white,
    color: colors.navy,
    fontFamily: "Helvetica-Bold",
    fontSize: 6.3,
  },
  watermark: {
    position: "absolute",
    top: 300,
    left: 50,
    right: 50,
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
    fontSize: 50,
    color: "#d9e1e7",
    opacity: 0.2,
    transform: "rotate(-28deg)",
  },
  identity: {
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: 8,
  },
  identityRow: {
    minHeight: 24,
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  identityRowLast: { minHeight: 24, flexDirection: "row" },
  identityLabel: {
    width: "18%",
    paddingVertical: 5,
    paddingHorizontal: 5,
    backgroundColor: colors.paleBlue,
    borderRightWidth: 1,
    borderRightColor: colors.line,
    fontFamily: "Helvetica-Bold",
    color: colors.navyDark,
    fontSize: 6.6,
  },
  identityValue: {
    width: "32%",
    paddingVertical: 5,
    paddingHorizontal: 7,
    borderRightWidth: 1,
    borderRightColor: colors.line,
    fontSize: 7.3,
  },
  identityValueLast: {
    width: "32%",
    paddingVertical: 5,
    paddingHorizontal: 7,
    fontSize: 7.3,
  },
  cards: { flexDirection: "row", marginBottom: 9 },
  card: {
    width: "20%",
    minHeight: 58,
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: "space-between",
  },
  cardLabel: {
    minHeight: 22,
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
    fontSize: 6.2,
    lineHeight: 1.08,
    color: colors.navyDark,
  },
  cardValue: {
    marginTop: 5,
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
    fontSize: 12.5,
    color: colors.navyDark,
  },
  grossCard: { backgroundColor: colors.paleBlue },
  rateCard: { backgroundColor: colors.paleGold },
  payCard: { backgroundColor: "#f3f8fb" },
  deductionCard: { backgroundColor: colors.paleRose },
  netCard: { backgroundColor: colors.paleGreen },
  negative: { color: colors.danger },
  positive: { color: colors.green },
  sectionTitle: {
    marginTop: 7,
    marginBottom: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    color: colors.navy,
  },
  sectionIntro: { marginBottom: 4, color: colors.muted, fontSize: 6.4 },
  table: { borderWidth: 1, borderColor: colors.line },
  tableHeader: { flexDirection: "row", backgroundColor: colors.navy },
  th: {
    paddingVertical: 5,
    paddingHorizontal: 4,
    color: colors.white,
    fontFamily: "Helvetica-Bold",
    fontSize: 6.1,
  },
  row: {
    flexDirection: "row",
    minHeight: 23,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowAlt: { backgroundColor: "#f7fafc" },
  totalRow: { flexDirection: "row", minHeight: 24, backgroundColor: colors.paleBlue },
  td: { paddingVertical: 5, paddingHorizontal: 4, fontSize: 6.5, lineHeight: 1.08 },
  tdBold: { paddingVertical: 5, paddingHorizontal: 4, fontFamily: "Helvetica-Bold", fontSize: 6.5 },
  right: { textAlign: "right" },
  center: { textAlign: "center" },
  calculationBox: { borderWidth: 1, borderColor: colors.line },
  calcRow: {
    flexDirection: "row",
    minHeight: 28,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  calcRowLast: { flexDirection: "row", minHeight: 32, backgroundColor: colors.paleGreen },
  calcLabel: { width: "76%", paddingVertical: 7, paddingHorizontal: 8, fontSize: 7.5 },
  calcAmount: { width: "24%", paddingVertical: 7, paddingHorizontal: 8, textAlign: "right", fontFamily: "Helvetica-Bold", fontSize: 8 },
  noteBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#f7fafc",
    paddingVertical: 8,
    paddingHorizontal: 9,
  },
  note: { marginBottom: 4, fontSize: 6.8, lineHeight: 1.2 },
  signatureRow: { flexDirection: "row", marginTop: 14 },
  signaturePanel: { width: "48%", borderWidth: 1, borderColor: colors.line },
  signatureSpacer: { width: "4%" },
  signatureHeader: {
    paddingVertical: 6,
    paddingHorizontal: 7,
    backgroundColor: colors.navy,
    color: colors.white,
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
  },
  signatureField: {
    minHeight: 30,
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  signatureFieldLast: { minHeight: 30, flexDirection: "row" },
  signatureLabel: {
    width: "37%",
    paddingVertical: 8,
    paddingHorizontal: 6,
    backgroundColor: colors.paleBlue,
    fontFamily: "Helvetica-Bold",
    fontSize: 6.4,
  },
  signatureValue: { width: "63%", paddingVertical: 8, paddingHorizontal: 7, fontSize: 6.8 },
  signatureLine: { marginTop: 9, borderBottomWidth: 1, borderBottomColor: colors.ink },
  footer: {
    position: "absolute",
    left: 28,
    right: 28,
    bottom: 16,
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 5,
  },
  footerLeft: { width: "78%", color: colors.muted, fontSize: 5.8 },
  footerRight: { width: "22%", textAlign: "right", color: colors.muted, fontSize: 5.8 },
});

function SafeText({ children, style }: { children: string; style?: unknown }) {
  return <Text style={style as never}>{pdfSafeText(children)}</Text>;
}

export function DriverStatementPdfDocument({ model }: { model: AmazonStatementViewModel }) {
  const gross = finite(model.summary.grossRevenue);
  const deductions = Math.abs(finite(model.summary.totalDeductions));
  const net = finite(model.summary.netAmount);
  const driverGrossPay = finite(model.summary.calculationBaseAmount);
  const rate = gross > 0 ? (driverGrossPay / gross) * 100 : 0;

  return (
    <Document
      title={`${model.documentId} ${model.templateVersion}`}
      author={model.company.name}
      subject="Amazon driver settlement statement"
      producer={`fleet-app ${model.templateVersion}`}
      creator="fleet-app"
    >
      <Page size="LETTER" style={s.page} wrap>
        <Watermark model={model} />
        <Header model={model} />
        <Identity model={model} />
        <SummaryCards gross={gross} rate={rate} driverGrossPay={driverGrossPay} deductions={deductions} net={net} />
        <RevenueTable model={model} />
        <Footer model={model} />
      </Page>

      <Page size="LETTER" style={s.page} wrap>
        <Watermark model={model} />
        <Header model={model} />
        <SafeText style={s.sectionTitle}>Calculation Summary / Hesap Ozeti</SafeText>
        <Calculation gross={gross} rate={rate} driverGrossPay={driverGrossPay} deductions={deductions} net={net} />
        <Notes model={model} />
        <Signatures model={model} />
        <Footer model={model} />
      </Page>
    </Document>
  );
}

function Header({ model }: { model: AmazonStatementViewModel }) {
  const title = model.statementType === "box_truck_driver"
    ? "BOX TRUCK DRIVER SETTLEMENT"
    : "COMPANY DRIVER SETTLEMENT";
  return (
    <View style={s.header} fixed>
      <View style={s.headerLeft}>
        <SafeText style={s.title}>{title}</SafeText>
        <SafeText style={s.subtitle}>Amazon Relay Statement - English / Turkce</SafeText>
      </View>
      <View style={s.headerRight}>
        <SafeText style={s.company}>{text(model.company.name, "ZYNP LLC")}</SafeText>
        <SafeText style={s.companySecondary}>{text(model.company.secondary, "Amazon Relay statement")}</SafeText>
        <SafeText style={s.status}>{`Status / Durum: ${statusLabel(model)}`}</SafeText>
      </View>
    </View>
  );
}

function Watermark({ model }: { model: AmazonStatementViewModel }) {
  if (model.candidateStatus !== "draft" && model.candidateStatus !== "needs_review") return null;
  return <SafeText style={s.watermark}>{model.candidateStatus === "needs_review" ? "NEEDS REVIEW" : "DRAFT"}</SafeText>;
}

function Identity({ model }: { model: AmazonStatementViewModel }) {
  return (
    <View style={s.identity}>
      <IdentityRow leftLabel="Driver / Sofor" leftValue={text(model.payee.name)} rightLabel="Role / Calisma Tipi" rightValue={model.statementType === "box_truck_driver" ? "Box Truck Driver" : "Company Driver"} />
      <IdentityRow leftLabel="Statement Period / Donem" leftValue={`${formatDate(model.periodStart)} - ${formatDate(model.periodEnd)}`} rightLabel="Truck / Unit" rightValue={`Unit ${text(model.vehicleDisplay)}`} />
      <IdentityRow leftLabel="Invoice Date / Fatura" leftValue={formatDate(model.invoiceMetadata?.invoiceDate)} rightLabel="Payment Date / Odeme" rightValue={formatDate(model.invoiceMetadata?.paymentDate)} last />
    </View>
  );
}

function IdentityRow({
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  last,
}: {
  leftLabel: string;
  leftValue: string;
  rightLabel: string;
  rightValue: string;
  last?: boolean;
}) {
  return (
    <View style={last ? s.identityRowLast : s.identityRow} wrap={false}>
      <SafeText style={s.identityLabel}>{leftLabel}</SafeText>
      <SafeText style={s.identityValue}>{leftValue}</SafeText>
      <SafeText style={s.identityLabel}>{rightLabel}</SafeText>
      <SafeText style={s.identityValueLast}>{rightValue}</SafeText>
    </View>
  );
}

function SummaryCards({ gross, rate, driverGrossPay, deductions, net }: { gross: number; rate: number; driverGrossPay: number; deductions: number; net: number }) {
  return (
    <View style={s.cards} wrap={false}>
      <Card style={s.grossCard} label="TRUCK GROSS\nTIR BRUT GELIR" value={formatMoney(gross)} />
      <Card style={s.rateCard} label="DRIVER RATE\nSOFOR ORANI" value={`${formatPercent(rate)}%`} />
      <Card style={s.payCard} label="DRIVER GROSS PAY\nSOFOR BRUT UCRET" value={formatMoney(driverGrossPay)} />
      <Card style={s.deductionCard} label="DEDUCTIONS\nKESINTILER" value={formatMoney(-deductions)} negative />
      <Card style={s.netCard} label="NET DRIVER PAY\nNET SOFOR ODEMESI" value={formatMoney(net)} positive={net >= 0} negative={net < 0} />
    </View>
  );
}

function Card({ style, label, value, negative, positive }: { style: unknown; label: string; value: string; negative?: boolean; positive?: boolean }) {
  const valueStyle = negative ? [s.cardValue, s.negative] : positive ? [s.cardValue, s.positive] : s.cardValue;
  return (
    <View style={[s.card, style as never]}>
      <SafeText style={s.cardLabel}>{label}</SafeText>
      <SafeText style={valueStyle}>{value}</SafeText>
    </View>
  );
}

function RevenueTable({ model }: { model: AmazonStatementViewModel }) {
  const lines = model.revenueLines.slice().sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));
  const totals = revenueTotals(lines);
  return (
    <View>
      <SafeText style={s.sectionTitle}>Revenue Details / Gelir Detaylari</SafeText>
      <SafeText style={s.sectionIntro}>Same Trip ID rows are consolidated. Route shows pickup and final delivery when available.</SafeText>
      <View style={s.table}>
        <View style={s.tableHeader} fixed>
          <SafeText style={[s.th, { width: "12%" }]}>Date</SafeText>
          <SafeText style={[s.th, { width: "18%" }]}>Trip / Load</SafeText>
          <SafeText style={[s.th, { width: "38%" }]}>Route</SafeText>
          <SafeText style={[s.th, s.right, { width: "12%" }]}>Miles</SafeText>
          <SafeText style={[s.th, s.right, { width: "20%" }]}>Gross</SafeText>
        </View>
        {lines.map((line, index) => (
          <View key={line.id} style={index % 2 ? [s.row, s.rowAlt] : s.row} wrap={false}>
            <SafeText style={[s.td, { width: "12%" }]}>{revenueDate(line)}</SafeText>
            <SafeText style={[s.td, { width: "18%" }]}>{text(line.tripId ?? line.loadId)}</SafeText>
            <SafeText style={[s.td, { width: "38%" }]}>{text(line.routeDisplay, line.routeStatus === "pending_review" ? "Pending Review" : "N/A")}</SafeText>
            <SafeText style={[s.td, s.right, { width: "12%" }]}>{formatNumber(line.distance, 2)}</SafeText>
            <SafeText style={[s.tdBold, s.right, { width: "20%" }]}>{formatMoney(finite(line.grossAmount))}</SafeText>
          </View>
        ))}
        <View style={s.totalRow} wrap={false}>
          <SafeText style={[s.tdBold, { width: "12%" }]}>TOTAL</SafeText>
          <SafeText style={[s.td, { width: "18%" }]}>{`${lines.length} loads`}</SafeText>
          <SafeText style={[s.td, { width: "38%" }]}>Completed loaded miles</SafeText>
          <SafeText style={[s.tdBold, s.right, { width: "12%" }]}>{formatNumber(totals.miles, 2)}</SafeText>
          <SafeText style={[s.tdBold, s.right, { width: "20%" }]}>{formatMoney(totals.gross)}</SafeText>
        </View>
      </View>
    </View>
  );
}

function Calculation({ gross, rate, driverGrossPay, deductions, net }: { gross: number; rate: number; driverGrossPay: number; deductions: number; net: number }) {
  return (
    <View style={s.calculationBox}>
      <CalcRow label="Truck gross revenue / Tir brut geliri" amount={formatMoney(gross)} />
      <CalcRow label={`Driver pay rate / Sofor orani (${formatPercent(rate)}%)`} amount={formatMoney(driverGrossPay)} />
      <CalcRow label="Driver deductions / Sofor kesintileri" amount={formatMoney(-deductions)} negative={deductions > 0} />
      <View style={s.calcRowLast} wrap={false}>
        <SafeText style={s.calcLabel}>NET DRIVER PAY / NET SOFOR ODEMESI</SafeText>
        <SafeText style={net < 0 ? [s.calcAmount, s.negative] : [s.calcAmount, s.positive]}>{formatMoney(net)}</SafeText>
      </View>
    </View>
  );
}

function CalcRow({ label, amount, negative }: { label: string; amount: string; negative?: boolean }) {
  return (
    <View style={s.calcRow} wrap={false}>
      <SafeText style={s.calcLabel}>{label}</SafeText>
      <SafeText style={negative ? [s.calcAmount, s.negative] : s.calcAmount}>{amount}</SafeText>
    </View>
  );
}

function Notes({ model }: { model: AmazonStatementViewModel }) {
  const notes = [
    "Driver pay is calculated from the selected Amazon revenue loads for this statement period.",
    "Fuel, insurance, ELD, company fee and truck operating expenses are excluded unless explicitly assigned to the driver.",
    ...model.calculationNotes,
  ];
  return (
    <View style={s.noteBox}>
      <SafeText style={[s.note, { fontFamily: "Helvetica-Bold", color: colors.navy }]}>Statement Notes / Statement Notlari</SafeText>
      {notes.map((note, index) => <SafeText key={`${index}-${note}`} style={s.note}>{`- ${note}`}</SafeText>)}
    </View>
  );
}

function Signatures({ model }: { model: AmazonStatementViewModel }) {
  return (
    <View style={s.signatureRow} wrap={false}>
      <SignaturePanel title="COMPANY AUTHORIZATION / SIRKET ONAYI" name={text(model.companySignature.printedName, model.company.name)} />
      <View style={s.signatureSpacer} />
      <SignaturePanel title="DRIVER APPROVAL / SOFOR ONAYI" name={text(model.payeeSignature.printedName, model.payee.name)} />
    </View>
  );
}

function SignaturePanel({ title, name }: { title: string; name: string }) {
  return (
    <View style={s.signaturePanel}>
      <SafeText style={s.signatureHeader}>{title}</SafeText>
      <SignatureField label="Name / Isim" value={name} />
      <SignatureField label="Signature / Imza" signature />
      <SignatureField label="Date / Tarih" value="" last />
    </View>
  );
}

function SignatureField({ label, value = "", signature, last }: { label: string; value?: string; signature?: boolean; last?: boolean }) {
  return (
    <View style={last ? s.signatureFieldLast : s.signatureField}>
      <SafeText style={s.signatureLabel}>{label}</SafeText>
      <View style={s.signatureValue}>
        {signature ? <View style={s.signatureLine} /> : <SafeText>{value || "N/A"}</SafeText>}
      </View>
    </View>
  );
}

function Footer({ model }: { model: AmazonStatementViewModel }) {
  return (
    <View style={s.footer} fixed>
      <SafeText style={s.footerLeft}>{`Prepared from saved Amazon statement data | ${model.documentId} | ${model.footer.templateVersion}`}</SafeText>
      <Text style={s.footerRight} render={({ pageNumber, totalPages }) => `Page / Sayfa ${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function statusLabel(model: AmazonStatementViewModel): string {
  if (model.settlementStatus === "void" || model.candidateStatus === "void") return "VOID";
  if (model.candidateStatus === "needs_review") return "NEEDS REVIEW";
  if (model.candidateStatus === "ready") return "READY";
  if (model.candidateStatus === "converted") return "CONVERTED";
  return "DRAFT";
}

function revenueTotals(lines: AmazonStatementRevenueLine[]) {
  return lines.reduce((total, line) => ({
    miles: total.miles + finite(line.distance),
    gross: total.gross + finite(line.grossAmount),
  }), { miles: 0, gross: 0 });
}

function revenueDate(line: AmazonStatementRevenueLine): string {
  const start = line.startDate ?? line.date ?? null;
  const end = line.endDate ?? line.date ?? null;
  if (start && end && start !== end) return `${shortDate(start)}-${shortDate(end)}`;
  return shortDate(end ?? start);
}

function shortDate(value: string | null | undefined): string {
  if (!value) return "N/A";
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [, month, day] = value.slice(0, 10).split("-");
    return `${month}/${day}`;
  }
  return value;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Math.round(value * 100) / 100 % 1 === 0
    ? String(Math.round(value))
    : (Math.round(value * 100) / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function finite(value: number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: string | null | undefined, fallback = "N/A"): string {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}
