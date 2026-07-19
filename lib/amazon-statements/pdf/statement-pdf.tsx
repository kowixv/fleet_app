import React from "react";
import { Document, Page } from "@react-pdf/renderer";
import type { AmazonStatementViewModel } from "./statement-view-model";
import {
  RevenueMetrics,
  StatementFooter,
  StatementNotes,
  StatementWatermark,
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
