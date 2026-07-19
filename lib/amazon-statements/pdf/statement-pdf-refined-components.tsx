import { StyleSheet, Text, View } from "@react-pdf/renderer";
import React from "react";
import { typeTerminology } from "./statement-labels";
import { displayOrNA, formatDate, formatMoney, formatNumber, pdfSafeText } from "./statement-formatting";
import {
  CalculationSummary,
  DeductionSummary,
  RevenueTable,
  styles,
} from "./statement-pdf-components";
import {
  fuelTransactionKey,
  groupFuelLinesForDisplay,
  normalizeDeductionLabel,
  percentageCardLabels,
} from "./statement-pdf-refinement-helpers";
import type {
  AmazonStatementFuelLine,
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
  ink: "#273444",
  muted: "#667085",
  green: "#137a55",
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
  section: { marginTop: 7 },
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
    <View style={refinedStyles.section}>
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
      <SummaryCard style={styles.grossCard} labelEn={terms.gross.toUpperCase()} labelTr="TOPLAM BRUT GELIR" value={formatMoney(model.summary.grossRevenue)} />
      <SummaryCard style={styles.fixedCard} labelEn="INSURANCE + ELD" labelTr="SIGORTA + ELD" value={formatMoney(-Math.abs(model.summary.fixedDeductions))} negative />
      <SummaryCard style={styles.percentageCard} labelEn={percentageLabels.en} labelTr={percentageLabels.tr} value={formatMoney(-Math.abs(model.summary.percentageDeductions))} negative />
      <SummaryCard style={styles.fuelCard} labelEn="FUEL / DEF" labelTr="YAKIT / DEF" value={formatMoney(-Math.abs(model.summary.fuelDeductions))} negative />
      <SummaryCard style={styles.netCard} labelEn={terms.net.toUpperCase()} labelTr="ODENECEK NET" value={formatMoney(model.summary.netAmount)} negative={model.summary.netAmount < 0} positive={model.summary.netAmount >= 0} />
    </View>
  );
}

function SummaryCard({
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
  return <CalculationSummary model={displayModel(model)} />;
}

export function RefinedDeductionSummary({ model }: { model: AmazonStatementViewModel }) {
  return <DeductionSummary model={displayModel(model)} />;
}

export function RefinedRevenueTable({ model }: { model: AmazonStatementViewModel }) {
  return <RevenueTable model={model} />;
}

function displayModel(model: AmazonStatementViewModel): AmazonStatementViewModel {
  if (model.statementType !== "managed_investor") return model;
  return {
    ...model,
    deductionLines: model.deductionLines.map((line) => ({
      ...line,
      label: normalizeDeductionLabel(line, model.statementType),
    })),
  };
}

export function RefinedFuelTable({ model }: { model: AmazonStatementViewModel }) {
  if (model.fuelLines.length === 0) return null;
  const displayLines = groupFuelLinesForDisplay(model.fuelLines);
  const totals = fuelTotals(model.fuelLines);
  return (
    <View>
      <SectionHeading
        title="Fuel / DEF Details / Yakit Detaylari"
        intro={`${totals.transactionCount} fuel-card transaction(s), grouped by receipt. Receipt details repeat on each product line so the table has no blank transaction cells.`}
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
          const rowStyle = transactionIndex % 2
            ? firstInTransaction
              ? [styles.tableRow, styles.tableRowAlt, refinedStyles.transactionStart]
              : [styles.tableRow, styles.tableRowAlt]
            : firstInTransaction
              ? [styles.tableRow, refinedStyles.transactionStart]
              : styles.tableRow;
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
      <FuelSummaryCards model={model} />
    </View>
  );
}

function FuelSummaryCards({ model }: { model: AmazonStatementViewModel }) {
  const groups = fuelProductGroups(model.fuelLines);
  const totals = fuelTotals(model.fuelLines);
  const cellWidth = groups.length <= 1 ? "50%" : groups.length === 2 ? "33.333%" : "25%";
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
