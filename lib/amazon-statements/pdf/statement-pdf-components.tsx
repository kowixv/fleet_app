import { Text, View, StyleSheet } from "@react-pdf/renderer";
import React from "react";
import { label, statementTitle, typeTerminology } from "./statement-labels";
import { displayOrNA, formatDate, formatMoney, formatNumber, pdfSafeText } from "./statement-formatting";
import type { AmazonStatementViewModel, AmazonStatementLanguageMode } from "./statement-view-model";

const colors = {
  navy: "#0b1f3a",
  navy2: "#16365f",
  ink: "#172033",
  muted: "#667085",
  line: "#d9e2ef",
  band: "#f3f6fa",
  pale: "#eef4ff",
  danger: "#b42318",
  dangerBg: "#fff1f0",
  green: "#0f766e",
};

export const styles = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 42, paddingHorizontal: 34, fontFamily: "Helvetica", fontSize: 8.5, color: colors.ink },
  header: { borderBottomWidth: 2, borderBottomColor: colors.navy, paddingBottom: 10, marginBottom: 12 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 15, color: colors.navy },
  subtitle: { marginTop: 3, color: colors.muted, fontSize: 8 },
  statusPill: { marginTop: 6, alignSelf: "flex-start", paddingVertical: 3, paddingHorizontal: 7, backgroundColor: colors.band, color: colors.navy, fontFamily: "Helvetica-Bold", fontSize: 7 },
  watermark: { position: "absolute", top: 300, left: 50, right: 50, textAlign: "center", color: "#d0d7e2", fontSize: 58, fontFamily: "Helvetica-Bold", opacity: 0.28, transform: "rotate(-30deg)" },
  voidWatermark: { position: "absolute", top: 285, left: 30, right: 30, textAlign: "center", color: "#f04438", fontSize: 72, fontFamily: "Helvetica-Bold", opacity: 0.22, transform: "rotate(-32deg)" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 8 },
  infoCell: { width: "25%", paddingRight: 8, paddingBottom: 7 },
  infoLabel: { color: colors.muted, fontSize: 7 },
  infoValue: { marginTop: 1, fontFamily: "Helvetica-Bold", fontSize: 8.5 },
  cards: { flexDirection: "row", gap: 8, marginTop: 4, marginBottom: 10 },
  card: { flexGrow: 1, width: "25%", padding: 8, backgroundColor: colors.pale, borderWidth: 1, borderColor: colors.line },
  cardLabel: { color: colors.muted, fontSize: 7, marginBottom: 5 },
  cardValue: { fontFamily: "Helvetica-Bold", fontSize: 13, color: colors.navy },
  negative: { color: colors.danger },
  section: { marginTop: 10 },
  sectionHeader: { backgroundColor: colors.navy, color: "#ffffff", paddingVertical: 4, paddingHorizontal: 6, fontFamily: "Helvetica-Bold", fontSize: 9 },
  summaryLine: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 4, paddingHorizontal: 5 },
  summaryLabel: { width: "72%", color: colors.ink },
  summaryAmount: { width: "28%", textAlign: "right", fontFamily: "Helvetica-Bold" },
  netBox: { marginTop: 8, flexDirection: "row", backgroundColor: colors.navy, color: "#ffffff", paddingVertical: 8, paddingHorizontal: 8 },
  netLabel: { width: "70%", color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 11 },
  netAmount: { width: "30%", color: "#ffffff", textAlign: "right", fontFamily: "Helvetica-Bold", fontSize: 12 },
  table: { width: "100%" },
  tableHeader: { flexDirection: "row", backgroundColor: colors.band, borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 4, paddingHorizontal: 4 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 4, paddingHorizontal: 4, minHeight: 18 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 6.2, lineHeight: 1.08, color: colors.navy },
  td: { fontSize: 7 },
  right: { textAlign: "right" },
  notes: { marginTop: 6, padding: 7, backgroundColor: colors.band, color: colors.muted, lineHeight: 1.25 },
  signatureRow: { flexDirection: "row", gap: 24, marginTop: 20 },
  signatureBox: { flexGrow: 1, width: "50%", borderTopWidth: 1, borderTopColor: colors.ink, paddingTop: 5, minHeight: 28 },
  footer: { position: "absolute", left: 34, right: 34, bottom: 22, flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 5, color: colors.muted, fontSize: 7 },
  footerLeft: { width: "70%" },
  footerRight: { width: "30%", textAlign: "right" },
});

function T({ children, style }: { children: string; style?: any }) {
  return <Text style={style}>{pdfSafeText(children)}</Text>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <T style={styles.sectionHeader}>{title}</T>
      <View>{children}</View>
    </View>
  );
}

function Info({ labelText, value }: { labelText: string; value: string }) {
  return (
    <View style={styles.infoCell}>
      <T style={styles.infoLabel}>{labelText}</T>
      <T style={styles.infoValue}>{displayOrNA(value)}</T>
    </View>
  );
}

function Card({ labelText, value, negative }: { labelText: string; value: string; negative?: boolean }) {
  return (
    <View style={styles.card}>
      <T style={styles.cardLabel}>{labelText}</T>
      <T style={[styles.cardValue, negative ? styles.negative : undefined]}>{value}</T>
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
      <T style={styles.title}>{statementTitle(model.statementType, model.language)}</T>
      <T style={styles.subtitle}>{`${model.company.name} - ${model.documentId}`}</T>
      <T style={styles.statusPill}>{`${label("status", model.language)}: ${model.settlementStatus === "void" ? "VOID" : model.candidateStatus.toUpperCase()}`}</T>
    </View>
  );
}

export function IdentityGrid({ model }: { model: AmazonStatementViewModel }) {
  return (
    <View style={styles.grid}>
      <Info labelText="Company" value={model.company.name} />
      <Info labelText={label("payee", model.language)} value={model.payee.name} />
      <Info labelText={label("vehicle", model.language)} value={model.vehicleDisplay} />
      <Info labelText={label("statementPeriod", model.language)} value={`${formatDate(model.periodStart)} - ${formatDate(model.periodEnd)}`} />
      <Info labelText={label("invoice", model.language)} value={model.invoiceMetadata?.invoiceNumber ?? "N/A"} />
      <Info labelText="Invoice Date" value={formatDate(model.invoiceMetadata?.invoiceDate)} />
      <Info labelText={label("payment", model.language)} value={formatDate(model.invoiceMetadata?.paymentDate)} />
      <Info labelText={label("template", model.language)} value={model.templateVersion} />
    </View>
  );
}

export function SummaryCards({ model }: { model: AmazonStatementViewModel }) {
  const terms = typeTerminology(model.statementType);
  return (
    <View style={styles.cards}>
      <Card labelText={terms.gross} value={formatMoney(model.summary.grossRevenue)} />
      <Card labelText={terms.deductions} value={formatMoney(model.summary.totalDeductions)} />
      <Card labelText={terms.net} value={formatMoney(model.summary.netAmount)} negative={model.summary.netAmount < 0} />
      <Card labelText="Fuel" value={formatMoney(model.summary.fuelDeductions)} />
    </View>
  );
}

export function CalculationSummary({ model }: { model: AmazonStatementViewModel }) {
  return (
    <Section title={label("calculationSummary", model.language)}>
      {model.deductionLines.map((line) => (
        <View key={line.id} style={styles.summaryLine}>
          <T style={styles.summaryLabel}>{line.explicitZero ? `${line.label} (0 override)` : line.label}</T>
          <T style={[styles.summaryAmount, line.amount < 0 ? styles.negative : undefined]}>{formatMoney(line.amount)}</T>
        </View>
      ))}
      <View style={styles.netBox}>
        <T style={styles.netLabel}>{label("netSettlement", model.language)}</T>
        <T style={styles.netAmount}>{formatMoney(model.summary.netAmount)}</T>
      </View>
    </Section>
  );
}

export function RevenueTable({ model }: { model: AmazonStatementViewModel }) {
  if (model.revenueLines.length === 0) return null;
  return (
    <Section title={label("revenueDetails", model.language)}>
      <View style={styles.tableHeader} fixed>
        <T style={[styles.th, { width: "12%" }]}>Date</T>
        <T style={[styles.th, { width: "14%" }]}>Trip/Load</T>
        <T style={[styles.th, { width: "25%" }]}>{label("route", model.language)}</T>
        <T style={[styles.th, styles.right, { width: "10%" }]}>{label("distance", model.language)}</T>
        <T style={[styles.th, styles.right, { width: "10%" }]}>Base</T>
        <T style={[styles.th, styles.right, { width: "10%" }]}>Fuel</T>
        <T style={[styles.th, styles.right, { width: "9%" }]}>Tolls</T>
        <T style={[styles.th, styles.right, { width: "10%" }]}>Gross</T>
      </View>
      {model.revenueLines.map((line) => (
        <View key={line.id} style={styles.tableRow} wrap={false}>
          <T style={[styles.td, { width: "12%" }]}>{formatDate(line.date)}</T>
          <T style={[styles.td, { width: "14%" }]}>{displayOrNA(line.tripId ?? line.loadId)}</T>
          <T style={[styles.td, { width: "25%" }]}>{line.routeStatus === "verified" ? displayOrNA(line.routeDisplay) : "Pending Review"}</T>
          <T style={[styles.td, styles.right, { width: "10%" }]}>{formatNumber(line.distance, 0)}</T>
          <T style={[styles.td, styles.right, { width: "10%" }]}>{formatMoney(line.baseAmount ?? 0)}</T>
          <T style={[styles.td, styles.right, { width: "10%" }]}>{formatMoney(line.fuelSurchargeAmount ?? 0)}</T>
          <T style={[styles.td, styles.right, { width: "9%" }]}>{formatMoney(line.tollAmount ?? 0)}</T>
          <T style={[styles.td, styles.right, { width: "10%" }]}>{formatMoney(line.grossAmount)}</T>
        </View>
      ))}
    </Section>
  );
}

export function FuelTable({ model }: { model: AmazonStatementViewModel }) {
  if (model.fuelLines.length === 0) return null;
  return (
    <Section title={label("fuelDetails", model.language)}>
      <View style={styles.tableHeader} fixed>
        <T style={[styles.th, { width: "10%" }]}>{label("date", model.language)}</T>
        <T style={[styles.th, { width: "12%" }]}>{label("invoice", model.language)}</T>
        <T style={[styles.th, { width: "18%" }]}>{label("merchant", model.language)}</T>
        <T style={[styles.th, { width: "15%" }]}>{label("location", model.language)}</T>
        <T style={[styles.th, { width: "9%" }]}>{label("product", model.language)}</T>
        <T style={[styles.th, styles.right, { width: "9%" }]}>{label("quantity", model.language)}</T>
        <T style={[styles.th, styles.right, { width: "9%" }]}>PPU</T>
        <T style={[styles.th, styles.right, { width: "9%" }]}>{label("discount", model.language)}</T>
        <T style={[styles.th, styles.right, { width: "9%" }]}>{label("amount", model.language)}</T>
      </View>
      {model.fuelLines.map((line) => (
        <View key={line.id} style={styles.tableRow} wrap={false}>
          <T style={[styles.td, { width: "10%" }]}>{line.continuation ? "" : formatDate(line.date)}</T>
          <T style={[styles.td, { width: "12%" }]}>{line.continuation ? "" : displayOrNA(line.invoice)}</T>
          <T style={[styles.td, { width: "18%" }]}>{line.continuation ? "" : displayOrNA(line.merchant)}</T>
          <T style={[styles.td, { width: "15%" }]}>{line.continuation ? "" : displayOrNA(line.location)}</T>
          <T style={[styles.td, { width: "9%" }]}>{line.product}</T>
          <T style={[styles.td, styles.right, { width: "9%" }]}>{formatNumber(line.quantity, 3)}</T>
          <T style={[styles.td, styles.right, { width: "9%" }]}>{line.chargedPpu == null ? "N/A" : formatMoney(line.chargedPpu)}</T>
          <T style={[styles.td, styles.right, { width: "9%" }]}>{line.discountAmount == null ? "N/A" : formatMoney(line.discountAmount)}</T>
          <T style={[styles.td, styles.right, line.amount < 0 ? styles.negative : undefined, { width: "9%" }]}>{formatMoney(line.amount)}</T>
        </View>
      ))}
    </Section>
  );
}

export function TeamAllocation({ model }: { model: AmazonStatementViewModel }) {
  if (model.teamAllocations.length === 0) return null;
  return (
    <Section title={label("teamAllocation", model.language)}>
      {model.teamAllocations.map((line) => (
        <View key={line.id} style={styles.summaryLine}>
          <T style={styles.summaryLabel}>{`${line.memberName} (${(line.basisPoints / 100).toFixed(2)}%)`}</T>
          <T style={styles.summaryAmount}>{formatMoney(line.amount)}</T>
        </View>
      ))}
    </Section>
  );
}

export function NotesAndSignatures({ model }: { model: AmazonStatementViewModel }) {
  const notes = [...model.calculationNotes, ...model.reconciliationIndicators];
  return (
    <View wrap={false}>
      {notes.length > 0 ? (
        <Section title={label("notes", model.language)}>
          <View style={styles.notes}>
            {notes.map((note, index) => <T key={index}>{`- ${note}`}</T>)}
          </View>
        </Section>
      ) : null}
      <View style={styles.signatureRow} wrap={false}>
        <View style={styles.signatureBox}>
          <T style={styles.infoValue}>{model.companySignature.printedName ?? "Pending"}</T>
          <T style={styles.infoLabel}>{label("companyAuthorization", model.language)}</T>
        </View>
        <View style={styles.signatureBox}>
          <T style={styles.infoValue}>{model.payeeSignature.printedName ?? "Pending"}</T>
          <T style={styles.infoLabel}>{label("payeeApproval", model.language)}</T>
        </View>
      </View>
    </View>
  );
}

export function StatementFooter({ model }: { model: AmazonStatementViewModel }) {
  return (
    <View style={styles.footer} fixed>
      <T style={styles.footerLeft}>{`${model.documentId} | ${label("template", model.language)}: ${model.footer.templateVersion} | Generated: ${model.generatedAt}`}</T>
      <Text style={styles.footerRight} render={({ pageNumber, totalPages }) => `${footerPageLabel(model.language)} ${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function footerPageLabel(mode: AmazonStatementLanguageMode): string {
  return mode === "tr" ? "Sayfa" : mode === "en_tr" ? "Page / Sayfa" : "Page";
}
