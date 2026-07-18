import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  applyProjectionPreview,
  previewFuelExpenseProjections,
  previewRevenueLoadProjections,
} from "../projection/projection-preview";
import {
  fuelProjectionRpcPayload,
  revenueProjectionRpcPayload,
} from "../projection/projection-apply";
import type { ExistingProjection, FuelProjectionItem, RevenueProjectionItem } from "../projection/projection-types";
import type { AmazonWorkflowActor } from "./workflow-types";

export function previewAmazonProjection(args: {
  revenueItems: RevenueProjectionItem[];
  fuelItems: FuelProjectionItem[];
  existingRevenue?: ExistingProjection[];
  existingFuel?: ExistingProjection[];
}) {
  return {
    revenue: previewRevenueLoadProjections({ items: args.revenueItems, existing: args.existingRevenue }),
    fuel: previewFuelExpenseProjections({ items: args.fuelItems, existing: args.existingFuel }),
  };
}

export async function applyAmazonProjection(args: {
  actor: AmazonWorkflowActor;
  batchId: string;
  expectedRevenuePreviewRevision: string;
  expectedFuelPreviewRevision: string;
  revenueItems: RevenueProjectionItem[];
  fuelItems: FuelProjectionItem[];
  existingRevenue?: ExistingProjection[];
  existingFuel?: ExistingProjection[];
}) {
  const preview = previewAmazonProjection(args);
  const revenueDryRun = applyProjectionPreview({
    preview: preview.revenue,
    expectedPreviewRevision: args.expectedRevenuePreviewRevision,
  });
  const fuelDryRun = applyProjectionPreview({
    preview: preview.fuel,
    expectedPreviewRevision: args.expectedFuelPreviewRevision,
  });
  if (revenueDryRun.conflicts > 0 || fuelDryRun.conflicts > 0) {
    return { ok: false as const, revenue: revenueDryRun, fuel: fuelDryRun };
  }
  const supabase = await createClient();
  const revenuePayload = revenueProjectionRpcPayload({
    organizationId: args.actor.organizationId,
    batchId: args.batchId,
    previewRevision: args.expectedRevenuePreviewRevision,
    items: preview.revenue.toCreate,
  });
  const fuelPayload = fuelProjectionRpcPayload({
    organizationId: args.actor.organizationId,
    batchId: args.batchId,
    previewRevision: args.expectedFuelPreviewRevision,
    items: preview.fuel.toCreate,
  });
  const [revenueApply, fuelApply] = await Promise.all([
    supabase.rpc("apply_amazon_revenue_load_projections", revenuePayload),
    supabase.rpc("apply_amazon_fuel_expense_projections", fuelPayload),
  ]);
  if (revenueApply.error) throw new Error(revenueApply.error.message);
  if (fuelApply.error) throw new Error(fuelApply.error.message);
  return { ok: true as const, revenue: revenueDryRun, fuel: fuelDryRun };
}
