import React from "react";
import { Document, Page } from "@react-pdf/renderer";
import type { AmazonStatementViewModel } from "./statement-view-model";
import {
  CalculationSummary,
  DeductionSummary,
  IdentityGrid,
  RevenueMetrics,
  RevenueTable,
  SignaturePanels,
  StatementFooter,
  StatementHeader,
  StatementNotes,
  StatementWatermark,
  SummaryCards,
  TeamAllocation,
  styles,
} from "./statement-pdf-components";
import {
  FinalNetBanner,
  RefinedCalculationSummary,
  RefinedDeductionSummary,
  RefinedFuelTable,
  RefinedIdentityGrid,
  RefinedRevenueTable,
  RefinedSignaturePanels,
  RefinedStatementHeader,
  RefinedSummaryCards,
} from "./statement-pdf-refined-components";

export function AmazonStatementPdfDocument({ model }: { model: AmazonStatementViewModel }) {
  if (model.statementType === "company_driver" || model.statementType === "box_truck_driver") {
    return <DriverStatementPdfDocument model={model} />;
  }
  return <OwnerStatementPdfDocument model={model} />;
}

function DriverStatementPdfDocument({ model }: { model: AmazonStatementViewModel }) {
  const hasDeductions = model.deductionLines.length > 0 || Math.abs(model.summary.totalDeductions) > 0.004;
  return (
    <Document
      title={`${model.documentId} ${model.templateVersion}`}
      author={model.company.name}
      subject="Amazon driver statement candidate PDF"
      producer={`fleet-app ${model.templateVersion}`}
      creator="fleet-app"
    >
      <Page size="LETTER" style={styles.page} wrap>
        <StatementWatermark model={model} />
        <StatementHeader model={model} />
        <IdentityGrid model={model} />
        <SummaryCards model={model} />
        <CalculationSummary model={model} />
        <RevenueTable model={model} />
        <RevenueMetrics model={model} />
        <StatementFooter model={model} />
      </Page>

      <Page size="LETTER" style={styles.page} wrap>
        <StatementWatermark model={model} />
        <StatementHeader model={model} />
        {hasDeductions ? <DeductionSummary model={model} /> : null}
        <StatementNotes model={model} />
        <TeamAllocation model={model} />
        <SignaturePanels model={model} />
        <StatementFooter model={model} />
      </Page>
    </Document>
  );
}

function OwnerStatementPdfDocument({ model }: { model: AmazonStatementViewModel }) {
  return (
    <Document
      title={`${model.documentId} ${model.templateVersion}`}
      author={model.company.name}
      subject="Amazon statement candidate PDF"
      producer={`fleet-app ${model.templateVersion}`}
      creator="fleet-app"
    >
      <Page size="LETTER" style={styles.page} wrap>
        <StatementWatermark model={model} />
        <RefinedStatementHeader model={model} />
        <RefinedIdentityGrid model={model} />
        <RefinedSummaryCards model={model} />
        <RefinedCalculationSummary model={model} />
        <RefinedRevenueTable model={model} />
        <RevenueMetrics model={model} />
        <StatementFooter model={model} />
      </Page>

      <Page size="LETTER" style={styles.page} wrap>
        <StatementWatermark model={model} />
        <RefinedStatementHeader model={model} />
        <RefinedFuelTable model={model} />
        <RefinedDeductionSummary model={model} />
        <FinalNetBanner model={model} />
        <StatementFooter model={model} />
      </Page>

      <Page size="LETTER" style={styles.page} wrap>
        <StatementWatermark model={model} />
        <RefinedStatementHeader model={model} />
        <StatementNotes model={model} />
        <TeamAllocation model={model} />
        <RefinedSignaturePanels model={model} />
        <StatementFooter model={model} />
      </Page>
    </Document>
  );
}
