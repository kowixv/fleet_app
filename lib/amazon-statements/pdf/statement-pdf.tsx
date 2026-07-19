import React from "react";
import { Document, Page } from "@react-pdf/renderer";
import type { AmazonStatementViewModel } from "./statement-view-model";
import {
  CalculationSummary,
  DeductionSummary,
  FinalSettlementSummary,
  FuelTable,
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
        <FuelTable model={model} />
        <DeductionSummary model={model} />
        <FinalSettlementSummary model={model} />
        <StatementFooter model={model} />
      </Page>

      <Page size="LETTER" style={styles.page} wrap>
        <StatementWatermark model={model} />
        <StatementHeader model={model} />
        <StatementNotes model={model} />
        <TeamAllocation model={model} />
        <SignaturePanels model={model} />
        <StatementFooter model={model} />
      </Page>
    </Document>
  );
}
