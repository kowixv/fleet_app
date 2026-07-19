import { NextResponse } from "next/server";
import { requireAmazonImportActor } from "@/lib/amazon-statements/server/auth";
import { createClient } from "@/lib/supabase/server";
import { renderAmazonStatementPdf } from "@/lib/amazon-statements/pdf/statement-template-registry";
import { candidatePdfModel } from "@/lib/amazon-statements/pdf/candidate-pdf-model";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const actor = await requireAmazonImportActor();
  const { candidateId } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("amazon_statement_candidates")
    .select("id, organization_id, statement_type, status, period_start, period_end, payee_id, people!amazon_statement_candidates_payee_same_org_fk(full_name), vehicle_id, vehicles!amazon_statement_candidates_vehicle_same_org_fk(unit_number), template_version, calculation_rule_version, source_revision, preview_revision, configuration_snapshot, calculation_snapshot, gross_amount, percentage_deductions_amount, fixed_deductions_amount, fuel_deductions_amount, other_deductions_amount, total_deductions_amount, net_amount, converted_settlement_id")
    .eq("organization_id", actor.organizationId)
    .eq("id", candidateId)
    .single();

  if (error) {
    return NextResponse.json({ error: "Statement candidate is not available." }, { status: 404 });
  }

  try {
    const model = candidatePdfModel(data as Record<string, unknown>);
    const pdf = await renderAmazonStatementPdf(model);
    const filename = safeFilename(`amazon-statement-${String(data.id).slice(0, 8)}-${model.candidateStatus}.pdf`);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (renderError) {
    console.error("Amazon statement PDF preview failed", {
      candidateId,
      organizationId: actor.organizationId,
      error: renderError instanceof Error ? renderError.message : String(renderError),
    });
    return NextResponse.json(
      { error: "Statement PDF could not be generated. Recalculate and save the candidate, then try again." },
      { status: 422 },
    );
  }
}

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}
