import { NextResponse } from "next/server";
import { requireAmazonImportActor } from "@/lib/amazon-statements/server/auth";
import { createClient } from "@/lib/supabase/server";
import {
  autoSelectCandidateSources,
  uniqueOwnedVehicleId,
  type CandidateAutoSelectableSource,
  type CandidateStatementType,
} from "@/lib/amazon-statements/candidates/candidate-auto-selection";
import { loadCandidateAutoSelectionHints } from "@/lib/amazon-statements/server/candidate-auto-selection-service";

export const dynamic = "force-dynamic";

type RequestBody = {
  statementType?: string;
  payeeId?: string;
  vehicleId?: string | null;
};

type DbRow = Record<string, unknown>;

export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const actor = await requireAmazonImportActor();
  const { batchId } = await params;
  const body = await safeJson(request);
  const statementType = validStatementType(body.statementType);
  const payeeId = stringOrNull(body.payeeId);
  const requestedVehicleId = stringOrNull(body.vehicleId);

  if (!statementType || !payeeId) {
    return NextResponse.json({ error: "Statement type and payee are required for automatic source selection." }, { status: 400 });
  }

  const supabase = await createClient();
  const [batchResult, payeeResult, vehiclesResult, revenueResult, fuelResult] = await Promise.all([
    supabase
      .from("amazon_import_batches")
      .select("id, organization_id, status, period_start, period_end")
      .eq("organization_id", actor.organizationId)
      .eq("id", batchId)
      .single(),
    supabase
      .from("people")
      .select("id, type")
      .eq("organization_id", actor.organizationId)
      .eq("id", payeeId)
      .single(),
    supabase
      .from("vehicles")
      .select("id, owner_id")
      .eq("organization_id", actor.organizationId),
    supabase
      .from("amazon_revenue_load_projections")
      .select("revenue_item_id")
      .eq("organization_id", actor.organizationId)
      .eq("batch_id", batchId)
      .eq("projection_status", "projected"),
    supabase
      .from("amazon_fuel_expense_projections")
      .select("transaction_line_id, projection_snapshot")
      .eq("organization_id", actor.organizationId)
      .eq("batch_id", batchId)
      .eq("projection_status", "projected"),
  ]);

  if (batchResult.error || !batchResult.data) {
    return NextResponse.json({ error: "Amazon import batch is not available." }, { status: 404 });
  }
  if (payeeResult.error || !payeeResult.data) {
    return NextResponse.json({ error: "Selected payee is not available." }, { status: 404 });
  }
  if (vehiclesResult.error) throw new Error(vehiclesResult.error.message);
  if (revenueResult.error) throw new Error(revenueResult.error.message);
  if (fuelResult.error) throw new Error(fuelResult.error.message);

  const vehicles = (vehiclesResult.data ?? []).map((vehicle) => ({
    id: String(vehicle.id),
    ownerId: stringOrNull(vehicle.owner_id),
  }));
  if (requestedVehicleId && !vehicles.some((vehicle) => vehicle.id === requestedVehicleId)) {
    return NextResponse.json({ error: "Selected unit is not available." }, { status: 400 });
  }

  const revenueItemIds = uniqueStrings((revenueResult.data ?? []).map((row) => stringOrNull(row.revenue_item_id)));
  const fuelLineIds = uniqueStrings((fuelResult.data ?? [])
    .filter((row) => !isPlaceholder(row.projection_snapshot))
    .map((row) => stringOrNull(row.transaction_line_id)));
  const hints = await loadCandidateAutoSelectionHints({
    organizationId: actor.organizationId,
    batchId,
    periodStart: stringOrNull(batchResult.data.period_start),
    periodEnd: stringOrNull(batchResult.data.period_end),
    revenueItemIds,
    fuelLineIds,
  });

  const revenueSources = asSelectableSources(revenueItemIds, hints.revenue);
  const fuelSources = asSelectableSources(fuelLineIds, hints.fuel);
  let vehicleId = requestedVehicleId;
  let ownershipInferredFromExactSources = false;

  if (!vehicleId) {
    vehicleId = uniqueOwnedVehicleId({ statementType, payeeId, vehicles });
    if (!vehicleId && (statementType === "owner_operator" || statementType === "managed_investor")) {
      const coAttributedVehicleIds = uniqueStrings([...revenueSources, ...fuelSources]
        .filter((source) => source.autoSelectionStatus === "exact" && source.suggestedPersonIds.includes(payeeId))
        .flatMap((source) => source.suggestedVehicleIds));
      if (coAttributedVehicleIds.length === 1) {
        vehicleId = coAttributedVehicleIds[0];
        ownershipInferredFromExactSources = true;
      }
    }
  }

  const selectionVehicles = ownershipInferredFromExactSources && vehicleId
    ? vehicles.map((vehicle) => vehicle.id === vehicleId ? { ...vehicle, ownerId: payeeId } : vehicle)
    : vehicles;
  const common = { statementType, payeeId, vehicleId, vehicles: selectionVehicles };
  const revenueSelection = autoSelectCandidateSources({ ...common, sources: revenueSources });
  const fuelSelection = autoSelectCandidateSources({ ...common, sources: fuelSources });

  return NextResponse.json({
    vehicleId,
    selectedRevenueItemIds: revenueSelection.selectedSourceIds,
    selectedFuelLineIds: fuelSelection.selectedSourceIds,
    exactRevenueCount: revenueSelection.exactMatchCount,
    exactFuelCount: fuelSelection.exactMatchCount,
    revenueReviewRequiredCount: revenueSelection.reviewRequiredCount,
    fuelReviewRequiredCount: fuelSelection.reviewRequiredCount,
  });
}

function asSelectableSources(
  sourceIds: string[],
  hints: Map<string, CandidateAutoSelectableSource>,
): CandidateAutoSelectableSource[] {
  return sourceIds.map((sourceId) => {
    const hint = hints.get(sourceId);
    return {
      sourceId,
      suggestedPersonIds: hint?.suggestedPersonIds ?? [],
      suggestedVehicleIds: hint?.suggestedVehicleIds ?? [],
      autoSelectionStatus: hint?.autoSelectionStatus ?? "unmatched",
      autoSelectionReasons: hint?.autoSelectionReasons ?? ["no_exact_attribution"],
    };
  });
}

function validStatementType(value: unknown): CandidateStatementType | null {
  return value === "company_driver"
    || value === "box_truck_driver"
    || value === "owner_operator"
    || value === "managed_investor"
    ? value
    : null;
}

function isPlaceholder(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as DbRow).placeholder === true;
}

async function safeJson(request: Request): Promise<RequestBody> {
  try {
    return await request.json() as RequestBody;
  } catch {
    return {};
  }
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
