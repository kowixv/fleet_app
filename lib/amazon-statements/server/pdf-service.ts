import "server-only";

import { renderAmazonStatementPdf } from "../pdf/statement-template-registry";
import { assertValidStatementViewModel } from "../pdf/statement-pdf-validation";
import { AMAZON_STATEMENT_TEMPLATE_V1 } from "../pdf/statement-template-registry";
import type { AmazonStatementViewModel } from "../pdf/statement-view-model";

export async function renderAmazonCandidateStatementPdfFromSnapshot(
  snapshot: AmazonStatementViewModel,
): Promise<Buffer> {
  assertValidStatementViewModel(snapshot, [AMAZON_STATEMENT_TEMPLATE_V1]);
  return renderAmazonStatementPdf(snapshot);
}
