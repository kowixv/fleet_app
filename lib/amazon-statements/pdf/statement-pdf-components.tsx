import { StyleSheet, Text, View } from "@react-pdf/renderer";
import React from "react";
import { label, statementTitle, typeTerminology } from "./statement-labels";
import { displayOrNA, formatDate, formatMoney, formatNumber, pdfSafeText } from "./statement-formatting";
import type {
  AmazonStatementDeductionLine,
  AmazonStatementLanguageMode,
  AmazonStatementRevenueLine,
  AmazonStatementViewModel,
} from "./statement-view-model";

const colors = {
  navy: "#173f5f",
  navyDark: "#12344d",
  blueText: "#163a59",
  ink: "#273444",
  muted: "#667085",
  line: "#b9c9d6",
  paleBlue: "#eaf3f8",
  paleBlue2: "#f3f8fb",
  paleGreen: "#e9f6ec",
  paleGold: "#fff6df",
  paleRose: "#fff0eb",
  palePeach: "#fdf3e8",
  white: "#ffffff",
  danger: "#a83b2f",
  green: "#137a55",
};

export const styles = StyleSheet.create({
  page: {
    paddingTop: 98,
    paddingBottom: 38,
    paddingHorizontal: 28,
    fontFamily: "Helvetica",
    fontSize: 7.4,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    minHeight: 78,
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 34,
    backgroundColor: colors.navy,
    flexDirection: "row",
  },
  headerLeft: { width: "76%" },
  headerRight: { width: "24%", alignItems: "flex-start", paddingLeft: 10 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 18, color: colors.white, letterSpacing: 0.35 },
  subtitle: { marginTop: 5, color: "#d9e9f2", fontSize: 8.2 },
  companyName: { fontFamily: "Helvetica-Bold", fontSize: 11, color: colors.white },
  companySecondary: { marginTop: 5, color: "#d9e9f2", fontSize: 7.6 },
  statusPill: {
    marginTop: 8,
    paddingVertical: 3,
    paddingHorizontal: 7,
    backgroundColor: colors.white,
    color: colors.navy,
    fontFamily: "Helvetica-Bold",
    fontSize: 6.6,
  },
  watermark: {
    position: "absolute",
    top: 310,
    left: 45,
    right: 45,
    textAlign: "center",
    color: "#c9d3dc",
    fontSize: 54,
    fontFamily: "Helvetica-Bold",
    opacity: 0.22,
    transform: "rotate(-30deg)",
  },
  voidWatermark: {
    position: "absolute",
    top: 295,
    left: 35,
    right: 35,
    textAlign: "center",
    color: "#e06a5f",
    fontSize: 68,
    fontFamily: "Helvetica-Bold",
    opacity: 0.2,
    transform: "rotate(-32deg)",
  },
  identityTable: { borderWidth: 1, borderColor: colors.line, marginBottom: 8 },
  identityRow: { flexDirection: "row", minHeight: 24, borderBottomWidth: 1, borderBottomColor: colors.line },
  identityRowLast: { flexDirection: "row", minHeight: 29 },
  identityLabel: {
    width: "19%",
    paddingVertical: 5,
    paddingHorizontal: 6,
    backgroundColor: colors.paleBlue,
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    color: colors.blueText,
    borderRightWidth: 1,
    borderRightColor: colors.line,
  },
  identityValue: {
    width: "31%",
    paddingVertical: 5,
    paddingHorizontal: 7,
    fontSize: 7.4,
    borderRightWidth: 1,
    borderRightColor: colors.line,
  },
  identityValueLast: { width: "31%", paddingVertical: 5, paddingHorizontal: 7, fontSize: 7.4 },
  invoiceValue: { fontSize: 6.15, lineHeight: 1.12 },
  cards: { flexDirection: "row", marginTop: 6, marginBottom: 8 },
  card: {
    width: "20%",
    minHeight: 58,
    paddingVertical: 7,
    paddingHorizontal: 5,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: "space-between",
  },
  cardLabel: { minHeight: 24, textAlign: "center", color: colors.blueText, fontSize: 6.35, lineHeight: 1.08 },
  cardValue: { marginTop: 5, textAlign: "center", fontFamily: "Helvetica-Bold", fontSize: 13.3, color: colors.navyDark },
  grossCard: { backgroundColor: colors.paleBlue },
  fixedCard: { backgroundColor: colors.palePeach },
  percentageCard: { backgroundColor: colors.paleRose },
  fuelCard: { backgroundColor: colors.paleGold },
  netCard: { backgroundColor: colors.paleGreen },
  negative: { color: colors.danger },
  positive: { color: colors.green },
  section: { marginTop: 9 },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 15, color: colors.navy, marginBottom: 3 },
  sectionIntro: { color: colors.muted, fontSize: 6.7, lineHeight: 1.18, marginBottom: 5 },
  bandHeader: { flexDirection: "row", backgroundColor: colors.navy, paddingVertical: 5, paddingHorizontal: 5 },
  bandHeaderText: { color: colors.white, fontFamily: "Helvetica-Bold", fontSize: 6.5 },
  summaryRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: colors.line,
    borderRightColor: colors.line,
    minHeight: 21,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  summaryLabel: { width: "78%", fontSize: 7.1 },
  summaryAmount: { width: "22%", textAlign: "right", fontFamily: "Helvetica-Bold", fontSize: 7.1 },
  netSummaryRow: {
    flexDirection: "row",
    backgroundColor: colors.paleGreen,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  netSummaryLabel: { width: "78%", fontFamily: "Helvetica-Bold", fontSize: 8 },
  netSummaryAmount: { width: "22%", textAlign: "right", fontFamily: "Helvetica-Bold", fontSize: 9.5, color: colors.green },
  table: { width: "100%", borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.line },
  tableHeader: { flexDirection: "row", backgroundColor: colors.navy, minHeight: 24, paddingVertical: 5, paddingHorizontal: 3 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.line, minHeight: 22, paddingVertical: 4, paddingHorizontal: 3 },
  tableRowAlt: { backgroundColor: colors.paleBlue2 },
  tableTotalRow: {
    flexDirection: "row",
    backgroundColor: colors.paleBlue,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    minHeight: 23,
    paddingVertical: 5,
    paddingHorizontal: 3,
  },
  th: { fontFamily: "Helvetica-Bold", fontSize: 5.5, lineHeight: 1.05, color: colors.white },
  td: { fontSize: 6.15, lineHeight: 1.1 },
  tdBold: { fontFamily: "Helvetica-Bold", fontSize: 6.15, lineHeight: 1.1 },
  right: { textAlign: "right" },
  center: { textAlign: "center" },
  metrics: {
    flexDirection: "row",
    marginTop: 5,
    paddingTop: 5,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    color: colors.blueText,
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
  },
  metric: { width: "33.333%" },
  fuelSummary: { marginTop: 5, padding: 6, backgroundColor: colors.paleBlue2, borderWidth: 1, borderColor: colors.line },
  fuelSummaryText: { color: colors.blueText, fontSize: 6.8, lineHeight: 1.2 },
  notesBox: { padding: 9, backgroundColor: colors.paleBlue2, borderWidth: 1, borderColor: colors.line },
  noteLine: { marginBottom: 5, fontSize: 7.2, lineHeight: 1.25 },
  signaturePanel: { marginTop: 11, borderWidth: 1, borderColor: colors.line },
  signaturePanelHeader: { backgroundColor: colors.navy, paddingVertical: 6, paddingHorizontal: 7 },
  signaturePanelHeaderText: { color: colors.white, textAlign: "center", fontFamily: "Helvetica-Bold", fontSize: 7.2 },
  signatureIntro: { minHeight: 30, padding: 7, borderBottomWidth: 1, borderBottomColor: colors.line, fontSize: 7 },
  signatureFieldRow: { flexDirection: "row", minHeight: 32, borderBottomWidth: 1, borderBottomColor: colors.line },
  signatureFieldRowLast: { flexDirection: "row", minHeight: 32 },
  signatureFieldLabel: {
    width: "30%",
    paddingVertical: 8,
    paddingHorizontal: 7,
    backgroundColor: colors.paleBlue2,
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    borderRightWidth: 1,
    borderRightColor: colors.line,
  },
  signatureFieldValue: { width: "70%", paddingVertical: 8, paddingHorizontal: 8, fontSize: 7.2 },
  signatureLine: { marginTop: 8, width: "68%", borderBottomWidth: 1, borderBottomColor: colors.ink },
  footer: {
    position: "absolute",
    left: 28,
    right: 28,
    bottom: 18,
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 5,
    color: colors.muted,
    fontSize: 6.2,
  },
  footerLeft: { width: "76%" },
  footerRight: { width: "24%", textAlign: "right" },
});

function T({ children = "", style }: { children?: string; style?: any }) {
  return <Text style={style}>{pdfSafeText(children)}</Text>;
}

function SectionHeading({ title, intro }: { title: string; intro?: string }) {
  return (
    <View style={styles.section}>
      <T style={styles.sectionTitle}>{title}</T>
      {intro ? <T style={styles.sectionIntro}>{intro}</T> : null}
    </View>
  );
}

function SummaryCard({ labelText, value, style, valueStyle }: { labelText: string; value: string; style?: any; valueStyle?: any }) {
  return (
    <View style={style ? [styles.card, style] : styles.card}>
      <T style={styles.cardLabel}>{labelText}</T>
      <T style={valueStyle ? [styles.cardValue, valueStyle] : styles.cardValue}>{value}</T>
    </View>
  );
}

function IdentityRow({
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  last,
  rightValueStyle,
}: {
  leftLabel: string;
  leftValue: string;
  rightLabel: string;
  rightValue: string;
  last?: boolean;
  rightValueStyle?: any;
}) {
  return (
    <View style={last ? styles.identityRowLast : styles.identityRow} wrap={false}>
      <T style={styles.identityLabel}>{leftLabel}</T>
      <T style={styles.identityValue}>{displayOrNA(leftValue)}</T>
      <T style={styles.identityLabel}>{rightLabel}</T>
      <T style={rightValueStyle ? [styles.identityValueLast, rightValueStyle] : styles.identityValueLast}>{displayOrNA(rightValue)}</T>
    </View>
  );
}

export function StatementWatermark({ model }: { model: AmazonStatementViewModel }) {
  if (model.settlementStatus === "void" || model.candidateStatus === "void") return <T style={styles.voidWatermark}>VOID</T>;
  if (model.candidateStatus === "draft") return <T style={styles.watermark}>DRAFT</T>;
  if (model.candidateStatus === "needs_review") return <T style={styles.watermark}>NEEDS REVIEW</T>;
  return null;
}

export function StatementHeader({ model }: { model: AmazonStatementViewModel }) {
  return (
    <View style={styles.header} fixed>
      <View style={styles.headerLeft}>
        <T style={styles.title}>{primaryStatementTitle(model)}</T>
        <T style={styles.subtitle}>{secondaryStatementTitle(model)}</T>
      </View>
      <View style={styles.headerRight}>
        <T style={styles.companyName}>{model.company.name}</T>
        <T style={styles.companySecondary}>{model.company.secondary ?? "Amazon Relay statement"}</T>
        <T style={styles.statusPill}>{`${label("status", model.language)}: ${model.settlementStatus === "void" ? "VOID" : model.candidateStatus.toUpperCase()}`}</T>
      </View>
    </View>
  );
}

export function IdentityGrid({ model }: { model: AmazonStatementViewModel }) {
  return (
    <View style={styles.identityTable}>
      <IdentityRow leftLabel="Driver / Sofor" leftValue={model.payee.name} rightLabel="Role / Calisma Tipi" rightValue={roleDisplay(model)} />
      <IdentityRow
        leftLabel="Statement Period / Donem"
        leftValue={`${formatDate(model.periodStart)} - ${formatDate(model.periodEnd)}`}
        rightLabel="Invoice Date / Fatura Tarihi"
        rightValue={formatDate(model.invoiceMetadata?.invoiceDate)}
      />
      <IdentityRow
        leftLabel="Payment Date / Odeme Tarihi"
        leftValue={formatDate(model.invoiceMetadata?.paymentDate)}
        rightLabel="Company / Sirket"
        rightValue={model.company.name}
      />
      <IdentityRow
        leftLabel="Truck / Unit"
        leftValue={`Unit ${model.vehicleDisplay}`}
        rightLabel="Invoice / Payment Status"
        rightValue={`${wrapIdentifier(model.invoiceMetadata?.invoiceNumber)}\n${displayOrNA(model.invoiceMetadata?.paymentStatus)}`}
        rightValueStyle={styles.invoiceValue}
        last
      />
    </View>
  );
}

export function SummaryCards({ model }: { model: AmazonStatementViewModel }) {
  const terms = typeTerminology(model.statementType);
  return (
    <View style={styles.cards} wrap={false}>
      <SummaryCard style={styles.grossCard} labelText={`${terms.gross.toUpperCase()}\nTOPLAM BRUT GELIR`} value={formatMoney(model.summary.grossRevenue)} />
      <SummaryCard style={styles.fixedCard} valueStyle={styles.negative} labelText={fixedDeductionCardLabel(model)} value={formatMoney(-Math.abs(model.summary.fixedDeductions))} />
      <SummaryCard style={styles.percentageCard} valueStyle={styles.negative} labelText="COMPANY FEE\nSIRKET KESINTISI" value={formatMoney(-Math.abs(model.summary.percentageDeductions))} />
      <SummaryCard style={styles.fuelCard} valueStyle={styles.negative} labelText="FUEL / DEF\nYAKIT / DEF" value={formatMoney(-Math.abs(model.summary.fuelDeductions))} />
      <SummaryCard style={styles.netCard} valueStyle={model.summary.netAmount < 0 ? styles.negative : styles.positive} labelText={`${terms.net.toUpperCase()}\nODENECEK NET`} value={formatMoney(model.summary.netAmount)} />
    </View>
  );
}

export function CalculationSummary({ model }: { model: AmazonStatementViewModel }) {
  const rows = displayDeductionRows(model);
  return (
    <View style={styles.section} wrap={false}>
      <View style={styles.bandHeader}>
        <T style={[styles.bandHeaderText, { width: "78%" }]}>Calculation / Hesaplama</T>
        <T style={[styles.bandHeaderText, styles.right, { width: "22%" }]}>Amount / Tutar</T>
      </View>
      <View style={styles.summaryRow}>
        <T style={styles.summaryLabel}>{`Amazon Relay gross assigned to ${model.payee.name}`}</T>
        <T style={styles.summaryAmount}>{formatMoney(model.summary.grossRevenue)}</T>
      </View>
      {rows.map((row) => (
        <View key={row.key} style={styles.summaryRow}>
          <T style={styles.summaryLabel}>{row.calculationLabel}</T>
          <T style={[styles.summaryAmount, styles.negative]}>{formatMoney(-Math.abs(row.amount))}</T>
        </View>
      ))}
      <View style={styles.netSummaryRow}>
        <T style={styles.netSummaryLabel}>Net settlement payable / Odenecek net tutar</T>
        <T style={model.summary.netAmount < 0 ? [styles.netSummaryAmount, styles.negative] : styles.netSummaryAmount}>{formatMoney(model.summary.netAmount)}</T>
      </View>
    </View>
  );
}

export function RevenueTable({ model }: { model: AmazonStatementViewModel }) {
  if (model.revenueLines.length === 0) return null;
  const totals = revenueTotals(model.revenueLines);
  return (
    <View>
      <SectionHeading
        title={label("revenueDetails", model.language)}
        intro="Same Trip ID rows are merged into one statement line. Routes show only the first pickup and final delivery city/state."
      />
      <View style={styles.table}>
        <View style={styles.tableHeader} fixed>
          <T style={[styles.th, { width: "9%" }]}>Date</T>
          <T style={[styles.th, { width: "13%" }]}>Trip / Load ID</T>
          <T style={[styles.th, { width: "23%" }]}>Route (City, State)</T>
          <T style={[styles.th, styles.center, { width: "10%" }]}>Status</T>
          <T style={[styles.th, styles.right, { width: "7%" }]}>Miles</T>
          <T style={[styles.th, styles.center, { width: "7%" }]}>Weight</T>
          <T style={[styles.th, styles.right, { width: "8%" }]}>Base</T>
          <T style={[styles.th, styles.right, { width: "8%" }]}>Fuel SC</T>
          <T style={[styles.th, styles.right, { width: "7%" }]}>Tolls</T>
          <T style={[styles.th, styles.right, { width: "8%" }]}>Gross</T>
        </View>
        {model.revenueLines.map((line, index) => (
          <View key={line.id} style={index % 2 ? [styles.tableRow, styles.tableRowAlt] : styles.tableRow} wrap={false}>
            <T style={[styles.td, { width: "9%" }]}>{formatRevenueDate(line)}</T>
            <T style={[styles.td, { width: "13%" }]}>{displayOrNA(line.tripId ?? line.loadId)}</T>
            <T style={[styles.td, { width: "23%" }]}>{routeDisplay(line)}</T>
            <T style={[styles.td, styles.center, { width: "10%" }]}>{line.status ?? "Completed"}</T>
            <T style={[styles.td, styles.right, { width: "7%" }]}>{formatNumber(line.distance, 2)}</T>
            <T style={[styles.td, styles.center, { width: "7%" }]}>{line.weight == null ? "N/A" : String(line.weight)}</T>
            <T style={[styles.td, styles.right, { width: "8%" }]}>{formatMoney(line.baseAmount ?? 0)}</T>
            <T style={[styles.td, styles.right, { width: "8%" }]}>{formatMoney(line.fuelSurchargeAmount ?? 0)}</T>
            <T style={[styles.td, styles.right, { width: "7%" }]}>{formatMoney(line.tollAmount ?? 0)}</T>
            <T style={[styles.tdBold, styles.right, { width: "8%" }]}>{formatMoney(line.grossAmount)}</T>
          </View>
        ))}
        <View style={styles.tableTotalRow} wrap={false}>
          <T style={[styles.tdBold, { width: "9%" }]}>TOTAL</T>
          <T style={[styles.td, { width: "13%" }]}>{`${model.revenueLines.length} lines`}</T>
          <T style={[styles.td, { width: "23%" }]}>Completed loaded miles</T>
          <T style={[styles.td, styles.center, { width: "10%" }]}>Completed</T>
          <T style={[styles.tdBold, styles.right, { width: "7%" }]}>{formatNumber(totals.distance, 2)}</T>
          <T style={[styles.td, styles.center, { width: "7%" }]}>N/A</T>
          <T style={[styles.tdBold, styles.right, { width: "8%" }]}>{formatMoney(totals.base)}</T>
          <T style={[styles.tdBold, styles.right, { width: "8%" }]}>{formatMoney(totals.fuel)}</T>
          <T style={[styles.tdBold, styles.right, { width: "7%" }]}>{formatMoney(totals.tolls)}</T>
          <T style={[styles.tdBold, styles.right, { width: "8%" }]}>{formatMoney(totals.gross)}</T>
        </View>
      </View>
      <T style={styles.sectionIntro}>Source weight data was not included in the Amazon payment file; Weight is shown as N/A. Amazon-paid tolls are included in gross revenue and are not treated as owner deductions.</T>
    </View>
  );
}

export function RevenueMetrics({ model }: { model: AmazonStatementViewModel }) {
  const totals = revenueTotals(model.revenueLines);
  const grossRpm = totals.distance > 0 ? model.summary.grossRevenue / totals.distance : 0;
  const netRpm = totals.distance > 0 ? model.summary.netAmount / totals.distance : 0;
  return (
    <View style={styles.metrics} wrap={false}>
      <T style={styles.metric}>{`Loaded Miles / Yuklu Mil: ${formatNumber(totals.distance, 2)}`}</T>
      <T style={[styles.metric, styles.center]}>{`Gross Avg RPM / Brut Ort. RPM: ${formatMoney(grossRpm)}`}</T>
      <T style={[styles.metric, styles.right]}>{`Net RPM / Net Mil Basi: ${formatMoney(netRpm)}`}</T>
    </View>
  );
}

export function FuelTable({ model }: { model: AmazonStatementViewModel }) {
  if (model.fuelLines.length === 0) return null;
  const totals = fuelTotals(model);
  return (
    <View>
      <SectionHeading title="Expense Details / Masraf Detaylari" intro={`${totals.transactionCount} fuel-card transaction(s) are shown. A receipt may contain separate DEF and ULSD product lines.`} />
      <View style={styles.table}>
        <View style={styles.tableHeader} fixed>
          <T style={[styles.th, { width: "13%" }]}>Date / Time</T>
          <T style={[styles.th, { width: "8%" }]}>Inv</T>
          <T style={[styles.th, { width: "23%" }]}>Merchant</T>
          <T style={[styles.th, { width: "17%" }]}>Location</T>
          <T style={[styles.th, { width: "8%" }]}>Item</T>
          <T style={[styles.th, styles.right, { width: "8%" }]}>Qty</T>
          <T style={[styles.th, styles.right, { width: "8%" }]}>Avg PPU</T>
          <T style={[styles.th, styles.right, { width: "7%" }]}>Disc.</T>
          <T style={[styles.th, styles.right, { width: "8%" }]}>Amount</T>
        </View>
        {model.fuelLines.map((line, index) => (
          <View key={line.id} style={index % 2 ? [styles.tableRow, styles.tableRowAlt] : styles.tableRow} wrap={false}>
            <T style={[styles.td, { width: "13%" }]}>{line.continuation ? "" : formatDateTime(line.date)}</T>
            <T style={[styles.td, { width: "8%" }]}>{line.continuation ? "" : displayOrNA(line.invoice)}</T>
            <T style={[styles.td, { width: "23%" }]}>{line.continuation ? "" : displayOrNA(line.merchant)}</T>
            <T style={[styles.td, { width: "17%" }]}>{line.continuation ? "" : displayOrNA(line.location)}</T>
            <T style={[styles.td, { width: "8%" }]}>{line.product}</T>
            <T style={[styles.td, styles.right, { width: "8%" }]}>{formatNumber(line.quantity, 2)}</T>
            <T style={[styles.td, styles.right, { width: "8%" }]}>{line.chargedPpu == null ? "N/A" : formatMoney(line.chargedPpu)}</T>
            <T style={[styles.td, styles.right, { width: "7%" }]}>{line.discountAmount == null ? "$0.00" : formatMoney(line.discountAmount)}</T>
            <T style={line.amount < 0 ? [styles.tdBold, styles.right, styles.negative, { width: "8%" }] : [styles.tdBold, styles.right, { width: "8%" }]}>{formatMoney(line.amount)}</T>
          </View>
        ))}
        <View style={styles.tableTotalRow} wrap={false}>
          <T style={[styles.tdBold, { width: "13%" }]}>TOTAL</T>
          <T style={[styles.td, { width: "8%" }]}>{`${totals.transactionCount} txns`}</T>
          <T style={[styles.td, { width: "23%" }]}>Fuel and DEF detail total</T>
          <T style={[styles.td, { width: "17%" }]} />
          <T style={[styles.td, { width: "8%" }]} />
          <T style={[styles.tdBold, styles.right, { width: "8%" }]}>{formatNumber(totals.quantity, 2)}</T>
          <T style={[styles.td, { width: "8%" }]} />
          <T style={[styles.tdBold, styles.right, { width: "7%" }]}>{formatMoney(totals.discount)}</T>
          <T style={[styles.tdBold, styles.right, { width: "8%" }]}>{formatMoney(totals.amount)}</T>
        </View>
      </View>
      <FuelSummary model={model} />
    </View>
  );
}

export function FuelSummary({ model }: { model: AmazonStatementViewModel }) {
  const groups = fuelProductGroups(model);
  const overall = fuelTotals(model);
  const summary = groups
    .map((group) => `${group.product} ${formatMoney(group.amount)} (${formatNumber(group.quantity, 2)} gal, avg ${formatMoney(group.averagePpu)})`)
    .join(" | ");
  return (
    <View style={styles.fuelSummary} wrap={false}>
      <T style={styles.fuelSummaryText}>{`Fuel summary / Yakit ozeti: ${summary} | Total ${formatMoney(overall.amount)} / ${formatNumber(overall.quantity, 2)} gal`}</T>
    </View>
  );
}

export function DeductionSummary({ model }: { model: AmazonStatementViewModel }) {
  const rows = displayDeductionRows(model);
  return (
    <View>
      <SectionHeading title="Deductions / Kesintiler" intro="Deductions are applied from the saved candidate calculation. Percentage fees are calculated from gross revenue." />
      <View style={styles.table}>
        <View style={styles.tableHeader}>
          <T style={[styles.th, styles.center, { width: "8%" }]}>Order</T>
          <T style={[styles.th, { width: "34%" }]}>Deduction Item / Kesinti Kalemi</T>
          <T style={[styles.th, { width: "43%" }]}>Calculation / Hesap</T>
          <T style={[styles.th, styles.right, { width: "15%" }]}>Amount / Tutar</T>
        </View>
        {rows.map((row, index) => (
          <View key={row.key} style={index % 2 ? [styles.tableRow, styles.tableRowAlt] : styles.tableRow} wrap={false}>
            <T style={[styles.td, styles.center, { width: "8%" }]}>{String(index + 1)}</T>
            <T style={[styles.td, { width: "34%" }]}>{row.label}</T>
            <T style={[styles.td, { width: "43%" }]}>{row.basis}</T>
            <T style={[styles.tdBold, styles.right, styles.negative, { width: "15%" }]}>{formatMoney(-Math.abs(row.amount))}</T>
          </View>
        ))}
        <View style={styles.tableTotalRow} wrap={false}>
          <T style={[styles.td, { width: "8%" }]} />
          <T style={[styles.tdBold, { width: "77%" }]}>TOTAL DEDUCTIONS / TOPLAM KESINTI</T>
          <T style={[styles.tdBold, styles.right, styles.negative, { width: "15%" }]}>{formatMoney(-Math.abs(model.summary.totalDeductions))}</T>
        </View>
      </View>
    </View>
  );
}

export function FinalSettlementSummary({ model }: { model: AmazonStatementViewModel }) {
  const rows = displayDeductionRows(model);
  return (
    <View>
      <SectionHeading title="Final Settlement Summary / Son Odeme Ozeti" />
      <View style={styles.table}>
        <View style={styles.tableHeader}>
          <T style={[styles.th, { width: "82%" }]}>Description / Aciklama</T>
          <T style={[styles.th, styles.right, { width: "18%" }]}>Amount / Tutar</T>
        </View>
        <View style={styles.tableRow}>
          <T style={[styles.td, { width: "82%" }]}>Gross Revenue / Brut Gelir</T>
          <T style={[styles.tdBold, styles.right, { width: "18%" }]}>{formatMoney(model.summary.grossRevenue)}</T>
        </View>
        {rows.map((row, index) => (
          <View key={row.key} style={index % 2 ? [styles.tableRow, styles.tableRowAlt] : styles.tableRow}>
            <T style={[styles.td, { width: "82%" }]}>{row.label}</T>
            <T style={[styles.tdBold, styles.right, styles.negative, { width: "18%" }]}>{formatMoney(-Math.abs(row.amount))}</T>
          </View>
        ))}
        <View style={styles.netSummaryRow}>
          <T style={styles.netSummaryLabel}>{`NET PAYABLE TO ${model.payee.name.toUpperCase()} / ODENECEK NET`}</T>
          <T style={model.summary.netAmount < 0 ? [styles.netSummaryAmount, styles.negative] : styles.netSummaryAmount}>{formatMoney(model.summary.netAmount)}</T>
        </View>
      </View>
    </View>
  );
}

export function TeamAllocation({ model }: { model: AmazonStatementViewModel }) {
  if (model.teamAllocations.length === 0) return null;
  return (
    <View>
      <SectionHeading title={label("teamAllocation", model.language)} />
      <View style={styles.table}>
        {model.teamAllocations.map((line, index) => (
          <View key={line.id} style={index % 2 ? [styles.tableRow, styles.tableRowAlt] : styles.tableRow}>
            <T style={[styles.td, { width: "75%" }]}>{`${line.memberName} (${(line.basisPoints / 100).toFixed(2)}%)`}</T>
            <T style={[styles.tdBold, styles.right, { width: "25%" }]}>{formatMoney(line.amount)}</T>
          </View>
        ))}
      </View>
    </View>
  );
}

export function StatementNotes({ model }: { model: AmazonStatementViewModel }) {
  const notes = [...model.calculationNotes, ...model.reconciliationIndicators];
  if (notes.length === 0) return null;
  return (
    <View>
      <SectionHeading title="Statement Notes / Statement Notlari" />
      <View style={styles.notesBox}>
        {notes.map((note, index) => <T key={index} style={styles.noteLine}>{`- ${note}`}</T>)}
      </View>
    </View>
  );
}

export function SignaturePanels({ model }: { model: AmazonStatementViewModel }) {
  return (
    <View>
      <View style={styles.signaturePanel} wrap={false}>
        <View style={styles.signaturePanelHeader}>
          <T style={styles.signaturePanelHeaderText}>COMPANY SIGNATURE / SIRKET IMZASI</T>
        </View>
        <T style={styles.signatureIntro}>{`This settlement statement is approved and authorized by ${model.company.name} when signed. / Bu odeme dokumu imzalandiginda ${model.company.name} tarafindan onaylanmis olur.`}</T>
        <SignatureField labelText="Authorized By / Yetkili" value={model.companySignature.printedName ?? model.company.name} />
        <SignatureField labelText="Title / Unvan" value={model.companySignature.title ?? "Authorized Representative"} />
        <SignatureField labelText="Signature / Imza" signature />
        <SignatureField labelText="Date / Tarih" value={formatDate(model.companySignature.approvalDate)} last />
      </View>

      <View style={styles.signaturePanel} wrap={false}>
        <View style={styles.signaturePanelHeader}>
          <T style={styles.signaturePanelHeaderText}>OWNER OPERATOR APPROVAL / OWNER ONAYI</T>
        </View>
        <SignatureField labelText="Name / Isim" value={model.payeeSignature.printedName ?? model.payee.name} />
        <SignatureField labelText="Signature / Imza" signature />
        <SignatureField labelText="Date / Tarih" value={formatDate(model.payeeSignature.approvalDate)} last />
      </View>
    </View>
  );
}

export function NotesAndSignatures({ model }: { model: AmazonStatementViewModel }) {
  return (
    <View>
      <StatementNotes model={model} />
      <SignaturePanels model={model} />
    </View>
  );
}

function SignatureField({ labelText, value = "", signature, last }: { labelText: string; value?: string; signature?: boolean; last?: boolean }) {
  return (
    <View style={last ? styles.signatureFieldRowLast : styles.signatureFieldRow}>
      <T style={styles.signatureFieldLabel}>{labelText}</T>
      <View style={styles.signatureFieldValue}>
        {signature ? <View style={styles.signatureLine} /> : <T>{displayOrNA(value)}</T>}
      </View>
    </View>
  );
}

export function StatementFooter({ model }: { model: AmazonStatementViewModel }) {
  return (
    <View style={styles.footer} fixed>
      <T style={styles.footerLeft}>{`Prepared from Amazon Relay invoice data | ${model.documentId} | ${model.footer.templateVersion}`}</T>
      <Text style={styles.footerRight} render={({ pageNumber, totalPages }) => `${footerPageLabel(model.language)} ${pageNumber} / ${totalPages}`} />
    </View>
  );
}

interface DisplayDeductionRow {
  key: string;
  label: string;
  amount: number;
  basis: string;
  calculationLabel: string;
  order: number;
}

function displayDeductionRows(model: AmazonStatementViewModel): DisplayDeductionRow[] {
  const rows = model.deductionLines
    .filter((line) => !isFuelDeduction(line))
    .map((line) => ({
      key: line.id,
      label: line.label,
      amount: Math.abs(line.amount),
      basis: deductionBasis(line, model),
      calculationLabel: calculationLabel(line, model),
      order: deductionOrder(line),
    }));
  if (Math.abs(model.summary.fuelDeductions) > 0.004) {
    rows.push({
      key: "fuel-and-def-total",
      label: "Fuel + DEF / Yakit + DEF",
      amount: Math.abs(model.summary.fuelDeductions),
      basis: "Selected fuel-card product-line total / Secili yakit karti satirlari",
      calculationLabel: "Fuel and DEF card deduction / Yakit ve DEF karti kesintisi",
      order: 40,
    });
  }
  return rows.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

function isFuelDeduction(line: AmazonStatementDeductionLine): boolean {
  return /fuel|def/i.test(`${line.type} ${line.label}`);
}

function deductionOrder(line: AmazonStatementDeductionLine): number {
  const value = `${line.type} ${line.label}`;
  if (/insurance/i.test(value)) return 10;
  if (/eld|safety|ifta/i.test(value)) return 20;
  if (/company fee|percentage/i.test(value)) return 30;
  return 35;
}

function deductionBasis(line: AmazonStatementDeductionLine, model: AmazonStatementViewModel): string {
  const value = `${line.type} ${line.label}`;
  if (/company fee|percentage/i.test(value)) {
    const percentage = line.label.match(/(\d+(?:\.\d+)?)\s*%/)?.[1];
    return percentage ? `${percentage}% x ${formatMoney(model.summary.grossRevenue)}` : "Percentage of gross revenue";
  }
  if (/insurance/i.test(value)) return "Fixed insurance deduction / Sabit sigorta kesintisi";
  if (/eld|safety|ifta/i.test(value)) return "Fixed weekly deduction / Sabit haftalik kesinti";
  return "Saved candidate calculation / Kayitli hesaplama";
}

function calculationLabel(line: AmazonStatementDeductionLine, model: AmazonStatementViewModel): string {
  if (/company fee|percentage/i.test(`${line.type} ${line.label}`)) return `${line.label}: ${deductionBasis(line, model)}`;
  return line.label;
}

function revenueTotals(lines: AmazonStatementRevenueLine[]) {
  return lines.reduce((total, line) => ({
    distance: total.distance + Number(line.distance ?? 0),
    base: total.base + Number(line.baseAmount ?? 0),
    fuel: total.fuel + Number(line.fuelSurchargeAmount ?? 0),
    tolls: total.tolls + Number(line.tollAmount ?? 0),
    gross: total.gross + Number(line.grossAmount ?? 0),
  }), { distance: 0, base: 0, fuel: 0, tolls: 0, gross: 0 });
}

function fuelTotals(model: AmazonStatementViewModel) {
  const transactionKeys = new Set<string>();
  let quantity = 0;
  let discount = 0;
  let amount = 0;
  for (const line of model.fuelLines) {
    transactionKeys.add([line.date ?? "", line.invoice ?? "", line.merchant ?? "", line.location ?? ""].join("|"));
    quantity += Number(line.quantity ?? 0);
    discount += Number(line.discountAmount ?? 0);
    amount += Number(line.amount ?? 0);
  }
  return { transactionCount: transactionKeys.size, quantity, discount, amount };
}

function fuelProductGroups(model: AmazonStatementViewModel) {
  const groups = new Map<string, { product: string; quantity: number; amount: number; ppuWeighted: number }>();
  for (const line of model.fuelLines) {
    const product = line.product.toUpperCase();
    const current = groups.get(product) ?? { product, quantity: 0, amount: 0, ppuWeighted: 0 };
    const quantity = Number(line.quantity ?? 0);
    current.quantity += quantity;
    current.amount += Number(line.amount ?? 0);
    current.ppuWeighted += Number(line.chargedPpu ?? 0) * quantity;
    groups.set(product, current);
  }
  return [...groups.values()].map((group) => ({ ...group, averagePpu: group.quantity > 0 ? group.ppuWeighted / group.quantity : 0 }));
}

function formatRevenueDate(line: AmazonStatementRevenueLine): string {
  const start = line.startDate ?? line.date ?? null;
  const end = line.endDate ?? line.date ?? null;
  if (start && end && start !== end) return `${shortDate(start)} - ${shortDate(end)}`;
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

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "N/A";
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|\s)(\d{2}):(\d{2})/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]} ${iso[4]}:${iso[5]}`;
  return formatDate(value);
}

function wrapIdentifier(value: string | null | undefined): string {
  const raw = displayOrNA(value);
  if (raw === "N/A" || raw.length <= 22) return raw;
  return raw.match(/.{1,18}/g)?.join(" ") ?? raw;
}

function primaryStatementTitle(model: AmazonStatementViewModel): string {
  const base = statementTitle(model.statementType, "en").replace(/\s+Statement$/i, "");
  return `${base.toUpperCase()} SETTLEMENT STATEMENT`;
}

function secondaryStatementTitle(model: AmazonStatementViewModel): string {
  if (model.language === "en") return "Amazon Relay payment statement";
  if (model.language === "tr") return `${statementTitle(model.statementType, "tr")} - Odeme Dokumu`;
  return `${statementTitle(model.statementType, "tr")} - English / Turkce`;
}

function fixedDeductionCardLabel(model: AmazonStatementViewModel): string {
  const values = model.deductionLines.filter((line) => !isFuelDeduction(line)).map((line) => `${line.type} ${line.label}`).join(" ");
  return /insurance/i.test(values) && /eld|safety|ifta/i.test(values)
    ? "INSURANCE + ELD/SAFETY\nSIGORTA + ELD/GUVENLIK"
    : "FIXED DEDUCTIONS\nSABIT KESINTILER";
}

function routeDisplay(line: AmazonStatementRevenueLine): string {
  if (line.routeDisplay) return line.routeDisplay;
  return line.routeStatus === "pending_review" ? "Pending Review" : "N/A";
}

function roleDisplay(model: AmazonStatementViewModel): string {
  if (model.statementType === "owner_operator") return "Owner Operator";
  if (model.statementType === "managed_investor") return "Owner / Investor";
  if (model.statementType === "box_truck_driver") return "Box Truck Driver";
  return "Company Driver";
}

function footerPageLabel(mode: AmazonStatementLanguageMode): string {
  return mode === "tr" ? "Sayfa" : mode === "en_tr" ? "Page / Sayfa" : "Page";
}
