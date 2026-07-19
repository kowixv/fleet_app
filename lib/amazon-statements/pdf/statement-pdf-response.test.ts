import { describe, expect, it } from "vitest";
import { statementPdfResponse } from "./statement-pdf-response";
import { renderAmazonStatementPdf } from "./statement-template-registry";
import { buildAmazonStatementFixture } from "./statement-fixtures";

describe("amazon statement PDF response", () => {
  it("returns a 200 inline PDF response for a rendered statement buffer", async () => {
    const model = buildAmazonStatementFixture("company_driver");
    const pdf = await renderAmazonStatementPdf(model);
    const response = statementPdfResponse(
      pdf,
      { id: model.candidateId },
      model.candidateStatus,
      "snapshot-fallback",
    );

    const body = Buffer.from(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("X-Statement-Detail-Mode")).toBe("snapshot-fallback");
    expect(body.length).toBeGreaterThan(1000);
    expect(body.subarray(0, 4).toString()).toBe("%PDF");
  });
});
