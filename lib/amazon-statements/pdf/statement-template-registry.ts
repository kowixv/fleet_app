import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { AmazonStatementPdfDocument } from "./statement-pdf";
import { assertValidStatementViewModel } from "./statement-pdf-validation";
import type { AmazonStatementViewModel } from "./statement-view-model";

export const AMAZON_STATEMENT_TEMPLATE_V1 = "amazon-statement-v1" as const;

export interface AmazonStatementPdfTemplate {
  version: string;
  render(model: AmazonStatementViewModel): Promise<Buffer>;
}

const v1Template: AmazonStatementPdfTemplate = {
  version: AMAZON_STATEMENT_TEMPLATE_V1,
  async render(model) {
    assertValidStatementViewModel(model, knownAmazonStatementTemplateVersions());
    return renderToBuffer(React.createElement(AmazonStatementPdfDocument, { model }) as any);
  },
};

const registry: Record<string, AmazonStatementPdfTemplate> = {
  [AMAZON_STATEMENT_TEMPLATE_V1]: v1Template,
};

export function knownAmazonStatementTemplateVersions(): string[] {
  return Object.keys(registry).sort();
}

export function getAmazonStatementTemplate(version: string): AmazonStatementPdfTemplate {
  const template = registry[version];
  if (!template) throw new Error(`Unknown Amazon statement PDF template version: ${version}`);
  return template;
}

export async function renderAmazonStatementPdf(model: AmazonStatementViewModel): Promise<Buffer> {
  return getAmazonStatementTemplate(model.templateVersion).render(model);
}
