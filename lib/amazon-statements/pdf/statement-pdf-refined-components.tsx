import { StyleSheet, Text, View } from "@react-pdf/renderer";
import React from "react";
import { typeTerminology } from "./statement-labels";
import { displayOrNA, formatDate, formatMoney, formatNumber, pdfSafeText } from "./statement-formatting";
import { styles } from "./statement-pdf-components";
import {
  deductionDisplayOrder,
  fuelTransactionKey,
  groupFuelLinesForDisplay,
  normalizeDeductionLabel,
  percentageCardLabels,
} from "./statement-pdf-refinement-helpers";
import type {
  AmazonStatementDeductionLine,
  AmazonStatementFuelLine,
  AmazonStatementRevenueLine,
  AmazonStatementViewModel,
} from "./statement-view-model";

const colors = {
  navy: "#173f5f",
  blueText: "#163a59",
  line: "#b9c9d6",
  paleBlue: "#eaf3f8",
  paleBlue2: "#f3f8fb",
  paleGreen: "#e9f6ec",
  white: "#ffffff",
  danger: "#a83b2f",
  green: "#137a55",
  ink: "#273444",
  muted: "#667085",
};

const refinedStyles = StyleSheet.create({
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
  headerLeft: { width: "73%", paddingRight: 8 },
  headerRight: { width: "27%", alignItems: "flex-start", paddingLeft: 8 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 15.5, lineHeight: 1.05, color: colors.white, letterSpacing: 0.2 },
  subtitle: { marginTop: 6, color: "#d9e9f2", fontSize: 8 },
  companyName: { fontFamily: "Helvetica-Bold", fontSize: 10.5, color: colors.white },
  companySecondary: { marginTop: 5, color: "#d9e9f2", fontSize: 7.2 },
  statusPill: {
    marginTop: 8,
    paddingVertical: 3,
    paddingHorizontal: 7,
    backgroundColor: colors.white,
    color: colors.navy,
    fontFamily: "Helvetica-Bold",
    fontSize: 6.4,
  },
  identityTable: { borderWidth: 1, borderColor: colors.line, marginBottom: 8 },
  identityRow: { flexDirection: "row", minHeight: 24, borderBottomWidth: 1, borderBottomColor: colors.line },
  identityRowLast: { flexDirection: "row", minHeight: 31 },
  identityLabel: {
    width: "18%",
    paddingVertical: 5,
    paddingHorizontal: 5,
    backgroundColor: colors.paleBlue,
    fontFamily: "Helvetica-Bold",
    fontSize: 6.45,
    lineHeight: 1.08,
    color: colors.blueText,
    borderRightWidth: 1,
    borderRightColor: colors.line,
  },
  identityValue: {
    width: "32%",
    paddingVertical: 5,
    paddingHorizontal: 7,
    fontSize: 7.2,
    borderRightWidth: 1,
    borderRightColor: colors.line,
  },
  identityValueLast: { width: "32%", paddingVertical: 5, paddingHorizontal: 7, fontSize: 7.2 },
  invoiceLine: { fontSize: 5.75, lineHeight: 1.08 },
  invoiceStatus: { marginTop: 2, fontFamily: "Helvetica-Bold", fontSize: 6.1, color: colors.blueText },
  summaryCard: { minHeight: 60, paddingVertical: 7, paddingHorizontal: 4 },
  summaryLabelBox: { minHeight: 25, justifyContent: "center" },
  summaryLabelEn: { textAlign: "center", color: colors.blueText, fontSize: 6.25, lineHeight: 1.05 },
  summaryLabelTr: { marginTop: 2, textAlign: "center", color: colors.blueText, fontSize: 5.7, lineHeight: 1.05 },
  summaryValue: { marginTop: 4, textAlign: "center", fontFamily: "Helvetica-Bold", fontSize: 13.1 },
  compactSection: { marginTop: 7 },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 14, color: colors.navy, marginBottom: 3 },
  sectionIntro: { color: colors.muted, fontSize: 6.5, lineHeight: 1.15, marginBottom: 4 },
  transactionStart: { borderTopWidth: 1, borderTopColor: colors.navy },
  fuelSummaryGrid: { flexDirection: "row", marginTop: 5, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paleBlue2 },
  fuelSummaryCell: { paddingVertical: 5, paddingHorizontal: 6, borderRightWidth: 1, borderRightColor: colors.line },
  fuelSummaryCellLast: { paddingVertical: 5, paddingHorizontal: 6 },
  fuelSummaryTitle: { fontFamily: "Helvetica-Bold", color: colors.blueText, fontSize: 6.5 },
  fuelSummaryAmount: { marginTop: 2, fontFamily: "Helvetica-Bold", fontSize: 8.2, color: colors.ink },
  fuelSummaryDetail: { marginTop: 2, fontSize: 5.9, color: colors.muted },
  netBanner: {
    marginTop: 8,
    flexDirection: "row",
    backgroundColor: colors.paleGreen,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 7,
    paddingHorizontal: 7,
  },
  netBannerLabel: { width: "78%", fontFamily: "Helvetica-Bold", fontSize: 8.3, color: colors.ink },
  netBannerAmount: { width: "22%", textAlign: "right", fontFamily: "Helvetica-Bold", fontSize: 10.2, color: colors.green },
});

function T({ children = "", style }: { children?: string; style?: any }) {
  return <Text style={style}>{pdfSafeText(children)}</Text>;
}

function SectionHeading({ title, intro }: { title: string; intro?: string }) {
  return (
    <View style={refinedStyles.compactSection}>
      <T style={refinedStyles.sectionTitle}>{title}</T>
      {intro ? <T style={refinedStyles.sectionIntro}>{intro}</T> : null}
    </View>
  );
}

export function RefinedStatementHeader({ model }: { model: AmazonStatementViewModel }) {
  return (
    <View style={refinedStyles.header} fixed>
      <View style={refinedStyles.headerLeft}>
        <T style={refinedStyles.title}>{headerTitle(model)}</T>
        <T style={refinedStyles.subtitle}>{headerSubtitle(model)}</T>
      </View>
      <View style={refinedStyles.headerRight}>
        <T style={refinedStyles.companyName}>{model.company.name}</T>
        <T style={refinedStyles.companySecondary}>{model.company.secondary ?? "Amazon Relay statement"}</T>
        <T style={refinedStyles.statusPill}>{`Status / Durum: ${model.settlementStatus === "void" ? "VOID" : model.candidateStatus.toUpperCase()}`}</T>
      </View>
    </View>
  );
}

export function RefinedIdentityGrid({ model }: { model: AmazonStatementViewModel }) {
  const invoiceChunks = splitIdentifier(model.invoiceMetadata?.invoiceNumber);
  return (
    <View style={refinedStyles.identityTable}>
      <IdentityRow leftLabel={payeeLabel(model)} leftValue={model.payee.name} rightLabel="Role / Calisma Tipi" rightValue={roleDisplay(model)} />
      <IdentityRow
        leftLabel="Statement Period / Donem"
        leftValue={`${formatDate(model.periodStart)} - ${formatDate(model.periodEnd)}`}
        rightLabel="Invoice Date / Fatura"
        rightValue={formatDate(model.invoiceMetadata?.invoiceDate)}
      />
      <IdentityRow
        leftLabel="Payment Date / Odeme"
        leftValue={formatDate(model.invoiceMetadata?.paymentDate)}
        rightLabel="Company / Sirket"
        rightValue={model.company.name}
      />
      <View style={refinedStyles.identityRowLast} wrap={false}>
        <T style={refinedStyles.identityLabel}>Truck / Unit</T>
        <T style={refinedStyles.identityValue}>{`Unit ${model.vehicleDisplay}`}</T>
        <T style={refinedStyles.identityLabel}>Invoice / Status</T>
        <View style={refinedStyles.identityValueLast}>
          {invoiceChunks.map((chunk, index) => <T key={index} style={refinedStyles.invoiceLine}>{chunk}</T>)}
          <T style={refinedStyles.invoiceStatus}>{`Payment: ${displayOrNA(model.invoiceMetadata?.paymentStatus)}`}</T>
        </View>
      </View>
    </View>
  );
}

function IdentityRow({ leftLabel, leftValue, rightLabel, rightValue }: { leftLabel: string; leftValue: string; rightLabel: string; rightValue: string }) {
  return (
    <View style={refinedStyles.identityRow} wrap={false}>
      <T style={refinedStyles.identityLabel}>{leftLabel}</T>
      <T style={refinedStyles.identityValue}>{displayOrNA(leftValue)}</T>
      <T style={refinedStyles.identityLabel}>{rightLabel}</T>
      <T style={refinedStyles.identityValueLast}>{displayOrNA(rightValue)}</T>
    </View>
  );
}

export function RefinedSummaryCards({ model }: { model: AmazonStatementViewModel }) {
  const terms = typeTerminology(model.statementType);
  const percentageLabels = percentageCardLabels(model.statementType);
  return (
    <View style={styles.cards} wrap={false}>
      <RefinedSummaryCard style={styles.grossCard} labelEn={terms.gross.toUpperCase()} labelTr="TOPLAM BRUT GELIR" value={formatMoney(model.summary.grossRevenue)} />
      <RefinedSummaryCard style={styles.fixedCard} labelEn="INSURANCE + ELD" labelTr="SIGORTA + ELD" value={formatMoney(-Math.abs(model.summary.fixedDeductions))} negative />
      <RefinedSummaryCard style={styles.percentageCard} labelEn={percentageLabels.en} labelTr={percentageLabels.tr} value={formatMoney(-Math.abs(model.summary.percentageDeductions))} negative />
      <RefinedSummaryCard style={styles.fuelCard} labelEn="FUEL / DEF" labelTr="YAKIT / DEF" value={formatMoney(-Math.abs(model.summary.fuelDeductions))} negative />
      <RefinedSummaryCard style={styles.netCard} labelEn={terms.net.toUpperCase()} labelTr="ODENECEK NET" value={formatMoney(model.summary.netAmount)} negative={model.summary.netAmount < 0} positive={model.summary.netAmount >= 0} />
    </View>
  );
}

function RefinedSummaryCard({
  style,
  labelEn,
  labelTr,
  value,
  negative,
  positive,
}: {
  style: any;
  labelEn: string;
  labelTr: string;
  value: string;
  negative?: boolean;
  positive?: boolean;
}) {
  const valueStyle = negative
    ? [refinedStyles.summaryValue, styles.negative]
    : positive
      ? [refinedStyles.summaryValue, styles.positive]
      : refinedStyles.summaryValue;
  return (
    <View style={[styles.card, refinedStyles.summaryCard, style]}>
      <View style={refinedStyles.summaryLabelBox}>
        <T style={refinedStyles.summaryLabelEn}>{labelEn}</T>
        <T style={refinedStyles.summaryLabelTr}>{labelTr}</T>
      </View>
      <T style={valueStyle}>{value}</T>
    </View>
  );
}

export function RefinedCalculationSummary({ model }: { model: AmazonStatementViewModel }) {
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

export function RefinedRevenueTable({ model }: { model: AmazonStatementViewModel }) {
  if (model.revenueLines.length === 0) return null;
  const totals = revenueTotals(model.revenueLines);
  return (
    <View>
      <SectionHeading
        title="Revenue Details / Gelir Detaylari"
        intro="Same Trip ID rows are merged into one statement line. Routes show city/state when available; otherwise the original Amazon station codes are shown."
      />
      <View style={styles.table}>
        <View style={styles.tableHeader} fixed>
          <T style={[styles.th, { width: "9%" }]}>Date</T>
          <T style={[styles.th, { width: "13%" }]}>Trip / Load ID</T>
          <T style={[styles.th, { width: "23%" }]}>Route</T>
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
            <T style={[styles.td, { width: "23%" }]}>{displayOrNA(line.routeDisplay)}</T>
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
          <T style={[styles.td, { width: "13%" }]}>{`${model.revenueLines.length} loads`}</T>
          <T style={[styles.td, { width: "23%" }]}>Selected revenue total</T>
          <T style={[styles.td, styles.center, { width: "10%" }]}>Completed</T>
          <T style={[styles.tdBold, styles.right, { width: "7%" }]}>{formatNumber(totals.distance, 2)}</T>
          <T style={[styles.td, styles.center, { width: "7%" }]}>N/A</T>
          <T style={[styles.tdBold, styles.right, { width: "8%" }]}>{formatMoney(totals.base)}</T>
          <T style={[styles.tdBold, styles.right, { width: "8%" }]}>{formatMoney(totals.fuel)}</T>
          <T style={[styles.tdBold, styles.right, { width: "7%" }]}>{formatMoney(totals.tolls)}</T>
          <T style={[styles.tdBold, styles.right, { width: "8%" }]}>{formatMoney(totals.gross)}</T>
        </View>
      </View>
      <T style={styles.sectionIntro}>Weight is shown as N/A when Amazon does not provide source weight data. Amazon-paid tolls remain included in gross revenue.</T>
    </View>
  );
}

export function RefinedFuelTable({ model }: { model: AmazonStatementViewModel }) {
  if (model.fuelLines.length === 0) return null;
  const displayLines = groupFuelLinesForDisplay(model.fuelLines);
  const totals = fuelTotals(model.fuelLines);
  return (
    <View>
      <SectionHeading
        title="Fuel / DEF Details / Yakit Detaylari"
        intro={`${totals.transactionCount} fuel-card transaction(s), grouped by receipt. Each product line repeats its receipt details so no blank transaction cells remain.`}
      />
      <View style={styles.table}>
        <View style={styles.tableHeader} fixed>
          <T style={[styles.th, { width: "14%" }]}>Date / Time</T>
          <T style={[styles.th, { width: "8%" }]}>Inv</T>
          <T style={[styles.th, { width: "22%" }]}>Merchant</T>
          <T style={[styles.th, { width: "16%" }]}>Location</T>
          <T style={[styles.th, { width: "8%" }]}>Item</T>
          <T style={[styles.th, styles.right, { width: "8%" }]}>Qty</T>
          <T style={[styles.th, styles.right, { width: "8%" }]}>Avg PPU</T>
          <T style={[styles.th, styles.right, { width: "7%" }]}>Disc.</T>
          <T style={[styles.th, styles.right, { width: "9%" }]}>Amount</T>
        </View>
        {displayLines.map(({ line, transactionIndex, firstInTransaction }) => {
          const baseStyle = transactionIndex % 2 ? [styles.tableRow, styles.tableRowAlt] : styles.tableRow;
          const rowStyle = firstInTransaction ? [baseStyle, refinedStyles.transactionStart] : baseStyle;
          return (
            <View key={line.id} style={rowStyle} wrap={false}>
              <T style={[styles.td, { width: "14%" }]}>{formatDateTime(line.date)}</T>
              <T style={[styles.td, { width: "8%" }]}>{displayOrNA(line.invoice)}</T>
              <T style={[styles.td, { width: "22%" }]}>{displayOrNA(line.merchant)}</T>
              <T style={[styles.td, { width: "16%" }]}>{displayOrNA(line.location)}</T>
              <T style={[styles.td, { width: "8%" }]}>{line.product}</T>
              <T style={[styles.td, styles.right, { width: "8%" }]}>{formatNumber(line.quantity, 2)}</T>
              <T style={[styles.td, styles.right, { width: "8%" }]}>{line.chargedPpu == null ? "N/A" : formatMoney(line.chargedPpu)}</T>
              <T style={[styles.td, styles.right, { width: "7%" }]}>{line.discountAmount == null ? "$0.00" : formatMoney(line.discountAmount)}</T>
              <T style={line.amount < 0 ? [styles.tdBold, styles.right, styles.negative, { width: "9%" }] : [styles.tdBold, styles.right, { width: "9%" }]}>{formatMoney(line.amount)}</T>
            </View>
          );
        })}
        <View style={styles.tableTotalRow} wrap={false}>
          <T style={[styles.tdBold, { width: "14%" }]}>TOTAL</T>
          <T style={[styles.td, { width: "8%" }]}>{`${totals.transactionCount} txns`}</T>
          <T style={[styles.td, { width: "22%" }]}>Fuel and DEF total</T>
          <T style={[styles.td, { width: "16%" }]} />
          <T style={[styles.td, { width: "8%" }]} />
          <T style={[styles.tdBold, styles.right, { width: "8%" }]}>{formatNumber(totals.quantity, 2)}</T>
          <T style={[styles.td, { width: "8%" }]} />
          <T style={[styles.tdBold, styles.right, { width: "7%" }]}>{formatMoney(totals.discount)}</T>
          <T style={[styles.tdBold, styles.right, { width: "9%" }]}>{formatMoney(totals.amount)}</T>
        </View>
      </View>
      <RefinedFuelSummary model={model} />
    </View>
  );
}

function RefinedFuelSummary({ model }: { model: AmazonStatementViewModel }) {
  const groups = fuelProductGroups(model.fuelLines);
  const totals = fuelTotals(model.fuelLines);
  const cellWidth = `${100 / (groups.length + 1)}%`;
  return (
    <View style={refinedStyles.fuelSummaryGrid} wrap={false}>
      {groups.map((group) => (
        <View key={group.product} style={[refinedStyles.fuelSummaryCell, { width: cellWidth }]}>
          <T style={refinedStyles.fuelSummaryTitle}>{group.product}</T>
          <T style={refinedStyles.fuelSummaryAmount}>{formatMoney(group.amount)}</T>
          <T style={refinedStyles.fuelSummaryDetail}>{`${formatNumber(group.quantity, 2)} gal | Avg ${formatMoney(group.averagePpu)}`}</T>
        </View>
      ))}
      <View style={[refinedStyles.fuelSummaryCellLast, { width: cellWidth }]}>
        <T style={refinedStyles.fuelSummaryTitle}>TOTAL FUEL / DEF</T>
        <T style={refinedStyles.fuelSummaryAmount}>{formatMoney(totals.amount)}</T>
        <T style={refinedStyles.fuelSummaryDetail}>{`${formatNumber(totals.quantity, 2)} gal | Discount ${formatMoney(totals.discount)}`}</T>
      </View>
    </View>
  );
}

export function RefinedDeductionSummary({ model }: { model: AmazonStatementViewModel }) {
  const rows = displayDeductionRows(model);
  return (
    <View>
      <SectionHeading title="Deductions / Kesintiler" intro="Deductions use the saved candidate calculation. Percentage fees are based on gross revenue." />
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

export function FinalNetBanner({ model }: { model: AmazonStatementViewModel }) {
  return (
    <View style={refinedStyles.netBanner} wrap={false}>
      <T style={refinedStyles.netBannerLabel}>{`NET PAYABLE TO ${model.payee.name.toUpperCase()} / ODENECEK NET`}</T>
      <T style={model.summary.netAmount < 0 ? [refinedStyles.netBannerAmount, styles.negative] : refinedStyles.netBannerAmount}>{formatMoney(model.summary.netAmount)}</T>
    </View>
  );
}

export function RefinedSignaturePanels({ model }: { model: AmazonStatementViewModel }) {
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
          <T style={styles.signaturePanelHeaderText}>{payeeApprovalTitle(model)}</T>
        </View>
        <SignatureField labelText="Name / Isim" value={model.payeeSignature.printedName ?? model.payee.name} />
        <SignatureField labelText="Signature / Imza" signature />
        <SignatureField labelText="Date / Tarih" value={formatDate(model.payeeSignature.approvalDate)} last />
      </View>
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
    .map((line) => {
      const labelText = normalizeDeductionLabel(line, model.statementType);
      return {
        key: line.id,
        label: labelText,
        amount: Math.abs(line.amount),
        basis: deductionBasis(line, model),
        calculationLabel: calculationLabel(line, labelText, model),
        order: deductionDisplayOrder(line),
      };
    });

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

function deductionBasis(line: AmazonStatementDeductionLine, model: AmazonStatementViewModel): string {
  const value = `${line.type} ${line.label}`;
  const percentage = line.label.match(/(\d+(?:\.\d+)?)\s*%/)?.[1];
  if (/company fee|external carrier fee|percentage/i.test(value)) {
    return percentage ? `${percentage}% x ${formatMoney(model.summary.grossRevenue)}` : "Percentage of gross revenue";
  }
  if (/driver pay|driver percentage/i.test(value)) {
    return percentage ? `${percentage}% x ${formatMoney(model.summary.grossRevenue)}` : "Driver percentage of gross revenue";
  }
  if (/insurance/i.test(value)) return "Fixed insurance deduction / Sabit sigorta kesintisi";
  if (/eld|safety|ifta/i.test(value)) return "Fixed weekly deduction / Sabit haftalik kesinti";
  return "Saved candidate calculation / Kayitli hesaplama";
}

function calculationLabel(line: AmazonStatementDeductionLine, labelText: string, model: AmazonStatementViewModel): string {
  const value = `${line.type} ${line.label}`;
  if (/company fee|external carrier fee|percentage/i.test(value)) return `${labelText}: ${deductionBasis(line, model)}`;
  return labelText;
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

function fuelTotals(lines: AmazonStatementFuelLine[]) {
  const transactionKeys = new Set<string>();
  let quantity = 0;
  let discount = 0;
  let amount = 0;
  for (const line of lines) {
    transactionKeys.add(fuelTransactionKey(line));
    quantity += Number(line.quantity ?? 0);
    discount += Number(line.discountAmount ?? 0);
    amount += Number(line.amount ?? 0);
  }
  return { transactionCount: transactionKeys.size, quantity, discount, amount };
}

function fuelProductGroups(lines: AmazonStatementFuelLine[]) {
  const groups = new Map<string, { product: string; quantity: number; amount: number; ppuWeighted: number }>();
  for (const line of lines) {
    const product = line.product.toUpperCase();
    const current = groups.get(product) ?? { product, quantity: 0, amount: 0, ppuWeighted: 0 };
    const quantity = Number(line.quantity ?? 0);
    current.quantity += quantity;
    current.amount += Number(line.amount ?? 0);
    current.ppuWeighted += Number(line.chargedPpu ?? 0) * quantity;
    groups.set(product, current);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, averagePpu: group.quantity > 0 ? group.ppuWeighted / group.quantity : 0 }))
    .sort((a, b) => a.product.localeCompare(b.product));
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

function splitIdentifier(value: string | null | undefined): string[] {
  const raw = displayOrNA(value);
  if (raw === "N/A" || raw.length <= 22) return [raw];
  return raw.match(/.{1,20}/g) ?? [raw];
}

function headerTitle(model: AmazonStatementViewModel): string {
  if (model.statementType === "managed_investor") return "OWNER / INVESTOR SETTLEMENT";
  if (model.statementType === "owner_operator") return "OWNER OPERATOR SETTLEMENT";
  if (model.statementType === "box_truck_driver") return "BOX TRUCK DRIVER SETTLEMENT";
  return "COMPANY DRIVER SETTLEMENT";
}

function headerSubtitle(model: AmazonStatementViewModel): string {
  if (model.language === "tr") return "Amazon Relay Odeme Dokumu";
  if (model.language === "en") return "Amazon Relay Payment Statement";
  return "Amazon Relay Statement - English / Turkce";
}

function payeeLabel(model: AmazonStatementViewModel): string {
  if (model.statementType === "managed_investor") return "Investor / Yatirimci";
  if (model.statementType === "owner_operator") return "Owner / Isletmeci";
  return "Driver / Sofor";
}

function roleDisplay(model: AmazonStatementViewModel): string {
  if (model.statementType === "managed_investor") return "Managed Investor";
  if (model.statementType === "owner_operator") return "Owner Operator";
  if (model.statementType === "box_truck_driver") return "Box Truck Driver";
  return "Company Driver";
}

function payeeApprovalTitle(model: AmazonStatementViewModel): string {
  if (model.statementType === "managed_investor") return "INVESTOR APPROVAL / YATIRIMCI ONAYI";
  if (model.statementType === "owner_operator") return "OWNER OPERATOR APPROVAL / OWNER ONAYI";
  return "DRIVER APPROVAL / SOFOR ONAYI";
}
